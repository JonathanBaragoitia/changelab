import { fail } from '../domain/catalog.ts';
import type { Receipt } from './receiving.ts';
export type ReceiptCancellation = {
  receiptId: string;
  reason: string;
  actorId: string;
  at: string;
  expectedQuantity: number;
  purchaseId?: string;
};
export interface ReceiptCancellationRepository {
  transaction<T>(op: () => T): T;
  receipt(id: string): Receipt | undefined;
  receiptCancellation(id: string): ReceiptCancellation | undefined;
  cancelReceipt(value: ReceiptCancellation, receipt: Receipt): void;
  record(actor: string, action: string, detail: unknown): void;
}
export class CancelReceipt {
  repo: ReceiptCancellationRepository;
  guard: (receipt: Receipt) => void;
  private reopen: (receipt: Receipt, actorId: string) => string | undefined;
  constructor(
    repo: ReceiptCancellationRepository,
    guard: (receipt: Receipt) => void = () => {},
    reopen: (receipt: Receipt, actorId: string) => string | undefined = () => undefined,
  ) {
    this.repo = repo;
    this.guard = guard;
    this.reopen = reopen;
  }
  execute(actor: { id: string; role: string }, receiptId: string, input: unknown) {
    if (actor.role !== 'editor') fail(403, 'FORBIDDEN', 'Solo edición puede anular recepciones.');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail(400, 'INVALID_CANCELLATION', 'Datos no válidos.');
    const v = input as Record<string, unknown>;
    if (
      Object.keys(v).some((k) => !['reason', 'expectedQuantity'].includes(k)) ||
      typeof v.reason !== 'string' ||
      v.reason.trim().length < 5 ||
      v.reason.length > 300 ||
      !Number.isSafeInteger(v.expectedQuantity) ||
      (v.expectedQuantity as number) < 0
    )
      fail(400, 'INVALID_CANCELLATION', 'Indica motivo y existencias revisadas.');
    const reason = v.reason.trim(),
      expectedQuantity = v.expectedQuantity as number;
    return this.repo.transaction(() => {
      const receipt = this.repo.receipt(receiptId);
      if (!receipt) fail(404, 'RECEIPT_NOT_FOUND', 'Recepción no encontrada.');
      const prior = this.repo.receiptCancellation(receiptId);
      if (prior) {
        if (
          prior.reason !== reason ||
          prior.actorId !== actor.id ||
          prior.expectedQuantity !== expectedQuantity
        )
          fail(409, 'RECEIPT_CANCELLED', 'Recepción ya anulada con otros datos.');
        return prior;
      }
      this.guard(receipt);
      const purchaseId = this.reopen(receipt, actor.id);
      const value: ReceiptCancellation = {
        receiptId,
        reason,
        actorId: actor.id,
        at: new Date().toISOString(),
        expectedQuantity,
        ...(purchaseId ? { purchaseId } : {}),
      };
      this.repo.cancelReceipt(value, receipt);
      this.repo.record(actor.id, 'inventory.receipt-cancelled', {
        ...value,
        productId: receipt.productId,
        quantity: -receipt.quantity,
        reference: receipt.reference,
      });
      return value;
    });
  }
}
