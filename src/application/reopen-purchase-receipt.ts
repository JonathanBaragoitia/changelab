import { fail } from '../domain/catalog.ts';
import { receivedPurchaseQuantity, type Purchase } from './operations.ts';
import type { Receipt } from './receiving.ts';

/** Keeps the original receipt and delivery visible while excluding their units from received stock. */
export function reopenPurchaseReceipt(
  purchase: Purchase,
  receipt: Receipt,
  receiptFor: (productId: string, deliveryId?: string) => Receipt | undefined,
): Purchase {
  const inconsistent = () =>
    fail(
      409,
      'PURCHASE_RECEIPT_MISMATCH',
      'La recepción y la compra no coinciden. Revisa el historial.',
    );
  if (purchase.status !== 'received' && purchase.status !== 'partially_received')
    return inconsistent();

  const deliveries =
    purchase.deliveries ??
    purchase.lines.map((line) => {
      const original = receiptFor(line.productId);
      if (!original || original.quantity !== line.quantity) return inconsistent();
      return {
        id: original.id,
        legacy: true as const,
        reference: original.reference,
        at: original.at,
        lines: [{ productId: original.productId, quantity: original.quantity }],
      };
    });
  const delivery = deliveries.find(
    (entry) =>
      entry.lines.some((line) => line.productId === receipt.productId) &&
      receiptFor(receipt.productId, entry.legacy ? undefined : entry.id)?.id === receipt.id,
  );
  const line = delivery?.lines.find((entry) => entry.productId === receipt.productId);
  if (!delivery || !line || line.quantity !== receipt.quantity) return inconsistent();

  const next: Purchase = {
    ...purchase,
    version: purchase.version + 1,
    deliveries: deliveries.map((entry) =>
      entry.id === delivery.id
        ? {
            ...entry,
            lines: entry.lines.map((item) =>
              item.productId === receipt.productId
                ? { ...item, cancelledReceiptId: receipt.id }
                : item,
            ),
          }
        : entry,
    ),
  };
  next.status = next.lines.some((item) => receivedPurchaseQuantity(next, item.productId) > 0)
    ? 'partially_received'
    : 'sent';
  return next;
}
