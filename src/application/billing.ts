import { fail } from '../domain/catalog.ts';
import type { Sale } from './commerce.ts';
export type FiscalParty = { name: string; taxId: string; address: string };
export type Draft = {
  version?: number;
  updatedAt?: string;
  id: string;
  orderId: string;
  createdAt: string;
  createdBy: string;
  issuer: FiscalParty;
  recipient: FiscalParty;
  vatRate: 21;
  pricing: 'demo-vat-included' | 'demo-net-v1';
  lines: {
    name: string;
    quantity: number;
    unitPriceCents: number;
    baseCents: number;
    taxCents: number;
    totalCents: number;
  }[];
  baseCents: number;
  taxCents: number;
  totalCents: number;
};
export interface BillingRepository {
  transaction<T>(operation: () => T): T;
  sale(id: string): Sale | undefined;
  draftForOrder(id: string): Draft | undefined;
  saveDraft(draft: Draft): void;
  record(actor: string, action: string, detail: unknown): void;
}
export function party(input: unknown): FiscalParty {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail(400, 'FISCAL_DATA', 'Completa los datos fiscales.');
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some((key) => !['name', 'taxId', 'address'].includes(key)) ||
    typeof value.name !== 'string' ||
    value.name.trim().length < 2 ||
    value.name.length > 120 ||
    typeof value.taxId !== 'string' ||
    !/^[A-Z0-9-]{3,20}$/i.test(value.taxId) ||
    typeof value.address !== 'string' ||
    value.address.trim().length < 8 ||
    value.address.length > 300
  )
    fail(
      400,
      'FISCAL_DATA',
      'Revisa nombre, identificador fiscal y dirección. Solo datos de demostración.',
    );
  return {
    name: value.name.trim(),
    taxId: value.taxId.toUpperCase(),
    address: value.address.trim(),
  };
}
export function calculateDraftLines(sale: Sale) {
  const lines = sale.lines.map((line) => {
    const totalCents = line.quantity * line.unitPriceCents;
    if (!Number.isSafeInteger(totalCents) || totalCents < 1)
      fail(409, 'INVALID_ORDER_AMOUNT', 'Importes del pedido no válidos.');
    const baseCents = sale.tax ? totalCents : Math.round((totalCents * 100) / 121);
    const taxCents = sale.tax ? Math.round((baseCents * 21) / 100) : totalCents - baseCents;
    return {
      name: line.name,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      baseCents,
      taxCents,
      totalCents: baseCents + taxCents,
    };
  });
  const totalCents = lines.reduce((sum, line) => sum + line.totalCents, 0),
    baseCents = lines.reduce((sum, line) => sum + line.baseCents, 0);
  if (!Number.isSafeInteger(totalCents) || totalCents !== (sale.tax?.totalCents ?? sale.totalCents))
    fail(409, 'INVALID_ORDER_AMOUNT', 'El total del pedido no coincide con sus líneas.');
  return { lines, totalCents, baseCents, taxCents: totalCents - baseCents };
}
export class PrepareInvoiceDraft {
  private repository: BillingRepository;
  private nextId: () => string;
  private now: () => string;
  constructor(repository: BillingRepository, nextId: () => string, now: () => string) {
    this.repository = repository;
    this.nextId = nextId;
    this.now = now;
  }
  execute(actor: { id: string; role: string }, orderId: string, input: unknown): Draft {
    if (actor.role !== 'editor')
      fail(403, 'FORBIDDEN', 'Solo una cuenta editora puede preparar borradores.');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail(400, 'FISCAL_DATA', 'Datos no válidos.');
    const body = input as Record<string, unknown>;
    if (
      Object.keys(body).some((key) => !['issuer', 'recipient', 'acceptDemoTax'].includes(key)) ||
      body.acceptDemoTax !== true
    )
      fail(
        400,
        'DEMO_TAX_REQUIRED',
        'Confirma el desglose de demostración: total del pedido con IVA del 21 % incluido.',
      );
    const issuer = party(body.issuer),
      recipient = party(body.recipient);
    return this.repository.transaction(() => {
      const sale = this.repository.sale(orderId);
      if (!sale) fail(404, 'ORDER_NOT_FOUND', 'Pedido no encontrado.');
      if (['cancelled', 'returned'].includes(sale.status ?? ''))
        fail(409, 'ORDER_CANCELLED', 'No se puede preparar un borrador de un pedido cancelado.');
      const existing = this.repository.draftForOrder(orderId);
      if (existing) {
        if (
          JSON.stringify(existing.issuer) !== JSON.stringify(issuer) ||
          JSON.stringify(existing.recipient) !== JSON.stringify(recipient)
        )
          fail(
            409,
            'DRAFT_EXISTS',
            'Ya existe un borrador con otros datos. Consúltalo antes de continuar.',
          );
        return existing;
      }
      const draft: Draft = {
        id: this.nextId(),
        orderId,
        createdAt: this.now(),
        createdBy: actor.id,
        issuer,
        recipient,
        vatRate: 21,
        pricing: sale.tax ? 'demo-net-v1' : 'demo-vat-included',
        ...calculateDraftLines(sale),
      };
      this.repository.saveDraft(draft);
      this.repository.record(actor.id, 'billing.draft-created', {
        id: draft.id,
        orderId,
        totalCents: draft.totalCents,
        mode: 'draft-not-invoice',
      });
      return draft;
    });
  }
}

