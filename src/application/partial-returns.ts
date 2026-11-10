import { canOperate } from './order-permissions.ts';
import { needsOwnerDecision } from './company-roles.ts';
import type { Sale } from './commerce.ts';
import { fail } from '../domain/catalog.ts';
import {
  editor,
  fields,
  integer,
  text,
  type Actor,
  type DocumentRepository,
} from './operations.ts';
export type PartialReturn = {
  id: string;
  version: number;
  orderId: string;
  productId: string;
  quantity: number;
  condition?: 'sellable' | 'damaged';
  reason: string;
  createdAt: string;
  createdBy: string;
  baseCents: number | null;
  grossCents: number;
  disposal?: { at: string; by: string; reason: string; reference?: string };
};
export function returnedValue(sale: Sale) {
  return (sale.returnedQuantities ?? []).reduce((sum, r) => {
    const l = sale.lines.find((l) => l.productId === r.productId)!;
    // Allocate a line's original tax cumulatively so successive returns conserve every cent.
    return (
      sum +
      l.unitPriceCents * r.quantity +
      (sale.tax
        ? Math.round(
            (Math.round((l.unitPriceCents * l.quantity * 21) / 100) * r.quantity) / l.quantity,
          )
        : 0)
    );
  }, 0);
}
export function remainingSale(sale: Sale): Sale {
  if (!sale.returnedQuantities?.length) return sale;
  const lines = sale.lines
    .map((l) => ({
      ...l,
      quantity:
        l.quantity -
        (sale.returnedQuantities?.find((r) => r.productId === l.productId)?.quantity ?? 0),
    }))
    .filter((l) => l.quantity > 0);
  const totalCents = lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0),
    costCents = lines.reduce((s, l) => s + l.quantity * l.unitCostCents, 0);
  const gross = (sale.tax?.totalCents ?? sale.totalCents) - returnedValue(sale);
  return {
    ...sale,
    lines,
    totalCents,
    costCents,
    ...(sale.tax
      ? {
          tax: {
            ...sale.tax,
            baseCents: totalCents,
            taxCents: gross - totalCents,
            totalCents: gross,
          },
        }
      : {}),
  };
}
export class PartialReturns {
  private repo: DocumentRepository<PartialReturn>;
  private sale: (id: string) => Sale | undefined;
  private apply: (value: PartialReturn, updated: Sale) => void;
  private now: () => string;
  constructor(
    repo: DocumentRepository<PartialReturn>,
    sale: (id: string) => Sale | undefined,
    apply: (value: PartialReturn, updated: Sale) => void,
    now: () => string,
  ) {
    this.repo = repo;
    this.sale = sale;
    this.apply = apply;
    this.now = now;
  }
  execute(actor: Actor, body: Record<string, unknown>) {
    if (actor.businessRole === 'office')
      fail(403, 'WAREHOUSE_REQUIRED', 'La recepción física corresponde al almacén.');
    if (!canOperate(actor, 'warehouse.receive')) editor(actor);
    fields(body, [
      'requestId',
      'orderId',
      'productId',
      'quantity',
      'condition',
      'expectedReturned',
      'reason',
      'confirmReceived',
    ]);
    const id = text(body.requestId, 16, 80);
    if (!/^[\w-]+$/.test(id)) fail(400, 'INVALID_ID', 'Referencia no válida.');
    const orderId = text(body.orderId, 1, 80),
      productId = text(body.productId, 1, 80),
      quantity = integer(body.quantity, 1, 100),
      expected = integer(body.expectedReturned, 0, 100),
      reason = text(body.reason, 5, 300);
    const condition = body.condition === undefined ? 'sellable' : body.condition;
    if (condition !== 'sellable' && condition !== 'damaged')
      fail(400, 'INVALID_RETURN_CONDITION', 'Selecciona el estado físico de las unidades.');
    if (body.confirmReceived !== true)
      fail(400, 'NOT_RECEIVED', 'Confirma que has recibido y comprobado las unidades.');
    return this.repo.transaction(() => {
      const old = this.repo.get(id);
      if (old) {
        if (
          old.createdBy !== actor.id ||
          old.orderId !== orderId ||
          old.productId !== productId ||
          old.quantity !== quantity ||
          (old.condition ?? 'sellable') !== condition ||
          old.reason !== reason
        )
          fail(409, 'RETURN_REUSED', 'Operación usada con otros datos.');
        return old;
      }
      const sale = this.sale(orderId);
      if (!sale || sale.status !== 'shipped')
        fail(409, 'NOT_SHIPPED', 'Solo pedidos enviados admiten esta devolución.');
      const line = sale.lines.find((l) => l.productId === productId),
        prior = sale.returnedQuantities?.find((r) => r.productId === productId)?.quantity ?? 0;
      if (!line || prior !== expected || quantity > line.quantity - prior)
        fail(409, 'RETURN_CHANGED', 'Revisa las unidades aún pendientes de devolver.');
      const totals = (sale.returnedQuantities ?? [])
        .filter((r) => r.productId !== productId)
        .concat({ productId, quantity: prior + quantity });
      const updated: Sale = { ...sale, returnedQuantities: totals };
      if (
        sale.lines.every((l) =>
          totals.some((r) => r.productId === l.productId && r.quantity === l.quantity),
        )
      )
        updated.status = 'returned';
      const value: PartialReturn = {
        id,
        version: 1,
        orderId,
        productId,
        quantity,
        condition,
        reason,
        createdAt: this.now(),
        createdBy: actor.id,
        baseCents: sale.tax ? line.unitPriceCents * quantity : null,
        grossCents: returnedValue(updated) - returnedValue(sale),
      };
      this.apply(value, updated);
      this.repo.save(value, 0);
      this.repo.record(actor.id, 'order.partial-returned', value);
      return value;
    });
  }

