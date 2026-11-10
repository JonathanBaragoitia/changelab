import { fail, type Product } from '../domain/catalog.ts';
import {
  editor,
  fields,
  integer,
  object,
  text,
  type Actor,
  type DocumentRepository,
} from './operations.ts';
export type ImportRow = {
  sku: string;
  quantity: number | null;
  costCents: number | null;
  evidence: string;
};
export type DocumentImport = {
  id: string;
  version: number;
  createdBy: string;
  createdAt: string;
  source: string;
  sourceHash: string;
  rows: ImportRow[];
  status: 'review' | 'processed';
  result?: unknown;
  modelUsed: boolean;
};

function evidenceTables(source: string) {
  const entries = new Map<
    string,
    { sku: string; quantity: number | null; costCents: number | null }
  >();
  const repeated = new Set<string>();
  let header: string[] = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    const cells = line.split(';').map((cell) => cell.trim());
    const labels = cells.map((cell) => cell.toLowerCase());
    if (labels.filter((label) => label === 'sku').length === 1 && cells.length > 1) {
      header = labels;
      continue;
    }
    const sku = cells[header.indexOf('sku')]?.toUpperCase();
    if (!sku || cells.length !== header.length || !/^[-A-Z0-9_]{2,60}$/.test(sku)) {
      header = [];
      continue;
    }
    const value = (pattern: RegExp) => {
      const indexes = header.flatMap((label, index) => (pattern.test(label) ? [index] : []));
      return indexes.length === 1 ? cells[indexes[0]!] : undefined;
    };
    const units = value(/^(cantidad|unidades)$/);
    const cost = value(/^(?:coste|precio) unitario (?:neto|sin iva)(?: eur)?$/);
    if (entries.has(line)) repeated.add(line);
    entries.set(line, {
      sku,
      quantity: units && /^\d{1,5}$/.test(units) ? Number(units) : null,
      costCents:
        cost && /^\d{1,7}(?:[.,]\d{1,2})?$/.test(cost)
          ? Math.round(Number(cost.replace(',', '.')) * 100)
          : null,
    });
  }
  for (const line of repeated) entries.delete(line);
  return entries;
}

function labelledEvidence(line: string) {
  // A labelled row can also be extracted from plain PDF text, without a table layout.
  const match = /^sku\s*:\s*([-a-z0-9_]{2,60})(?:\s*;|\s*\|)(.+)$/i.exec(line);
  if (!match?.[1] || !match[2]) return;
  const fields = match[2].split(/[;|]/).map((field) => field.trim());
  const fieldValue = (label: RegExp, format: RegExp) => {
    const matching = fields.flatMap((field) => label.exec(field)?.[1] ?? []);
    return matching.length === 1 ? format.exec(matching[0]!)?.[1] : undefined;
  };
  const units = fieldValue(/^(?:cantidad|unidades)\s*:\s*(.*)$/i, /^(\d{1,5})$/);
  const cost = fieldValue(
    /^(?:coste|precio) unitario (?:neto|sin iva)\s*:\s*(.*)$/i,
    /^(\d{1,7}(?:[.,]\d{1,2})?)(?:\s*EUR)?$/i,
  );
  return {
    sku: match[1].toUpperCase(),
    quantity: units === undefined ? null : Number(units),
    costCents: cost === undefined ? null : Math.round(Number(cost.replace(',', '.')) * 100),
  };
}