export interface DraftRevisionRepository extends BillingRepository {
  invoiceForDraft(id: string): unknown;
  draft(id: string): Draft | undefined;
  reviseDraft(draft: Draft, previous: Draft, reason: string, actorId: string): void;
}
export class ReviseDraft {
  private repository: DraftRevisionRepository;
  private now: () => string;
  constructor(repository: DraftRevisionRepository, now: () => string) {
    this.repository = repository;
    this.now = now;
  }
  execute(actor: { id: string; role: string }, id: string, input: unknown): Draft {
    if (actor.role !== 'editor')
      fail(403, 'FORBIDDEN', 'Solo una cuenta editora puede corregir borradores.');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail(400, 'INVALID_REVISION', 'Corrección no válida.');
    const body = input as Record<string, unknown>;
    if (
      Object.keys(body).some(
        (key) => !['issuer', 'recipient', 'expectedVersion', 'reason'].includes(key),
      ) ||
      !Number.isSafeInteger(body.expectedVersion) ||
      (body.expectedVersion as number) < 1 ||
      typeof body.reason !== 'string' ||
      body.reason.trim().length < 5 ||
      body.reason.length > 500
    )
      fail(
        400,
        'INVALID_REVISION',
        'Indica la versión revisada y un motivo de al menos cinco caracteres.',
      );
    const issuer = party(body.issuer),
      recipient = party(body.recipient),
      reason = body.reason.trim();
    return this.repository.transaction(() => {
      if (this.repository.invoiceForDraft(id))
        fail(409, 'ALREADY_ISSUED', 'Este borrador ya fue emitido en demo y no se puede editar.');
      const previous = this.repository.draft(id);
      if (!previous) fail(404, 'DRAFT_NOT_FOUND', 'Borrador no encontrado.');
      if (['cancelled', 'returned'].includes(this.repository.sale(previous.orderId)?.status ?? ''))
        fail(409, 'ORDER_CANCELLED', 'No se corrige un borrador de un pedido cancelado.');
      if ((previous.version ?? 1) !== body.expectedVersion)
        fail(409, 'DRAFT_CHANGED', 'El borrador ha cambiado. Actualiza antes de corregirlo.');
      if (
        JSON.stringify(previous.issuer) === JSON.stringify(issuer) &&
        JSON.stringify(previous.recipient) === JSON.stringify(recipient)
      )
        fail(400, 'NO_CHANGES', 'No hay cambios en los datos fiscales.');
      const draft = {
        ...previous,
        issuer,
        recipient,
        version: (previous.version ?? 1) + 1,
        updatedAt: this.now(),
      };
      this.repository.reviseDraft(draft, previous, reason, actor.id);
      this.repository.record(actor.id, 'billing.draft-revised', {
        id,
        orderId: draft.orderId,
        beforeVersion: previous.version ?? 1,
        afterVersion: draft.version,
        reason,
      });
      return draft;
    });
  }
}
