export type Product = {
  id: string;
  sku: string;
  name: string;
  category: string;
  priceCents: number;
  costCents: number;
  version: number;
};
export type Change = {
  productId: string;
  name: string;
  baseVersion: number;
  beforeCents: number;
  afterCents: number;
  costCents?: number;
};
export type Plan = { category: string; basisPoints: number };
export type Finding = { code: string; productId: string; message: string };
export type Proposal = {
  id: string;
  instruction: string;
  createdBy: string;
  createdAt: string;
  plan: Plan;
  changes: Change[];
  findings: Finding[];
  digest: string;
  status: 'ready' | 'blocked' | 'applied';
  appliedBy?: string;
  appliedAt?: string;
};
export class AppError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function fail(status: number, code: string, message: string): never {
  throw new AppError(status, code, message);
}
export function validatePlan(input: unknown): Plan {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return fail(400, 'INVALID_PLAN', 'El plan debe ser un objeto.');
  const v = input as Record<string, unknown>;
  if (Object.keys(v).some((k) => !['category', 'basisPoints'].includes(k)))
    return fail(400, 'INVALID_PLAN', 'El plan contiene operaciones no permitidas.');
  if (typeof v.category !== 'string' || !v.category.trim() || v.category.length > 80)
    return fail(400, 'INVALID_CATEGORY', 'Selecciona una categoría.');
  if (
    !Number.isInteger(v.basisPoints) ||
    Math.abs(v.basisPoints as number) > 5000 ||
    v.basisPoints === 0
  )
    return fail(
      400,
      'INVALID_PERCENTAGE',
      'El porcentaje debe estar entre −50 % y 50 %, sin ser cero.',
    );
  return { category: v.category, basisPoints: v.basisPoints as number };
}
export function simulate(products: Product[], input: unknown) {
  const plan = validatePlan(input),
    selected = products.filter((p) => p.category === plan.category);
  if (!selected.length) return fail(400, 'EMPTY_SCOPE', 'La categoría no tiene productos.');
  const changes: Change[] = selected.map((p) => ({
    productId: p.id,
    name: p.name,
    baseVersion: p.version,
    beforeCents: p.priceCents,
    costCents: p.costCents,
    afterCents: Math.round((p.priceCents * (10000 + plan.basisPoints)) / 10000),
  }));
  if (changes.every((c) => c.beforeCents === c.afterCents))
    return fail(400, 'NO_CHANGE', 'El redondeo no modifica ningún precio.');
  return { plan, changes, findings: checkChanges(products, changes) };
}
export function checkChanges(products: Product[], changes: Change[]): Finding[] {
  const findings: Finding[] = [],
    seen = new Set<string>();
  for (const c of changes) {
    const p = products.find((p) => p.id === c.productId);
    const add = (code: string, message: string) =>
      findings.push({ code, productId: c.productId, message });
    if (seen.has(c.productId)) add('DUPLICATE', 'El producto aparece dos veces.');
    seen.add(c.productId);
    if (!p) {
      add('MISSING_PRODUCT', 'El producto ya no existe.');
      continue;
    }
    if (p.version !== c.baseVersion || p.priceCents !== c.beforeCents)
      add('STALE_DATA', p.name + ': los datos han cambiado desde la simulación.');
    if (!Number.isSafeInteger(c.afterCents) || c.afterCents <= 0)
      add('INVALID_PRICE', p.name + ': el precio debe ser un número positivo de céntimos.');
    // Gross margin >= 20%, using integer arithmetic.
    if (c.afterCents * 80 < p.costCents * 100)
      add('MIN_MARGIN', p.name + ': el margen bruto sería inferior al 20 %.');
    if (c.costCents !== undefined && p.costCents !== c.costCents)
      add('COST_CHANGED', p.name + ': el coste ha cambiado desde la simulación.');
  }
  return findings;
}