export function validateExtracted(raw: unknown, source: string): ImportRow[] {
  const result = object(raw);
  fields(result, ['rows']);
  if (!Array.isArray(result.rows) || result.rows.length > 30)
    fail(502, 'INVALID_EXTRACTION', 'Extracción no válida.');
  const seen = new Set<string>();
  const table = evidenceTables(source);
  const lines = new Set(source.split(/\r?\n/).map((line) => line.trim()));
  return result.rows.map((raw) => {
    const r = object(raw);
    fields(r, ['sku', 'quantity', 'costCents', 'evidence']);
    const sku = text(r.sku, 1, 60).toUpperCase(),
      evidence = text(r.evidence, 1, 600);
    const references: string[] = evidence.toUpperCase().match(/[-A-Z0-9_]+/g) ?? [];
    if (!lines.has(evidence) || !references.includes(sku) || seen.has(sku))
      fail(
        502,
        'UNSUPPORTED_EXTRACTION',
        'Hay una fila repetida o sin evidencia literal. Revisa el documento manualmente.',
      );
    seen.add(sku);
    const quantity = r.quantity === null ? null : integer(r.quantity, 1, 10000),
      costCents = r.costCents === null ? null : integer(r.costCents, 1, 100000000);
    const supported = table.get(evidence) ?? labelledEvidence(evidence);
    // Seeing a number on a line is insufficient: its column must establish its meaning.
    return {
      sku,
      quantity: supported?.sku === sku && supported.quantity === quantity ? quantity : null,
      costCents: supported?.sku === sku && supported.costCents === costCents ? costCents : null,
      evidence,
    };
  });
}
export class DocumentImports {
  private repo: DocumentRepository<DocumentImport>;
  private products: () => Product[];
  private hash: (v: unknown) => string;
  private next: () => string;
  private now: () => string;
  constructor(
    repo: DocumentRepository<DocumentImport>,
    products: () => Product[],
    hash: (v: unknown) => string,
    next: () => string,
    now: () => string,
  ) {
    this.repo = repo;
    this.products = products;
    this.hash = hash;
    this.next = next;
    this.now = now;
  }
  save(actor: Actor, source: string, rows: ImportRow[], modelUsed: boolean) {
    editor(actor);
    const value: DocumentImport = {
      id: this.next(),
      version: 1,
      createdBy: actor.id,
      createdAt: this.now(),
      source,
      sourceHash: this.hash(source),
      rows,
      status: 'review',
      modelUsed,
    };
    return this.repo.transaction(() => {
      this.repo.save(value, 0);
      this.repo.record(actor.id, 'document.extracted', {
        id: value.id,
        sourceHash: value.sourceHash,
        rows: rows.length,
        modelUsed,
      });
      return value;
    });
  }
  process(
    actor: Actor,
    id: string,
    body: Record<string, unknown>,
    apply: (
      kind: 'tariff' | 'receipt',
      supplierId: string,
      reference: string,
      rows: ImportRow[],
    ) => unknown,
  ) {
    editor(actor);
    fields(body, ['expectedVersion', 'confirmReviewed', 'kind', 'supplierId', 'reference', 'rows']);
    if (body.confirmReviewed !== true || !['tariff', 'receipt'].includes(body.kind as string))
      fail(400, 'REVIEW_REQUIRED', 'Revisa las filas y confirma el tipo de documento.');
    const supplierId = text(body.supplierId, 1, 80),
      reference = text(body.reference, 1, 100);
    if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 30)
      fail(400, 'INVALID_ROWS', 'Revisa entre 1 y 30 filas.');
    const seen = new Set<string>(),
      products = this.products();
    const rows = body.rows.map((raw) => {
      const r = object(raw);
      fields(r, ['sku', 'quantity', 'costCents']);
      const sku = text(r.sku, 1, 60).toUpperCase();
      if (seen.has(sku) || !products.some((p) => p.sku.toUpperCase() === sku))
        fail(400, 'UNKNOWN_SKU', 'Referencia desconocida o repetida: ' + sku);
      seen.add(sku);
      return {
        sku,
        quantity: body.kind === 'receipt' ? integer(r.quantity, 1, 10000) : null,
        costCents: body.kind === 'tariff' ? integer(r.costCents, 1, 100000000) : null,
        evidence: 'Confirmado manualmente',
      };
    });
    return this.repo.transaction(() => {
      const prior = this.repo.get(id);
      if (!prior) fail(404, 'IMPORT_MISSING', 'Documento no encontrado.');
      if (
        prior.status === 'processed' ||
        prior.version !== integer(body.expectedVersion, 1, 1000000)
      )
        fail(409, 'IMPORT_CHANGED', 'Documento ya procesado o cambiado.');
      const result = apply(body.kind as 'tariff' | 'receipt', supplierId, reference, rows);
      const value = {
        ...prior,
        rows,
        status: 'processed' as const,
        version: prior.version + 1,
        result,
      };
      this.repo.save(value, prior.version);
      this.repo.record(actor.id, 'document.processed', {
        id,
        kind: body.kind,
        reference,
        sourceHash: prior.sourceHash,
      });
      return value;
    });
  }
}
