import { fail } from './catalog.ts';
import type { Change } from './catalog.ts';

export function reviewChanges(changes: Change[]) {
  const rows = changes.map((change) => {
    const cost = change.costCents;
    const known = typeof cost === 'number' && Number.isSafeInteger(cost) && cost >= 0;
    return {
      ...change,
      costCents: known ? cost : null,
      beforeMarginPercent: known ? ((change.beforeCents - cost) * 100) / change.beforeCents : null,
      afterMarginPercent: known ? ((change.afterCents - cost) * 100) / change.afterCents : null,
      belowMinimum: known ? change.afterCents * 80 < cost * 100 : null,
    };
  });
  return {
    rows,
    costSnapshotComplete: rows.every((row) => row.costCents !== null),
    affectedProducts: rows.length,
    belowMinimum: rows.filter((row) => row.belowMinimum === true).length,
  };
}

function safe(value: number): number {
  if (!Number.isSafeInteger(value))
    fail(400, 'SCENARIO_OVERFLOW', 'El escenario supera el límite de cálculo exacto.');
  return value;
}

/** Equal, explicitly supplied units before/after; this is not a demand forecast. */
export function calculateScenario(changes: Change[], input: unknown) {
  const review = reviewChanges(changes);
  if (!review.costSnapshotComplete)
    fail(
      409,
      'MISSING_COST_SNAPSHOT',
      'Esta propuesta antigua no conserva los costes. Crea una nueva simulación.',
    );
  if (!Array.isArray(input) || input.length !== changes.length) {
    fail(400, 'INVALID_QUANTITIES', 'Indica una cantidad para cada producto de la propuesta.');
  }
  const quantities = new Map<string, number>();
  for (const entry of input) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      fail(400, 'INVALID_QUANTITIES', 'Cantidad no válida.');
    const item = entry as Record<string, unknown>;
    if (
      Object.keys(item).sort().join(',') !== 'productId,quantity' ||
      typeof item.productId !== 'string' ||
      typeof item.quantity !== 'number' ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 0 ||
      item.quantity > 100000 ||
      quantities.has(item.productId) ||
      !changes.some((change) => change.productId === item.productId)
    ) {
      fail(
        400,
        'INVALID_QUANTITIES',
        'Usa productos de la propuesta sin duplicados y unidades enteras entre 0 y 100000.',
      );
    }
    quantities.set(item.productId, item.quantity);
  }
  let units = 0,
    beforeRevenueCents = 0,
    afterRevenueCents = 0,
    costCents = 0;
  for (const row of review.rows) {
    const quantity = quantities.get(row.productId);
    if (quantity === undefined || row.costCents === null)
      fail(400, 'INVALID_QUANTITIES', 'Falta una cantidad o un coste.');
    units = safe(units + quantity);
    beforeRevenueCents = safe(beforeRevenueCents + safe(row.beforeCents * quantity));
    afterRevenueCents = safe(afterRevenueCents + safe(row.afterCents * quantity));
    costCents = safe(costCents + safe(row.costCents * quantity));
  }
  const beforeContributionCents = safe(beforeRevenueCents - costCents);
  const afterContributionCents = safe(afterRevenueCents - costCents);
  return {
    units,
    beforeRevenueCents,
    afterRevenueCents,
    costCents,
    beforeContributionCents,
    afterContributionCents,
    revenueDeltaCents: safe(afterRevenueCents - beforeRevenueCents),
    contributionDeltaCents: safe(afterContributionCents - beforeContributionCents),
    beforeMarginPercent:
      beforeRevenueCents === 0 ? null : (beforeContributionCents * 100) / beforeRevenueCents,
    afterMarginPercent:
      afterRevenueCents === 0 ? null : (afterContributionCents * 100) / afterRevenueCents,
  };
}
