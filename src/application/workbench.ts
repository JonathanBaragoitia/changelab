import type { Product, Proposal } from '../domain/catalog.ts';
import type { Sale } from './commerce.ts';
import type { Incident, Purchase } from './operations.ts';
import { remainingSale } from './partial-returns.ts';
import type { TransportDamage } from './transport-damage.ts';
export function dailyWork(input: {
  products: Product[];
  sales: Sale[];
  purchases: (Purchase & { receiptWarnings?: number })[];
  incidents: Incident[];
  transportDamages?: TransportDamage[];
  proposals: Proposal[];
  stock: { productId: string; name: string; signals: { code: string; message: string }[] }[];
  reconciliation: {
    orderId: string;
    status?: string;
    findings: { code: string; message: string }[];
  }[];
}) {
  return [
    ...input.purchases
      .filter((p) => p.receiptWarnings)
      .map((p) => ({
        id: 'purchase-receipt-' + p.id,
        area: 'purchases',
        priority: 1,
        title: 'Revisar recepción anulada · ' + p.supplierName,
        detail:
          p.receiptWarnings + ' líneas de recepción anuladas; la compra histórica se conserva',
      })),
    ...input.sales
      .filter((s) => ['confirmed', 'prepared'].includes(s.status ?? 'confirmed'))
      .map((s) => ({
        id: 'order-' + s.id,
        area: s.status === 'prepared' && !s.dispatch ? 'shipping' : 'warehouse',
        priority: 2,
        title:
          (s.dispatch
            ? 'Confirmar recogida · '
            : s.status === 'prepared'
              ? 'Tramitar envío · '
              : 'Preparar en almacén · ') + s.id.slice(0, 8),
        detail:
          s.status === 'prepared'
            ? s.dispatch
              ? 'Expedición tramitada · pendiente de recogida'
              : 'Aviso de Almacén · paquete preparado'
            : 'Confirmado · pendiente de preparar',
      })),
    ...input.purchases
      .filter((p) => ['draft', 'approved', 'sent', 'partially_received'].includes(p.status))
      .map((p) => ({
        id: 'purchase-' + p.id,
        area: 'purchases',
        priority: 2,
        title:
          (p.status === 'draft'
            ? 'Revisar compra · '
            : p.status === 'approved'
              ? 'Enviar compra al proveedor · '
              : 'Pendiente de recibir · ') + p.supplierName,
        detail: p.lines.length + ' artículos',
      })),
    ...(input.transportDamages ?? [])
      .filter((d) => d.status === 'open')
      .map((d) => ({
        id: 'transport-' + d.id,
        area: 'transport',
        priority: 1,
        title: 'Reclamación de transporte · ' + d.reference,
        detail:
          d.quantity +
          ' unidades · ' +
          (d.inStock
            ? 'Baja de stock registrada; resolver reclamación'
            : 'Mercancía rechazada sin alta en stock; acordar solución'),
      })),
    ...input.incidents
      .filter((i) => i.status !== 'resolved')
      .map((i) => ({
        id: 'incident-' + i.id,
        area: 'incidents',
        priority: 1,
        title: 'Incidencia · ' + i.orderId,
        detail:
          ({
            damage: 'Producto dañado',
            'wrong-item': 'Artículo incorrecto',
            delivery: 'Entrega',
            other: 'Otra incidencia',
          }[i.kind] ?? 'Incidencia') +
          ' · ' +
          (i.status === 'open' ? 'Abierta' : 'En estudio'),
      })),
    ...input.proposals
      .filter((p) => p.status === 'ready')
      .map((p) => {
        const stale = p.changes.some((c) => {
          const product = input.products.find((v) => v.id === c.productId);
          return (
            !product ||
            product.version !== c.baseVersion ||
            product.priceCents !== c.beforeCents ||
            (c.costCents !== undefined && product.costCents !== c.costCents)
          );
        });
        return {
          id: 'proposal-' + p.id,
          area: 'proposals',
          priority: 2,
          title:
            (stale ? 'Rehacer propuesta desactualizada · ' : 'Revisar cambio · ') + p.plan.category,
          detail: stale
            ? 'El catálogo cambió. La versión anterior no puede publicarse.'
            : 'Comprobar vigencia antes de publicar',
        };
      }),
    ...input.stock.flatMap((r) =>
      r.signals
        .filter((s) => ['reorder', 'out-of-stock'].includes(s.code))
        .map((s) => ({
          id: 'stock-' + r.productId + '-' + s.code,
          area: 'business',
          priority: s.code === 'out-of-stock' ? 1 : 2,
          title: r.name,
          detail: s.message,
        })),
    ),
    ...input.reconciliation
      .map((r) => ({
        ...r,
        findings: r.findings.filter(
          (f) =>
            !(
              ['confirmed', 'prepared'].includes(r.status ?? '') &&
              ['NO_DOCUMENT', 'PENDING_COLLECTION'].includes(f.code)
            ),
        ),
      }))
      .filter((r) => r.findings.length)
      .map((r) => ({
        id: 'reconciliation-' + r.orderId,
        area: 'reconciliation',
        priority: 2,
        title: 'Revisar documentos y cobros · ' + r.orderId.slice(0, 8),
        detail: r.findings.length + ' comprobaciones pendientes',
      })),
  ].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}
export function followUp(proposals: Proposal[], sales: Sale[], products: Product[], now: string) {
  const day = 86400000,
    nowMs = Date.parse(now);
  return proposals
    .filter((p) => p.status === 'applied' && p.appliedAt)
    .map((p) => {
      const applied = Date.parse(p.appliedAt!),
        ids = new Set(p.changes.map((c) => c.productId));
      const measure = (from: number, to: number) => {
        const selected = sales.filter(
          (s) =>
            Date.parse(s.createdAt) >= from &&
            Date.parse(s.createdAt) < to &&
            !['cancelled', 'returned'].includes(s.status ?? ''),
        );
        const excludedHistoricalOrders = selected.filter(
          (s) => !s.tax && s.lines.some((l) => ids.has(l.productId)),
        ).length;
        const lines = selected
          .filter((s) => s.tax)
          .flatMap((s) => remainingSale(s).lines)
          .filter((l) => ids.has(l.productId));
        return {
          excludedHistoricalOrders,
          units: lines.reduce((s, l) => s + l.quantity, 0),
          revenueCents: lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0),
          marginCents: lines.reduce(
            (s, l) => s + (l.unitPriceCents - l.unitCostCents) * l.quantity,
            0,
          ),
        };
      };
      const complete = nowMs >= applied + 14 * day;
      return {
        id: p.id,
        category: p.plan.category,
        appliedAt: p.appliedAt,
        before: measure(applied - 14 * day, applied),
        after: measure(applied, Math.min(nowMs, applied + 14 * day)),
        complete,
        observedDays: Math.max(0, Math.min(14, (nowMs - applied) / day)),
        overlappingChanges: proposals.filter(
          (q) =>
            q.id !== p.id &&
            q.status === 'applied' &&
            q.appliedAt &&
            Math.abs(Date.parse(q.appliedAt) - applied) < 28 * day &&
            q.changes.some((c) => ids.has(c.productId)),
        ).length,
        currentProductCount: products.filter((x) => ids.has(x.id)).length,
      };
    });
}
