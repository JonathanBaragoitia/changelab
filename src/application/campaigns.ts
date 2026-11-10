import type { Product } from '../domain/catalog.ts';
import { fail, simulate } from '../domain/catalog.ts';
import { calculateScenario } from '../domain/impact.ts';
import { period } from './economics.ts';
export function compareCampaigns(
  products: Product[],
  input: Record<string, unknown>,
  hash: (v: unknown) => string,
) {
  if (
    Object.keys(input).some(
      (k) => !['title', 'category', 'from', 'to', 'alternatives', 'quantities'].includes(k),
    ) ||
    typeof input.title !== 'string' ||
    input.title.trim().length < 5 ||
    input.title.length > 150 ||
    typeof input.category !== 'string' ||
    !Array.isArray(input.alternatives) ||
    input.alternatives.length < 1 ||
    input.alternatives.length > 3 ||
    new Set(input.alternatives).size !== input.alternatives.length
  )
    fail(400, 'INVALID_CAMPAIGN', 'Indica título, categoría y hasta tres alternativas distintas.');
  const dates = period(input.from, input.to);
  if (Date.parse(dates.to) - Date.parse(dates.from) > 366 * 86400000)
    fail(400, 'INVALID_CAMPAIGN', 'Planifica un periodo de hasta un año.');
  const selected = products.filter((p) => p.category === input.category);
  const alternatives = input.alternatives.map((value) => {
    const result = simulate(selected, { category: input.category, basisPoints: value });
    const totals = calculateScenario(result.changes, input.quantities);
    const quantities = input.quantities as { productId: string; quantity: number }[];
    const rows = result.changes.map((c) => {
      const quantity = quantities.find((q) => q.productId === c.productId)!.quantity,
        beforeUnitGross = c.beforeCents - c.costCents!,
        afterUnitGross = c.afterCents - c.costCents!;
      return {
        ...c,
        quantity,
        unitsToMaintainGross:
          quantity === 0
            ? 0
            : beforeUnitGross > 0 && afterUnitGross > 0
              ? Math.ceil((quantity * beforeUnitGross) / afterUnitGross)
              : null,
      };
    });
    return { basisPoints: value as number, findings: result.findings, totals, rows };
  });
  return {
    title: input.title.trim(),
    category: input.category,
    from: dates.from,
    to: dates.to,
    contextHash: hash(selected),
    alternatives,
    scope:
      'Cantidades elegidas y costes actuales. Sin predicción de demanda, activación automática ni retirada de precios por fecha.',
  };
}