  dispose(actor: Actor, id: string, body: Record<string, unknown>) {
    if (
      !canOperate(actor, 'warehouse.damage') ||
      (actor.profile !== 'warehouse' && needsOwnerDecision(actor))
    )
      fail(403, 'WAREHOUSE_REQUIRED', 'El almacén debe confirmar la baja física.');
    fields(body, ['expectedVersion', 'reason', 'reference', 'confirmDisposed']);
    const expectedVersion = integer(body.expectedVersion, 1, 1000000);
    const reason = text(body.reason, 5, 300);
    const reference = body.reference === undefined ? undefined : text(body.reference, 1, 100);
    if (body.confirmDisposed !== true)
      fail(
        400,
        'DISPOSAL_NOT_CONFIRMED',
        'Confirma que has retirado físicamente todas las unidades.',
      );

    return this.repo.transaction(() => {
      const current = this.repo.get(id);
      if (!current) fail(404, 'RETURN_NOT_FOUND', 'Devolución no encontrada.');
      if (current.condition !== 'damaged')
        fail(
          409,
          'NOT_DAMAGED_RETURN',
          'Solo se puede dar de baja mercancía devuelta como dañada.',
        );
      if (current.disposal) {
        if (
          current.version === expectedVersion + 1 &&
          current.disposal.by === actor.id &&
          current.disposal.reason === reason &&
          current.disposal.reference === reference
        )
          return current;
        fail(
          409,
          'RETURN_ALREADY_DISPOSED',
          'La baja física de esta devolución ya está registrada.',
        );
      }
      if (current.version !== expectedVersion)
        fail(409, 'RETURN_CHANGED', 'La devolución ha cambiado. Actualiza la pantalla.');
      const disposal = {
        at: this.now(),
        by: actor.id,
        reason,
        ...(reference ? { reference } : {}),
      };
      const updated = { ...current, version: current.version + 1, disposal };
      // Damaged units never entered sellable stock, so this is solely a physical disposition record.
      this.repo.save(updated, current.version);
      this.repo.record(actor.id, 'order.damaged-return-disposed', {
        id,
        orderId: current.orderId,
        productId: current.productId,
        quantity: current.quantity,
        disposal,
      });
      return updated;
    });
  }
}
