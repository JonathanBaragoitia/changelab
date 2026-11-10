import { fail } from './catalog.ts';
export type TaxSnapshot = {
  policy: 'demo-net-v1';
  rate: 21;
  baseCents: number;
  taxCents: number;
  totalCents: number;
};
export function demoTax(
  lines: readonly { quantity: number; unitPriceCents: number }[],
): TaxSnapshot {
  let baseCents = 0,
    taxCents = 0;
  for (const line of lines) {
    const base = line.quantity * line.unitPriceCents;
    if (!Number.isSafeInteger(base) || base < 1)
      fail(400, 'INVALID_TAX_AMOUNT', 'Importe fuera de rango.');
    baseCents += base;
    taxCents += Math.round((base * 21) / 100);
  }
  if (!Number.isSafeInteger(baseCents + taxCents))
    fail(400, 'INVALID_TAX_AMOUNT', 'Importe fuera de rango.');
  return { policy: 'demo-net-v1', rate: 21, baseCents, taxCents, totalCents: baseCents + taxCents };
}
