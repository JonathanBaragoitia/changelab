import type { OperationalActor } from './order-permissions.ts';
import { fail } from '../domain/catalog.ts';
import type { Sale } from './commerce.ts';
export type StockAdjustment = {
  requestId: string;
  productId: string;
  delta: number;
  expectedQuantity: number;
  reason: string;
  actorId: string;
  at: string;
};
export type GoodsReturn = { orderId: string; reason: string; actorId: string; at: string };
export interface WarehouseRepository {
  transaction<T>(operation: () => T): T;
  sale(id: string): Sale | undefined;
  goodsReturn(id: string): GoodsReturn | undefined;
  saveReturn(value: GoodsReturn): void;
  adjustment(id: string): StockAdjustment | undefined;
  applyAdjustment(value: StockAdjustment): void;
  record(actor: string, action: string, detail: unknown): void;
}
function reason(input: unknown) {
  if (typeof input !== 'string' || input.trim().length < 5 || input.length > 500)
    fail(400, 'INVALID_REASON', 'Indica un motivo de entre 5 y 500 caracteres.');
  return input.trim();
}
export class Warehouse {
  private repository: WarehouseRepository;
  private now: () => string;
  constructor(repository: WarehouseRepository, now: () => string) {
    this.repository = repository;
    this.now = now;
  }
  returnAll(actor: OperationalActor, orderId: string, input: unknown) {
    if (actor.businessRole === 'office')
      fail(403, 'WAREHOUSE_REQUIRED', 'Esta operación corresponde a almacén o dirección.');
    if (actor.role !== 'editor')
      fail(403, 'FORBIDDEN', 'Solo una cuenta editora puede registrar devoluciones.');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail(400, 'INVALID_RETURN', 'Datos no válidos.');
    const body = input as Record<string, unknown>;
    if (
      Object.keys(body).some((key) => !['reason', 'confirmReceived'].includes(key)) ||
      body.confirmReceived !== true
    )
      fail(
        400,
        'INVALID_RETURN',
        'Confirma que se recibió toda la mercancía y es apta para reponer.',
      );
    const note = reason(body.reason);
    return this.repository.transaction(() => {
      const previous = this.repository.goodsReturn(orderId);
      if (previous) {
        if (previous.reason !== note)
          fail(409, 'ALREADY_RETURNED', 'El pedido ya se devolvió con otro motivo.');
        return previous;
      }
      const sale = this.repository.sale(orderId);
      if (!sale || sale.status !== 'shipped')
        fail(409, 'NOT_SHIPPED', 'Solo se reciben devoluciones de pedidos enviados.');
      if (sale.returnedQuantities?.length)
        fail(
          409,
          'PARTIAL_RETURN_EXISTS',
          'Hay devoluciones parciales. Devuelve las unidades restantes desde Devoluciones parciales.',
        );
      const value = { orderId, reason: note, actorId: actor.id, at: this.now() };
      this.repository.saveReturn(value);
      this.repository.record(actor.id, 'order.goods-returned', {
        ...value,
        units: sale.lines.reduce((sum, line) => sum + line.quantity, 0),
      });
      return value;
    });
  }
  adjust(actor: OperationalActor, input: unknown) {
    if (actor.businessRole === 'office')
      fail(403, 'WAREHOUSE_REQUIRED', 'Esta operación corresponde a almacén o dirección.');
    if (actor.role !== 'editor')
      fail(403, 'FORBIDDEN', 'Solo una cuenta editora puede ajustar existencias.');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail(400, 'INVALID_ADJUSTMENT', 'Ajuste no válido.');
    const body = input as Record<string, unknown>;
    if (
      Object.keys(body).some(
        (key) => !['requestId', 'productId', 'delta', 'expectedQuantity', 'reason'].includes(key),
      ) ||
      typeof body.requestId !== 'string' ||
      !/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId) ||
      typeof body.productId !== 'string' ||
      !body.productId ||
      !Number.isSafeInteger(body.delta) ||
      body.delta === 0 ||
      Math.abs(body.delta as number) > 10000 ||
      !Number.isSafeInteger(body.expectedQuantity) ||
      (body.expectedQuantity as number) < 0
    )
      fail(
        400,
        'INVALID_ADJUSTMENT',
        'Revisa producto, stock revisado y variación entera (±10.000).',
      );
    const value: StockAdjustment = {
      requestId: body.requestId,
      productId: body.productId,
      delta: body.delta as number,
      expectedQuantity: body.expectedQuantity as number,
      reason: reason(body.reason),
      actorId: actor.id,
      at: this.now(),
    };
    return this.repository.transaction(() => {
      const old = this.repository.adjustment(value.requestId);
      if (old) {
        const { at, ...saved } = old;
        const { at: ignored, ...current } = value;
        if (JSON.stringify(saved) !== JSON.stringify(current))
          fail(409, 'ADJUSTMENT_REUSED', 'La operación ya existe con otros datos.');
        return old;
      }
      this.repository.applyAdjustment(value);
      this.repository.record(actor.id, 'inventory.adjusted', value);
      return value;
    });
  }
}
