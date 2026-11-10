import { remainingSale } from './partial-returns.ts';
import type { Refund } from './refunds.ts';
import type { Sale } from './commerce.ts';
import type { DemoInvoice } from './issuance.ts';
import type { DemoCorrection } from './rectification.ts';
import type { CashEntry } from './cash.ts';
export function reconcileOrders(
  sales: Sale[],
  invoices: DemoInvoice[],
  corrections: DemoCorrection[],
  activeCash: CashEntry[],
  refunds: Refund[] = [],
) {
  return sales.map((sale) => {
    const closed = ['cancelled', 'returned'].includes(sale.status ?? '');
    const orderCents = sale.tax?.totalCents ?? sale.totalCents,
      expectedCents = closed
        ? 0
        : (remainingSale(sale).tax?.totalCents ?? remainingSale(sale).totalCents);
    const documents = invoices.filter((i) => i.draft.orderId === sale.id);
    const ids = new Set(documents.map((i) => i.id));
    const relatedCorrections = corrections.filter((c) => ids.has(c.invoiceId));
    const documentCents =
      documents.reduce((s, i) => s + i.draft.totalCents, 0) +
      relatedCorrections.reduce((s, c) => s + c.totalCents, 0);
    const collectedCents = activeCash
      .filter((c) => c.kind === 'collection' && c.targetId === sale.id)
      .reduce((s, c) => s + c.amountCents, 0);
    const refundedCents = refunds
      .filter((r) => r.orderId === sale.id)
      .reduce((s, r) => s + r.amountCents, 0);
    const netCollectedCents = collectedCents - refundedCents;
    const findings: { code: string; message: string }[] = [];
    if (!sale.tax)
      findings.push({
        code: 'LEGACY_TAX',
        message:
          'Pedido histórico sin desglose fiscal: revisar la hipótesis del documento de prueba.',
      });
    if (!closed && !documents.length)
      findings.push({
        code: 'NO_DOCUMENT',
        message:
          'Pedido activo sin documento emitido de prueba. Un borrador no cuenta como emisión.',
      });
    if (documents.length && documentCents !== expectedCents)
      findings.push({
        code: 'DOCUMENT_DIFFERENCE',
        message:
          'El saldo documental difiere del importe esperado según el estado del pedido. Revisar emisión/rectificación por separado.',
      });
    if (netCollectedCents < expectedCents)
      findings.push({
        code: 'PENDING_COLLECTION',
        message:
          'Queda importe por cobrar según las anotaciones activas. No acredita deuda bancaria.',
      });
    if (netCollectedCents > expectedCents)
      findings.push({
        code: 'COLLECTION_EXCESS',
        message:
          'Cobros anotados superiores al importe esperado: revisar posible devolución o error. No anular un cobro real para ocultarlo.',
      });
    return {
      orderId: sale.id,
      status: sale.status ?? 'confirmed',
      orderCents,
      expectedCents,
      documentCents,
      collectedCents,
      refundedCents,
      netCollectedCents,
      pendingCents: expectedCents - netCollectedCents,
      documents: documents.map((i) => ({ id: i.id, number: i.number, draftId: i.draft.id })),
      corrections: relatedCorrections.map((c) => ({ id: c.id, number: c.number })),
      findings,
    };
  });
}
