import { canApprove, canApproveOwn, type CompanyActor } from './company-roles.ts';
import { fail } from '../domain/catalog.ts';
import type { Product } from '../domain/catalog.ts';
import { parseTariffCsv } from '../domain/tariff-csv.ts';
export type TariffChange = {
  productId: string;
  sku: string;
  name: string;
  baseVersion: number;
  priceCents: number;
  beforeCostCents: number;
  afterCostCents: number;
};
export type TariffBatch = {
  reason?: string;
  target?: 'supplier-offer';
  source?: TariffSource;
  id: string;
  supplierId: string;
  supplierName: string;
  reference: string;
  createdBy: string;
  createdAt: string;
  digest: string;
  status: 'ready' | 'blocked' | 'applied';
  changes: TariffChange[];
  rows: { sku: string; costCents: number; state: 'new' | 'changed' | 'same' }[];
  appliedBy?: string;
  appliedAt?: string;
};
export type TariffSource = {
  id: string;
  filename: string;
  format: string;
  origin: string;
  uploadedBy: string;
  uploadedAt: string;
  sha256: string;
  text: string;
  modelUsed: boolean;
  reviewedManually?: true;
};
export interface TariffRepository {
  products(): Product[];
  supplier(id: string): { name: string; active: number } | undefined;
  batch(id: string): TariffBatch | undefined;
  existing(supplierId: string, reference: string): TariffBatch | undefined;
  latest(): TariffBatch[];
  save(batch: TariffBatch): void;
  updateCost(change: TariffChange): boolean;
  transaction<T>(op: () => T): T;
  record(actor: string, action: string, detail: unknown): void;
  offer(supplierId: string, productId: string): { costCents: number; version: number } | undefined;
  updateOffer(supplierId: string, change: TariffChange): boolean;
  source(id: string): TariffSource | undefined;
}
export class ManageTariffs {
  repo: TariffRepository;
  hash: (v: unknown) => string;
  next: () => string;
  clock: () => string;
  constructor(
    repo: TariffRepository,
    hash: (v: unknown) => string,
    next: () => string,
    clock: () => string = () => new Date().toISOString(),
  ) {
    this.repo = repo;
    this.hash = hash;
    this.next = next;
    this.clock = clock;
  }
  preview(actor: CompanyActor, input: Record<string, unknown>) {
    if (actor.role !== 'editor') fail(403, 'FORBIDDEN', 'Solo edición puede preparar tarifas.');
    if (
      Object.keys(input).some(
        (k) => !['csv', 'supplierId', 'reference', 'target', 'sourceId', 'reason'].includes(k),
      ) ||
      (input.target !== undefined && input.target !== 'supplier-offer') ||
      (input.reason !== undefined &&
        (typeof input.reason !== 'string' ||
          input.reason.trim().length < 5 ||
          input.reason.length > 500)) ||
      typeof input.supplierId !== 'string' ||
      typeof input.reference !== 'string' ||
      !input.reference.trim() ||
      input.reference.length > 100
    )
      fail(400, 'INVALID_TARIFF', 'Indica proveedor y referencia de tarifa.');
    const parsed = parseTariffCsv(input.csv),
      supplierId = input.supplierId,
      reference = input.reference.trim();
    return this.repo.transaction(() => {
      const supplier = this.repo.supplier(supplierId);
      if (!supplier?.active) fail(409, 'SUPPLIER_UNAVAILABLE', 'Selecciona proveedor activo.');
      const products = this.repo.products(),
        changes: TariffChange[] = [];
      const target = input.target as 'supplier-offer' | undefined;
      const source =
        input.sourceId === undefined
          ? undefined
          : typeof input.sourceId === 'string'
            ? this.repo.source(input.sourceId)
            : undefined;
      if (input.sourceId !== undefined && (!source || source.uploadedBy !== actor.id))
        fail(400, 'TARIFF_SOURCE', 'Documento de origen no válido.');
      const rows = parsed.map((row) => {
        const product = products.find((p) => p.sku.toUpperCase() === row.sku);
        const offer = product && target ? this.repo.offer(supplierId, product.id) : undefined;
        const known = product && (!target || offer);
        const before = target ? offer?.costCents : product?.costCents;
        if (known && before !== row.costCents)
          changes.push({
            productId: product.id,
            sku: product.sku,
            name: product.name,
            baseVersion: target ? offer!.version : product.version,
            priceCents: product.priceCents,
            beforeCostCents: before!,
            afterCostCents: row.costCents,
          });
        return {
          ...row,
          state: !known
            ? ('new' as const)
            : before === row.costCents
              ? ('same' as const)
              : ('changed' as const),
        };
      });
      const provenance = {
        ...(target ? { target } : {}),
        ...(source ? { source } : {}),
        ...(typeof input.reason === 'string' ? { reason: input.reason.trim() } : {}),
      };
      const digest = this.hash({ supplierId, reference, rows, changes, ...provenance }),
        prior = this.repo.existing(supplierId, reference);
      if (prior) {
        if (prior.digest !== digest || prior.createdBy !== actor.id)
          fail(
            409,
            'TARIFF_REFERENCE',
            'Referencia usada con otros datos o una versión anterior. Usa otra referencia.',
          );
        return prior;
      }
      const batch: TariffBatch = {
        ...provenance,
        id: this.next(),
        supplierId,
        supplierName: supplier.name,
        reference,
        createdBy: actor.id,
        createdAt: this.clock(),
        digest,
        status: rows.some((r) => r.state === 'new') || !changes.length ? 'blocked' : 'ready',
        rows,
        changes,
      };
      this.repo.save(batch);
      this.repo.record(actor.id, 'tariff.prepared', {
        id: batch.id,
        reference,
        changes: changes.length,
        unknown: rows.filter((r) => r.state === 'new').length,
      });
      return batch;
    });
  }
  apply(actor: CompanyActor, id: string, input: Record<string, unknown>) {
    if (!canApprove(actor)) fail(403, 'FORBIDDEN', 'Se requiere una cuenta revisora distinta.');
    return this.repo.transaction(() => {
      const batch = this.repo.batch(id);
      if (!batch) fail(404, 'TARIFF_NOT_FOUND', 'Tarifa no encontrada.');
      if (batch.createdBy === actor.id && !canApproveOwn(actor))
        fail(403, 'OWN_TARIFF', 'El autor no revisa su tarifa.');
      if (batch.source && this.hash(this.repo.source(batch.source.id)) !== this.hash(batch.source))
        fail(409, 'TARIFF_SOURCE', 'El documento de origen ha cambiado.');
      if (Object.keys(input).join(',') !== 'digest' || input.digest !== batch.digest)
        fail(409, 'TARIFF_DIGEST', 'Revisa la versión exacta.');
      if (
        this.hash({
          supplierId: batch.supplierId,
          reference: batch.reference,
          rows: batch.rows,
          changes: batch.changes,
          ...(batch.target ? { target: batch.target } : {}),
          ...(batch.source ? { source: batch.source } : {}),
          ...(batch.reason ? { reason: batch.reason } : {}),
        }) !== batch.digest
      )
        fail(409, 'TARIFF_DIGEST', 'El contenido guardado no coincide con la revisión.');
      if (batch.status === 'applied') return batch;
      if (batch.status !== 'ready')
        fail(
          409,
          'TARIFF_BLOCKED',
          'Hay referencias desconocidas o ningún coste cambiado. Crea artículos manualmente o corrige el CSV.',
        );
      if (!this.repo.supplier(batch.supplierId)?.active)
        fail(409, 'SUPPLIER_UNAVAILABLE', 'Proveedor no activo.');
      for (const row of batch.rows.filter((r) => r.state === 'same')) {
        const p = this.repo.products().find((p) => p.sku.toUpperCase() === row.sku);
        if (
          !p ||
          (batch.target ? this.repo.offer(batch.supplierId, p.id)?.costCents : p.costCents) !==
            row.costCents
        )
          fail(409, 'TARIFF_STALE', 'Las referencias sin cambio también deben seguir vigentes.');
      }
      for (const change of batch.changes)
        if (
          !(batch.target
            ? this.repo.updateOffer(batch.supplierId, change)
            : this.repo.updateCost(change))
        )
          fail(409, 'TARIFF_STALE', 'El catálogo ha cambiado. Prepara una tarifa nueva.');
      const applied = {
        ...batch,
        status: 'applied' as const,
        appliedBy: actor.id,
        appliedAt: this.clock(),
      };
      this.repo.save(applied);
      this.repo.record(actor.id, 'tariff.applied', {
        id,
        reference: batch.reference,
        changes: batch.changes,
      });
      return applied;
    });
  }
}
