import { fail } from '../domain/catalog.ts';
import { sha } from './store.ts';
type Row = Record<string, unknown>;
const record = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const string = (v: unknown, max: number, min = 1): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;
const number = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max;
const oneOf = (v: unknown, choices: string[]) => typeof v === 'string' && choices.includes(v);
const rows = (v: unknown, max: number, check: (row: Row) => boolean, min = 0) =>
  Array.isArray(v) && v.length >= min && v.length <= max && v.every((r) => record(r) && check(r));
/** Treat persisted JSON as input too: reject corruption before it reaches stock or money calculations. */
export function readOperation<T extends { id: string; version: number }>(
  kind: string,
  raw: unknown,
  id: string,
  version: number,
): T {
  let value: unknown;
  try {
    if (typeof raw !== 'string' || raw.length > 1000000) throw new Error('size');
    value = JSON.parse(raw);
  } catch {
    fail(
      500,
      'CORRUPT_OPERATION',
      'Registro operativo dañado. Restaura una copia verificada antes de continuar.',
    );
  }
  const bad = () =>
    fail(
      500,
      'CORRUPT_OPERATION',
      'Registro operativo incoherente. No se ha aplicado ninguna operación.',
    );
  if (
    !record(value) ||
    value.id !== id ||
    value.version !== version ||
    !string(id, 80) ||
    !number(version, 1) ||
    !string(value.createdBy, 80) ||
    !string(value.createdAt, 40) ||
    !Number.isFinite(Date.parse(value.createdAt))
  )
    return bad();
  const v = value;
  if (kind === 'purchase') {
    if (
      !string(v.supplierId, 80) ||
      !string(v.supplierName, 120) ||
      !string(v.reason, 300, 5) ||
      !oneOf(v.status, [
        'draft',
        'approved',
        'sent',
        'partially_received',
        'received',
        'cancelled',
        'rejected',
        'changes_requested',
      ]) ||
      !number(v.totalCents) ||
      !rows(
        v.lines,
        30,
        (l) =>
          string(l.productId, 80) &&
          string(l.sku, 60) &&
          string(l.name, 300) &&
          number(l.quantity, 1, 10000) &&
          number(l.costCents, 1, 100000000) &&
          number(l.baseVersion, 1),
        1,
      )
    )
      return bad();
    const lines = v.lines as Row[];
    if (
      new Set(lines.map((l) => l.productId)).size !== lines.length ||
      lines.reduce((s, l) => s + Number(l.quantity) * Number(l.costCents), 0) !== v.totalCents
    )
      return bad();
    // Check authorization when recording the decision. Later role changes do not alter its history.
    if (
      ['approved', 'sent', 'partially_received', 'received'].includes(String(v.status)) &&
      !string(v.approvedBy, 80)
    )
      return bad();
    if (v.status === 'received' && !string(v.reference, 100)) return bad();
    if (v.deliveries !== undefined) {
      if (
        !rows(
          v.deliveries,
          300000,
          (d) =>
            string(d.id, 80, 16) &&
            string(d.reference, 100) &&
            string(d.at, 80) &&
            (d.legacy === undefined || d.legacy === true) &&
            rows(
              d.lines,
              30,
              (l) =>
                string(l.productId, 80) &&
                number(l.quantity, 1, 10000) &&
                (l.cancelledReceiptId === undefined || string(l.cancelledReceiptId, 80, 16)),
              1,
            ),
          1,
        )
      )
        return bad();
      const deliveries = v.deliveries as Row[];
      if (new Set(deliveries.map((d) => d.id)).size !== deliveries.length) return bad();
      const totals = new Map<string, number>();
      for (const delivery of deliveries) {
        const seen = new Set();
        for (const line of delivery.lines as Row[]) {
          if (
            seen.has(line.productId) ||
            !lines.some((original) => original.productId === line.productId)
          )
            return bad();
          seen.add(line.productId);
          if (line.cancelledReceiptId) continue;
          totals.set(
            String(line.productId),
            (totals.get(String(line.productId)) ?? 0) + Number(line.quantity),
          );
        }
      }
      for (const [id, count] of totals) {
        const original = lines.find((l) => l.productId === id);
        if (!original || count > Number(original.quantity)) return bad();
      }
      if (
        v.status === 'received' &&
        lines.some((l) => totals.get(String(l.productId)) !== l.quantity)
      )
        return bad();
    }
    if (
      ['sent', 'partially_received'].includes(String(v.status)) &&
      (!string(v.sentAt, 80) || !string(v.expectedDate, 10)) &&
      !(Array.isArray(v.deliveries) && v.deliveries.some((delivery) => delivery.legacy === true))
    )
      return bad();
    if (['rejected', 'changes_requested'].includes(String(v.status))) {
      const review = v.review;
      if (
        !record(review) ||
        !string(review.actor, 80) ||
        !string(review.reason, 300, 5) ||
        !string(review.at, 80)
      )
        return bad();
    }
  } else if (kind === 'incident') {
    if (
      !string(v.orderId, 80) ||
      !oneOf(v.kind, ['damage', 'wrong-item', 'delivery', 'other']) ||
      !oneOf(v.status, ['open', 'investigating', 'resolved']) ||
      !string(v.description, 1000, 10) ||
      !string(v.resolution, 1000, 0) ||
      (v.status !== 'open' && !string(v.resolution, 1000, 5))
    )
      return bad();
  } else if (kind === 'partial-return') {
    const disposal = v.disposal;
    if (
      !string(v.orderId, 80) ||
      !string(v.productId, 80) ||
      !number(v.quantity, 1, 100) ||
      (v.condition !== undefined && !oneOf(v.condition, ['sellable', 'damaged'])) ||
      !string(v.reason, 300, 5) ||
      !(v.baseCents === null || number(v.baseCents, 1)) ||
      !number(v.grossCents, 1) ||
      (disposal !== undefined &&
        (v.condition !== 'damaged' ||
          version < 2 ||
          !record(disposal) ||
          Object.keys(disposal).some((key) => !['at', 'by', 'reason', 'reference'].includes(key)) ||
          !string(disposal.at, 40) ||
          !Number.isFinite(Date.parse(disposal.at)) ||
          !string(disposal.by, 80) ||
          !string(disposal.reason, 300, 5) ||
          (disposal.reference !== undefined && !string(disposal.reference, 100))))
    )
      return bad();
  } else if (kind === 'document-import') {
    if (
      !string(v.source, 12000, 5) ||
      v.sourceHash !== sha(v.source) ||
      !oneOf(v.status, ['review', 'processed']) ||
      typeof v.modelUsed !== 'boolean' ||
      !rows(
        v.rows,
        30,
        (r) =>
          string(r.sku, 60) &&
          (r.quantity === null || number(r.quantity, 1, 10000)) &&
          (r.costCents === null || number(r.costCents, 1, 100000000)) &&
          string(r.evidence, 600),
      )
    )
      return bad();
  } else return bad();
  return v as T;
}
