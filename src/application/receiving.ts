import type { Purchase } from './operations.ts';
import { canOperate, type OperationalActor } from './order-permissions.ts';
import { needsOwnerDecision } from './company-roles.ts';
import { fail } from '../domain/catalog.ts';
export type ReceiptInput = {
  supplierId?: string;
  requestId: string;
  productId: string;
  quantity: number;
  supplier: string;
  reference: string;
};
export type Receipt = ReceiptInput & { id: string; actorId: string; at: string };
export interface ReceivingRepository {
  transaction<T>(operation: () => T): T;
  receiptByRequest(id: string): Receipt | undefined;
  receiptSupplier(id: string): { name: string; active: number } | undefined;
  hasSupplierReceipt(id: string, reference: string, productId: string): boolean;
  hasReceipt(supplier: string, reference: string, productId: string): boolean;
  receive(receipt: Receipt, allowArchivedProduct?: boolean): void;
  record(actor: string, action: string, detail: unknown): void;
}
function validate(input: unknown): ReceiptInput {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail(400, 'INVALID_RECEIPT', 'Entrada no válida.');
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) =>
        !['requestId', 'productId', 'quantity', 'supplier', 'supplierId', 'reference'].includes(
          key,
        ),
    ) ||
    (value.supplierId !== undefined &&
      (typeof value.supplierId !== 'string' ||
        !value.supplierId ||
        value.supplierId.length > 80)) ||
    typeof value.requestId !== 'string' ||
    !/^[a-zA-Z0-9-]{16,80}$/.test(value.requestId) ||
    typeof value.productId !== 'string' ||
    !value.productId ||
    value.productId.length > 80 ||
    !Number.isSafeInteger(value.quantity) ||
    (value.quantity as number) < 1 ||
    (value.quantity as number) > 10000 ||
    typeof value.supplier !== 'string' ||
    value.supplier.trim().length < 2 ||
    value.supplier.length > 120 ||
    typeof value.reference !== 'string' ||
    !value.reference.trim() ||
    value.reference.length > 100
  )
    fail(400, 'INVALID_RECEIPT', 'Revisa producto, proveedor, referencia y unidades (1–10.000).');
  return {
    ...(typeof value.supplierId === 'string' ? { supplierId: value.supplierId } : {}),
    requestId: value.requestId,
    productId: value.productId,
    quantity: value.quantity as number,
    supplier: value.supplier.trim(),
    reference: value.reference.trim(),
  };
}
export class ReceiveStock {
  private repository: ReceivingRepository;
  private nextId: () => string;
  private now: () => string;
  constructor(repository: ReceivingRepository, nextId: () => string, now: () => string) {
    this.repository = repository;
    this.nextId = nextId;
    this.now = now;
  }
  execute(actor: OperationalActor, input: unknown): Receipt {
    return this.receive(actor, input, false);
  }
  /** Internal purchase adapter only; the HTTP entry-point never accepts archive overrides. */
  receivePurchase(actor: OperationalActor, purchase: Purchase, input: ReceiptInput): Receipt {
    if (
      !['approved', 'sent', 'partially_received'].includes(purchase.status) ||
      purchase.supplierId !== input.supplierId ||
      !purchase.lines.some(
        (line) => line.productId === input.productId && line.quantity === input.quantity,
      )
    )
      fail(409, 'INVALID_PURCHASE_RECEIPT', 'La recepción no corresponde a una compra autorizada.');
    return this.receive(actor, input, true);
  }
  private receive(actor: OperationalActor, input: unknown, authorizedPurchase: boolean): Receipt {
    // Document imports and purchase receipts must enforce the same physical permissions.
    if (actor.profile !== 'warehouse' && needsOwnerDecision(actor))
      fail(403, 'WAREHOUSE_REQUIRED', 'La recepción física corresponde al almacén.');
    if (actor.role !== 'editor' && !canOperate(actor, 'warehouse.receive'))
      fail(403, 'FORBIDDEN', 'Solo una cuenta editora puede registrar entradas.');
    const value = validate(input);
    return this.repository.transaction(() => {
      const existing = this.repository.receiptByRequest(value.requestId);
      if (existing) {
        if (
          existing.actorId !== actor.id ||
          Object.keys(value).some(
            (key) => value[key as keyof ReceiptInput] !== existing[key as keyof ReceiptInput],
          )
        )
          fail(409, 'RECEIPT_REUSED', 'La referencia de operación ya se utilizó con otros datos.');
        return existing;
      }
      if (value.supplierId) {
        const supplier = this.repository.receiptSupplier(value.supplierId);
        if (!supplier || (!supplier.active && !authorizedPurchase))
          fail(409, 'SUPPLIER_UNAVAILABLE', 'Selecciona un proveedor activo.');
        if (this.repository.hasSupplierReceipt(value.supplierId, value.reference, value.productId))
          fail(
            409,
            'DUPLICATE_RECEIPT',
            'Ese artículo ya se recibió con este proveedor y albarán.',
          );
        value.supplier = supplier.name;
      }
      if (this.repository.hasReceipt(value.supplier, value.reference, value.productId))
        fail(
          409,
          'DUPLICATE_RECEIPT',
          'Ese artículo ya se recibió con el mismo proveedor y referencia.',
        );
      const receipt = { ...value, id: this.nextId(), actorId: actor.id, at: this.now() };
      this.repository.receive(receipt, authorizedPurchase);
      this.repository.record(actor.id, 'inventory.received', {
        receiptId: receipt.id,
        productId: receipt.productId,
        quantity: receipt.quantity,
        supplier: receipt.supplier,
        reference: receipt.reference,
        actorName: actor.name ?? actor.id,
      });
      return receipt;
    });
  }
}
