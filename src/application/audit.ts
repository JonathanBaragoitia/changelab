import { validatePlan } from '../domain/catalog.ts';
import type { Plan, Proposal } from '../domain/catalog.ts';
import type { Digest } from './ports.ts';
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : undefined;
const text = (value: unknown) => (typeof value === 'string' ? value : null);
function plan(value: unknown): Plan | null {
  try {
    return validatePlan(value);
  } catch {
    return null;
  }
}
function changes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = record(item);
    if (
      !row ||
      typeof row.name !== 'string' ||
      typeof row.productId !== 'string' ||
      typeof row.beforeCents !== 'number' ||
      !Number.isSafeInteger(row.beforeCents) ||
      typeof row.afterCents !== 'number' ||
      !Number.isSafeInteger(row.afterCents)
    )
      return [];
    return [
      {
        productId: row.productId,
        name: row.name,
        beforeCents: row.beforeCents,
        afterCents: row.afterCents,
      },
    ];
  });
}
/** Read projection only: never rewrite old audit entries or their hashes. */
export function describeAudit(
  event: { action: unknown; detail: unknown },
  proposals: Proposal[],
  digest: Digest,
) {
  let detail: RecordValue | undefined;
  try {
    detail =
      typeof event.detail === 'string' ? record(JSON.parse(event.detail) as unknown) : undefined;
  } catch {}
  if (!detail)
    return {
      available: false,
      proposalId: null,
      plan: null,
      instruction: null,
      createdBy: null,
      actorName: null,
      changes: [],
      findings: [],
    };

  if (typeof event.action === 'string' && event.action.startsWith('mail.')) {
    const outcomes: Record<string, string> = {
      'mail.retry-requested': 'Se solicitó otro intento. Todavía no acredita envío ni entrega.',
      'mail.queued': 'Mensaje guardado; todavía no acredita envío ni entrega.',
      'mail.preview': 'Revisión local; no se ha enviado correo externo.',
      'mail.sent': 'El proveedor aceptó el mensaje. No confirma recepción en el buzón.',
      'mail.failed': 'El intento falló; consulta la cola de correo.',
      'mail.blocked': 'Requiere revisar la configuración o el destinatario.',
      'mail.uncertain': 'Comprueba el estado en el proveedor antes de reenviar.',
    };
    if (outcomes[event.action])
      detail.instruction = 'Pedido ' + (text(detail.orderId) ?? '') + ': ' + outcomes[event.action];
  }

  if (event.action === 'order.dispatch-arranged')
    detail.instruction =
      'Pedido ' +
      (text(detail.orderId) ?? '') +
      ': expedición tramitada con ' +
      (text(detail.carrier) ?? '') +
      ', referencia ' +
      (text(detail.reference) ?? '') +
      '. Pendiente de recogida en almacén; sin cambios de existencias.';

  if (event.action === 'order.status-changed') {
    const labels: Record<string, string> = {
      confirmed: 'Confirmado',
      prepared: 'Preparado',
      shipped: 'Enviado (demo)',
      cancelled: 'Cancelado',
    };
    const before = text(detail.before),
      after = text(detail.after),
      orderId = text(detail.orderId);
    if (before && after && orderId && labels[before] && labels[after])
      detail.instruction =
        'Pedido ' +
        orderId +
        ': ' +
        labels[before] +
        ' → ' +
        labels[after] +
        (after === 'cancelled'
          ? '. Unidades devueltas al almacén; excluido de ventas y margen.'
          : '. Sin cambios adicionales de existencias.');
  }

  if (
    event.action === 'inventory.received' &&
    typeof detail.quantity === 'number' &&
    Number.isSafeInteger(detail.quantity) &&
    detail.quantity > 0
  )
    detail.instruction =
      'Entrada ' +
      (text(detail.receiptId) ?? '') +
      ': +' +
      detail.quantity +
      ' unidades de ' +
      (text(detail.productId) ?? '') +
      '. Proveedor: ' +
      (text(detail.supplier) ?? '') +
      '. Referencia: ' +
      (text(detail.reference) ?? '') +
      '.';

  if (event.action === 'billing.draft-revised')
    detail.instruction =
      'Borrador ' +
      (text(detail.id) ?? '') +
      ' · versión ' +
      String(detail.beforeVersion ?? '?') +
      ' → ' +
      String(detail.afterVersion ?? '?') +
      '. Motivo: ' +
      (text(detail.reason) ?? '');
  if (event.action === 'billing.demo-issued')
    detail.instruction =
      'Documento ' +
      (text(detail.number) ?? '') +
      ' emitido en demostración. Pedido ' +
      (text(detail.orderId) ?? '') +
      '. Sin validez fiscal.';
  if (event.action === 'billing.demo-corrected')
    detail.instruction =
      'Rectificación ' +
      (text(detail.number) ?? '') +
      ' del documento ' +
      (text(detail.originalNumber) ?? '') +
      '. Motivo: ' +
      (text(detail.reason) ?? '') +
      '. Sin movimiento de stock ni reembolso.';
  if (event.action === 'inventory.receipt-cancelled')
    detail.instruction =
      'Recepción ' +
      (text(detail.reference) ?? '') +
      ' anulada. Motivo: ' +
      (text(detail.reason) ?? '') +
      '. Existencias descontadas; original conservado.';
  if (event.action === 'expense.cancelled')
    detail.instruction =
      'Gasto ' +
      (text(detail.reference) ?? '') +
      ' anulado. Motivo: ' +
      (text(detail.reason) ?? '') +
      '. Original conservado; sin devolución de dinero.';
  if (event.action === 'expense.registered')
    detail.instruction =
      'Gasto ' +
      (text(detail.reference) ?? '') +
      ' · ' +
      (text(detail.category) ?? '') +
      ' · ' +
      (text(detail.date) ?? '') +
      '. No acredita pago.';
  if (event.action === 'cash.refund-reversed')
    detail.instruction =
      'Reembolso ' +
      (text(detail.reference) ?? '') +
      ' anulado por error de registro. Motivo: ' +
      (text(detail.reason) ?? '') +
      '. Original conservado; sin movimiento de dinero.';
  if (event.action === 'stock.policy-updated')
    detail.instruction =
      'Reposición del artículo ' +
      (text(detail.productId) ?? '') +
      ' configurada. No se han creado compras ni modificado existencias.';
  if (event.action === 'tariff.prepared')
    detail.instruction =
      'Tarifa ' +
      (text(detail.reference) ?? '') +
      ' preparada para revisión. El catálogo no ha cambiado.';
  if (event.action === 'tariff.applied')
    detail.instruction =
      'Tarifa ' +
      (text(detail.reference) ?? '') +
      ' aplicada: costes actualizados y versiones incrementadas. Precios y pedidos conservados.';
  if (event.action === 'cash.refunded')
    detail.instruction =
      'Reembolso anotado ' +
      (text(detail.reference) ?? '') +
      '. Motivo: ' +
      (text(detail.reason) ?? '') +
      '. Cobro original conservado; sin transferencia real.';
  if (event.action === 'cash.registered')
    detail.instruction =
      (detail.kind === 'collection' ? 'Cobro' : 'Pago') +
      ' anotado · ' +
      (text(detail.reference) ?? '') +
      ' · Destino ' +
      (text(detail.targetId) ?? '') +
      '. Sin transferencia real.';
  if (event.action === 'cash.reversed')
    detail.instruction =
      'Anotación ' +
      (text(detail.reference) ?? '') +
      ' anulada. Motivo: ' +
      (text(detail.reason) ?? '') +
      '. Original conservado; sin devolución real de dinero.';
  if (event.action === 'order.goods-returned' || event.action === 'inventory.adjusted')
    detail.instruction =
      'Motivo: ' +
      (text(detail.reason) ?? '') +
      '. Operación ' +
      (text(detail.orderId) ?? text(detail.requestId) ?? '') +
      '. Sin reembolso automático.';
  const operations: Record<string, string> = {
    'purchase.created': 'Compra preparada para revisión',
    'purchase.approved': 'Compra aprobada',
    'purchase.sent': 'Envío al proveedor registrado',
    'purchase.partially_received': 'Entrega de proveedor recibida con unidades pendientes',
    'purchase.receipt-reopened': 'Unidades pendientes tras anular la recepción',
    'purchase.received': 'Compra recibida en almacén',
    'purchase.cancelled': 'Compra pendiente cancelada',
    'incident.created': 'Incidencia abierta',
    'incident.updated': 'Seguimiento de incidencia actualizado',
    'transport.damage-created': 'Rotura de transporte registrada',
    'transport.damage-resolved': 'Reclamación de transporte cerrada',
    'document.extracted': 'Documento extraído para revisión',
    'document.processed': 'Documento revisado incorporado',
    'order.partial-returned': 'Mercancía devuelta por unidades',
  };
  if (typeof event.action === 'string' && operations[event.action])
    detail.instruction =
      operations[event.action] +
      ' · ' +
      (text(detail.id) ?? text(detail.orderId) ?? '') +
      (detail.quantity ? ' · ' + detail.quantity + ' unidades' : '') +
      (text(detail.reason) ? ' · ' + text(detail.reason) : '') +
      (text(detail.reference) ? ' · Referencia ' + text(detail.reference) : '') +
      '. Sin pagos ni comunicaciones externas automáticas.';
  const id = text(detail.id);
  const proposal = proposals.find(
    (value) =>
      value.id === id &&
      value.digest === detail.digest &&
      digest.hash({
        instruction: value.instruction,
        createdBy: value.createdBy,
        plan: value.plan,
        changes: value.changes,
      }) === detail.digest,
  );
  const directChanges = changes(detail.changes);
  const findings = Array.isArray(detail.findings)
    ? detail.findings.flatMap((value) => {
        const finding = record(value);
        return finding && typeof finding.message === 'string' ? [finding.message] : [];
      })
    : [];
  return {
    available: true,
    proposalId: id,
    plan: plan(detail.plan) ?? proposal?.plan ?? null,
    instruction: text(detail.instruction) ?? proposal?.instruction ?? null,
    createdBy: text(detail.createdBy) ?? proposal?.createdBy ?? null,
    actorName: text(detail.actorName),
    changes: directChanges.length ? directChanges : proposal ? changes(proposal.changes) : [],
    findings,
  };
}
