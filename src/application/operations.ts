import { canApprove, canApproveOwn, type CompanyActor } from './company-roles.ts';
import { canOperate, type OperationalActor } from './order-permissions.ts';
import { fail, type Product } from '../domain/catalog.ts';
export type Actor = OperationalActor;
export { deliveryBusinessDate } from './business-calendar.ts';
import { deliveryBusinessDate } from './business-calendar.ts';
export type Purchase = {
  replenishmentId?: string;
  replenishmentSignature?: string;
  id: string;
  version: number;
  createdBy: string;
  createdAt: string;
  supplierId: string;
  supplierName: string;
  reason: string;
  status:
    | 'draft'
    | 'approved'
    | 'sent'
    | 'partially_received'
    | 'received'
    | 'cancelled'
    | 'rejected'
    | 'changes_requested';
  sentAt?: string;
  expectedDate?: string;
  deliveries?: {
    id: string;
    reference: string;
    at: string;
    legacy?: true;
    lines: { productId: string; quantity: number; cancelledReceiptId?: string }[];
  }[];
  review?: { actor: string; reason: string; at: string };
  replacesId?: string;
  replacementId?: string;
  lines: {
    productId: string;
    sku: string;
    name: string;
    quantity: number;
    costCents: number;
    baseVersion: number;
    offerVersion?: number;
    packUnits?: number;
    leadDays?: number;
  }[];
  totalCents: number;
  approvedBy?: string;
  reference?: string;
};
export function receivedPurchaseQuantity(purchase: Purchase, productId: string) {
  if (!purchase.deliveries)
    return purchase.status === 'received'
      ? (purchase.lines.find((line) => line.productId === productId)?.quantity ?? 0)
      : 0;
  return purchase.deliveries.reduce(
    (total, delivery) =>
      total +
      (delivery.lines.find((line) => line.productId === productId && !line.cancelledReceiptId)
        ?.quantity ?? 0),
    0,
  );
}
export type Incident = {
  id: string;
  version: number;
  orderId: string;
  kind: string;
  description: string;
  status: 'open' | 'investigating' | 'resolved';
  resolution: string;
  createdBy: string;
  createdAt: string;
};
export interface DocumentRepository<T extends { id: string; version: number }> {
  get(id: string): T | undefined;
  all(): T[];
  save(value: T, expected: number): void;
  transaction<R>(op: () => R): R;
  record(actor: string, action: string, detail: unknown): void;
}
export function text(value: unknown, min = 1, max = 300): string {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max)
    fail(400, 'INVALID_TEXT', `Introduce un texto de ${min} a ${max} caracteres.`);
  return value.trim();
}
export function integer(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
    fail(400, 'INVALID_NUMBER', 'Cantidad o versión fuera de rango.');
  return value as number;
}
export function fields(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some((k) => !allowed.includes(k)))
    fail(400, 'INVALID_FIELDS', 'Hay campos no permitidos.');
}
export function editor(actor: Actor) {
  if (actor.role !== 'editor') fail(403, 'FORBIDDEN', 'Esta operación requiere edición.');
}
export function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail(400, 'INVALID_INPUT', 'Datos no válidos.');
  return input as Record<string, unknown>;
}
export class Purchases {
  private repo: DocumentRepository<Purchase>;
  private catalog: () => Product[];
  private supplier: (id: string) => { name: string; active: number } | undefined;
  private receive: (
    actor: Actor,
    purchase: Purchase,
    reference: string,
    deliveryId?: string,
  ) => void;
  private next: () => string;
  private now: () => string;
  private offer?: (
    supplierId: string,
    productId: string,
  ) => { costCents: number; packUnits: number; leadDays: number; version: number } | undefined;
  constructor(
    repo: DocumentRepository<Purchase>,
    catalog: () => Product[],
    supplier: (id: string) => { name: string; active: number } | undefined,
    receive: (actor: Actor, purchase: Purchase, reference: string, deliveryId?: string) => void,
    next: () => string,
    now: () => string,
    offer?: (
      supplierId: string,
      productId: string,
    ) => { costCents: number; packUnits: number; leadDays: number; version: number } | undefined,
  ) {
    this.repo = repo;
    this.catalog = catalog;
    this.supplier = supplier;
    this.receive = receive;
    this.next = next;
    this.now = now;
    if (offer) this.offer = offer;
  }
  create(actor: Actor, body: Record<string, unknown>) {
    editor(actor);
    fields(body, ['supplierId', 'reason', 'lines', 'requestId', 'replacesId']);
    const replacesId = body.replacesId === undefined ? undefined : text(body.replacesId, 16, 80);
    const requestId = body.requestId === undefined ? this.next() : text(body.requestId, 16, 80);
    if (!/^[\w-]+$/.test(requestId)) fail(400, 'INVALID_ID', 'Referencia no válida.');
    const supplierId = text(body.supplierId, 1, 80),
      reason = text(body.reason, 5, 300);
    if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 30)
      fail(400, 'INVALID_LINES', 'Selecciona entre 1 y 30 artículos.');
    return this.repo.transaction(() => {
      const previous = this.repo.get(requestId);
      if (previous) {
        const original = previous.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
        }));
        if (
          previous.createdBy !== actor.id ||
          previous.replacesId !== replacesId ||
          previous.supplierId !== supplierId ||
          previous.reason !== reason ||
          JSON.stringify(original) !== JSON.stringify(body.lines)
        )
          fail(409, 'PURCHASE_REUSED', 'Operación de compra usada con otros datos.');
        return previous;
      }
      const supplier = this.supplier(supplierId);
      if (!supplier?.active) fail(409, 'SUPPLIER_UNAVAILABLE', 'Selecciona un proveedor activo.');
      const catalog = this.catalog(),
        seen = new Set<string>();
      const lines = (body.lines as unknown[]).map((raw) => {
        const r = object(raw);
        fields(r, ['productId', 'quantity']);
        const product = catalog.find((p) => p.id === r.productId);
        if (!product || seen.has(product.id))
          fail(400, 'INVALID_PRODUCT', 'Artículo desconocido o repetido.');
        seen.add(product.id);
        const offer = this.offer?.(supplierId, product.id);
        const quantity = integer(r.quantity, 1, 10000);
        if (this.offer && !offer)
          fail(409, 'SUPPLIER_PRODUCT', 'El proveedor no suministra este artículo.');
        if (offer && quantity % offer.packUnits !== 0)
          fail(
            400,
            'SUPPLIER_PACK',
            'La cantidad debe ser múltiplo de ' + offer.packUnits + ' unidades.',
          );
        return {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          quantity,
          costCents: offer?.costCents ?? product.costCents,
          ...(offer
            ? { offerVersion: offer.version, packUnits: offer.packUnits, leadDays: offer.leadDays }
            : {}),
          baseVersion: product.version,
        };
      });
      const value: Purchase = {
        ...(replacesId ? { replacesId } : {}),
        id: requestId,
        version: 1,
        createdBy: actor.id,
        createdAt: this.now(),
        supplierId,
        supplierName: supplier.name,
        reason,
        status: 'draft',
        lines,
        totalCents: lines.reduce((s, l) => s + l.costCents * l.quantity, 0),
      };
      if (!Number.isSafeInteger(value.totalCents))
        fail(400, 'INVALID_TOTAL', 'Importe fuera de rango.');
      if (replacesId) {
        const original = this.repo.get(replacesId);
        if (
          !original ||
          !['changes_requested', 'rejected'].includes(original.status) ||
          original.replacementId
        )
          fail(409, 'INVALID_REPLACEMENT', 'La propuesta original no admite otra alternativa.');
        this.repo.save(
          { ...original, version: original.version + 1, replacementId: value.id },
          original.version,
        );
      }
      this.repo.save(value, 0);
      this.repo.record(actor.id, 'purchase.created', value);
      return value;
    });
  }
  createReplenishment(actor: Actor, body: Record<string, unknown>) {
    editor(actor);
    fields(body, ['requestId', 'reason', 'lines']);
    const id = text(body.requestId, 16, 60),
      reason = text(body.reason, 5, 300);
    if (
      !/^[a-zA-Z0-9-]+$/.test(id) ||
      !Array.isArray(body.lines) ||
      !body.lines.length ||
      body.lines.length > 60
    )
      fail(400, 'INVALID_REPLENISHMENT', 'Revisa referencia y líneas (1–60).');
    const lines = body.lines
      .map((raw) => {
        const line = object(raw);
        fields(line, ['supplierId', 'productId', 'quantity']);
        return {
          supplierId: text(line.supplierId, 1, 80),
          productId: text(line.productId, 1, 80),
          quantity: integer(line.quantity, 1, 10000),
        };
      })
      .sort(
        (a, b) =>
          a.supplierId.localeCompare(b.supplierId) || a.productId.localeCompare(b.productId),
      );
    if (
      new Set(lines.map((line) => JSON.stringify([line.supplierId, line.productId]))).size !==
      lines.length
    )
      fail(400, 'DUPLICATE_LINE', 'Unifica las unidades de cada artículo del mismo proveedor.');
    const signature = JSON.stringify({ author: actor.id, reason, lines });
    return this.repo.transaction(() => {
      const previous = this.repo.all().filter((p) => p.replenishmentId === id);
      if (previous.length) {
        if (previous.some((p) => p.replenishmentSignature !== signature))
          fail(409, 'REPLENISHMENT_REUSED', 'Referencia utilizada con otra reposición.');
        return previous;
      }
      const suppliers = [...new Set(lines.map((line) => line.supplierId))];
      if (suppliers.length > 20)
        fail(400, 'TOO_MANY_SUPPLIERS', 'Máximo 20 proveedores por reposición.');
      if (suppliers.some((_, index) => this.repo.get(id + '-' + index)))
        fail(409, 'REPLENISHMENT_REUSED', 'Una referencia de compra ya existe.');
      const created = suppliers.map((supplierId, index) => {
        const purchase = this.create(actor, {
          requestId: id + '-' + index,
          supplierId,
          reason,
          lines: lines
            .filter((line) => line.supplierId === supplierId)
            .map(({ productId, quantity }) => ({ productId, quantity })),
        });
        const result = {
          ...purchase,
          version: purchase.version + 1,
          replenishmentId: id,
          replenishmentSignature: signature,
        };
        this.repo.save(result, purchase.version);
        return result;
      });
      this.repo.record(actor.id, 'purchase.replenishment-created', {
        id,
        purchases: created.map((p) => p.id),
        totalCents: created.reduce((sum, p) => sum + p.totalCents, 0),
      });
      return created;
    });
  }
  transition(actor: Actor, id: string, body: Record<string, unknown>) {
    if (
      actor.businessRole === 'office' &&
      ['receive', 'receive-partial'].includes(String(body.action))
    )
      fail(403, 'WAREHOUSE_REQUIRED', 'Mario debe confirmar la recepción física.');
    fields(body, [
      'action',
      'expectedVersion',
      'reference',
      'confirmReceived',
      'reason',
      'requestId',
      'lines',
    ]);
    if (['approve', 'reject', 'request-changes'].includes(String(body.action))) {
      if (!canApprove(actor))
        fail(403, 'FORBIDDEN', 'La aprobación requiere revisión independiente.');
    } else if (!(
      ['receive', 'receive-partial'].includes(String(body.action)) &&
      canOperate(actor, 'warehouse.receive')
    ))
      editor(actor);
    return this.repo.transaction(() => {
      const p = this.repo.get(id);
      if (!p) fail(404, 'PURCHASE_MISSING', 'Compra no encontrada.');
      if (body.action === 'receive-partial' && typeof body.requestId === 'string') {
        const prior = p.deliveries?.find((d) => d.id === body.requestId);
        if (prior) {
          const supplied = body.lines;
          if (
            prior.reference !== text(body.reference, 1, 100) ||
            !Array.isArray(supplied) ||
            supplied.length !== prior.lines.length ||
            !supplied.every((raw, index) => {
              const line = object(raw);
              fields(line, ['productId', 'quantity']);
              return (
                line.productId === prior.lines[index]!.productId &&
                line.quantity === prior.lines[index]!.quantity
              );
            })
          )
            fail(409, 'DELIVERY_REUSED', 'Referencia de operación usada con otra entrega.');
          if (prior.lines.some((line) => line.cancelledReceiptId))
            fail(
              409,
              'DELIVERY_CANCELLED',
              'La entrega contiene una línea anulada. Registra la corrección con una referencia nueva.',
            );
          return p;
        }
      }
      if (p.version !== integer(body.expectedVersion, 1, 1000000))
        fail(409, 'PURCHASE_CHANGED', 'La compra ha cambiado. Actualiza.');
      const next = { ...p, version: p.version + 1 };
      if (
        ['approve', 'reject', 'request-changes'].includes(String(body.action)) &&
        p.createdBy === actor.id &&
        !canApproveOwn(actor)
      )
        fail(403, 'SAME_AUTHOR', 'Otra persona debe revisar la compra.');
      if (['reject', 'request-changes'].includes(String(body.action)) && p.status === 'draft') {
        next.status = body.action === 'reject' ? 'rejected' : 'changes_requested';
        next.review = { actor: actor.id, reason: text(body.reason, 5, 300), at: this.now() };
      } else if (body.action === 'approve' && p.status === 'draft') {
        if (p.createdBy === actor.id && !canApproveOwn(actor))
          fail(403, 'SAME_AUTHOR', 'Otra persona debe revisar la compra.');
        if (
          !this.supplier(p.supplierId)?.active ||
          p.lines.some(
            (l) =>
              !this.catalog().some(
                (c) =>
                  c.id === l.productId &&
                  (l.offerVersion !== undefined
                    ? this.offer?.(p.supplierId, l.productId)?.version === l.offerVersion &&
                      this.offer?.(p.supplierId, l.productId)?.costCents === l.costCents
                    : c.version === l.baseVersion && c.costCents === l.costCents),
              ),
          )
        )
          fail(
            409,
            'PURCHASE_STALE',
            'Proveedor o catálogo cambiaron. Cancela y prepara una compra actualizada.',
          );
        next.status = 'approved';
        next.approvedBy = actor.id;
      } else if (body.action === 'send' && p.status === 'approved') {
        next.sentAt = this.now();
        next.expectedDate = deliveryBusinessDate(
          next.sentAt,
          Math.max(...p.lines.map((l) => l.leadDays ?? 3)),
        );
        next.status = 'sent';
      } else if (
        body.action === 'receive-partial' &&
        ['sent', 'partially_received'].includes(p.status)
      ) {
        if (body.confirmReceived !== true)
          fail(400, 'NOT_RECEIVED', 'Confirma que las unidades han llegado.');
        const deliveryId = text(body.requestId, 16, 80),
          reference = text(body.reference, 1, 100);
        if (
          !/^[a-zA-Z0-9-]+$/.test(deliveryId) ||
          !Array.isArray(body.lines) ||
          !body.lines.length ||
          body.lines.length > 30
        )
          fail(400, 'INVALID_LINES', 'Revisa la entrega.');
        const seen = new Set<string>();
        const received = body.lines.map((raw) => {
          const line = object(raw);
          fields(line, ['productId', 'quantity']);
          const original = p.lines.find((l) => l.productId === line.productId);
          if (!original || seen.has(original.productId))
            fail(400, 'INVALID_PRODUCT', 'Artículo repetido o ajeno a la compra.');
          seen.add(original.productId);
          const quantity = integer(line.quantity, 1, 10000),
            already = receivedPurchaseQuantity(p, original.productId);
          if (quantity > original.quantity - already)
            fail(409, 'EXCESS_RECEIPT', 'No puedes recibir más unidades de las pendientes.');
          return { productId: original.productId, quantity };
        });
        this.receive(
          actor,
          {
            ...p,
            lines: received.map((line) => ({
              ...p.lines.find((l) => l.productId === line.productId)!,
              quantity: line.quantity,
            })),
          },
          reference,
          deliveryId,
        );
        next.deliveries = [
          ...(p.deliveries ?? []),
          { id: deliveryId, reference, at: this.now(), lines: received },
        ];
        next.reference = reference;
        next.status = p.lines.every(
          (line) => receivedPurchaseQuantity(next, line.productId) === line.quantity,
        )
          ? 'received'
          : 'partially_received';
      } else if (body.action === 'receive' && p.status === 'approved') {
        if (body.confirmReceived !== true)
          fail(400, 'NOT_RECEIVED', 'Confirma que has recibido todas las unidades.');
        next.reference = text(body.reference, 1, 100);
        // Receipt creation and purchase completion share the same outer transaction.
        this.receive(actor, p, next.reference);
        next.status = 'received';
      } else if (body.action === 'cancel' && ['draft', 'approved'].includes(p.status))
        next.status = 'cancelled';
      else fail(409, 'INVALID_TRANSITION', 'Este cambio no está permitido.');
      this.repo.save(next, p.version);
      this.repo.record(actor.id, 'purchase.' + next.status, {
        id,
        reference: next.reference,
        review: next.review,
      });
      return next;
    });
  }
}
export class Incidents {
  private repo: DocumentRepository<Incident>;
  private hasOrder: (id: string) => boolean;
  private next: () => string;
  private now: () => string;
  constructor(
    repo: DocumentRepository<Incident>,
    hasOrder: (id: string) => boolean,
    next: () => string,
    now: () => string,
  ) {
    this.repo = repo;
    this.hasOrder = hasOrder;
    this.next = next;
    this.now = now;
  }
  create(actor: Actor, body: Record<string, unknown>) {
    editor(actor);
    fields(body, ['orderId', 'kind', 'description']);
    const orderId = text(body.orderId, 1, 80),
      description = text(body.description, 10, 1000),
      kind = text(body.kind, 1, 40);
    if (!['damage', 'wrong-item', 'delivery', 'other'].includes(kind))
      fail(400, 'INVALID_KIND', 'Tipo de incidencia no válido.');
    return this.repo.transaction(() => {
      if (!this.hasOrder(orderId)) fail(404, 'ORDER_MISSING', 'Pedido no encontrado.');
      const value: Incident = {
        id: this.next(),
        version: 1,
        orderId,
        kind,
        description,
        status: 'open',
        resolution: '',
        createdBy: actor.id,
        createdAt: this.now(),
      };
      this.repo.save(value, 0);
      this.repo.record(actor.id, 'incident.created', { id: value.id, orderId, kind });
      return value;
    });
  }
  update(actor: Actor, id: string, body: Record<string, unknown>) {
    editor(actor);
    fields(body, ['expectedVersion', 'status', 'resolution']);
    const status = text(body.status),
      resolution = text(body.resolution, 5, 1000);
    if (!['investigating', 'resolved'].includes(status))
      fail(400, 'INVALID_STATUS', 'Estado no permitido.');
    return this.repo.transaction(() => {
      const prior = this.repo.get(id);
      if (!prior) fail(404, 'INCIDENT_MISSING', 'Incidencia no encontrada.');
      if (
        prior.version !== integer(body.expectedVersion, 1, 1000000) ||
        prior.status === 'resolved'
      )
        fail(409, 'INCIDENT_CHANGED', 'La incidencia ha cambiado o está cerrada.');
      const value = {
        ...prior,
        status: status as Incident['status'],
        resolution,
        version: prior.version + 1,
      };
      this.repo.save(value, prior.version);
      this.repo.record(actor.id, 'incident.updated', { id, status, resolution });
      return value;
    });
  }
}
