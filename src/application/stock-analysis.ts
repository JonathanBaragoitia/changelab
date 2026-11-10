import { remainingSale } from './partial-returns.ts';
import type { Product } from '../domain/catalog.ts';
import type { Sale } from './commerce.ts';
import { fail } from '../domain/catalog.ts';
import { businessDate, period } from './economics.ts';
export type StockPolicy = {
  productId: string;
  leadDays: number;
  safetyDays: number;
  targetDays: number;
  minimumUnits: number;
  version: number;
};
export const DEFAULT_STOCK_POLICY = { leadDays: 7, safetyDays: 3, targetDays: 30, minimumUnits: 5 };
export function validateStockPolicy(input: Record<string, unknown>) {
  if (
    Object.keys(input).sort().join(',') !==
      'expectedVersion,leadDays,minimumUnits,safetyDays,targetDays' ||
    !Number.isInteger(input.leadDays) ||
    (input.leadDays as number) < 0 ||
    (input.leadDays as number) > 180 ||
    !Number.isInteger(input.safetyDays) ||
    (input.safetyDays as number) < 0 ||
    (input.safetyDays as number) > 90 ||
    !Number.isInteger(input.targetDays) ||
    (input.targetDays as number) < 1 ||
    (input.targetDays as number) > 365 ||
    (input.targetDays as number) < (input.leadDays as number) + (input.safetyDays as number) ||
    !Number.isInteger(input.minimumUnits) ||
    (input.minimumUnits as number) < 0 ||
    (input.minimumUnits as number) > 1000000 ||
    !Number.isInteger(input.expectedVersion) ||
    (input.expectedVersion as number) < 0
  )
    fail(
      400,
      'INVALID_STOCK_POLICY',
      'Revisa días, mínimo y versión. La cobertura objetivo debe cubrir plazo y reserva.',
    );
  return {
    leadDays: input.leadDays as number,
    safetyDays: input.safetyDays as number,
    targetDays: input.targetDays as number,
    minimumUnits: input.minimumUnits as number,
    expectedVersion: input.expectedVersion as number,
  };
}
export function analyzeStock(
  products: Product[],
  inventory: { productId: string; quantity: number }[],
  sales: Sale[],
  from: string,
  to: string,
  policies: StockPolicy[],
) {
  period(from, to);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (days > 366) fail(400, 'INVALID_PERIOD', 'Analiza hasta un año.');
  const included = sales.filter((s) => {
    const date = businessDate(s.createdAt);
    return date >= from && date <= to && !['cancelled', 'returned'].includes(s.status ?? '');
  });
  const rows = products.map((p) => {
    const policy = policies.find((x) => x.productId === p.id) ?? {
      productId: p.id,
      ...DEFAULT_STOCK_POLICY,
      version: 0,
    };
    const unitsSold = included
      .flatMap((s) => remainingSale(s).lines)
      .filter((l) => l.productId === p.id)
      .reduce((sum, l) => sum + l.quantity, 0);
    const stock = inventory.find((x) => x.productId === p.id)?.quantity ?? 0,
      dailyRate = unitsSold / days;
    const reorderPoint = Math.max(
        policy.minimumUnits,
        Math.ceil(dailyRate * (policy.leadDays + policy.safetyDays)),
      ),
      targetUnits = Math.max(reorderPoint, Math.ceil(dailyRate * policy.targetDays));
    const coverageDays = dailyRate > 0 ? stock / dailyRate : null;
    const signals: { code: string; message: string }[] = [];
    if (stock === 0)
      signals.push({
        code: 'out-of-stock',
        message: 'Sin existencias. Revisa si debe reponerse; podría ser un artículo nuevo.',
      });
    else if ((unitsSold > 0 || policy.version > 0) && stock <= reorderPoint)
      signals.push({
        code: 'reorder',
        message:
          unitsSold > 0
            ? 'Stock en el punto de pedido o por debajo, con el ritmo registrado y los plazos indicados.'
            : 'Stock bajo el mínimo configurado. Sin ventas registradas no se calcula una cantidad de compra.',
      });
    if (!unitsSold && stock > 0)
      signals.push({
        code: 'no-recorded-sales',
        message:
          'Hay existencias sin ventas registradas en el periodo. No demuestra falta de demanda.',
      });
    if (coverageDays !== null && coverageDays > policy.targetDays * 3)
      signals.push({
        code: 'high-coverage',
        message: 'Cobertura estimada superior a tres veces el objetivo. Revisa futuras compras.',
      });
    if (p.priceCents * 75 < p.costCents * 100)
      signals.push({
        code: 'low-margin',
        message: 'Margen de catálogo inferior al 25 %. Evita descuentos sin simular.',
      });
    const actions: string[] = [];
    if (stock === 0 || signals.some((s) => s.code === 'reorder'))
      actions.push('Verificar plazo real y pedidos de compra pendientes antes de reponer.');
    if (!unitsSold && stock > 0)
      actions.push(
        'Comprobar antigüedad del artículo y cobertura de los datos.',
        'Revisar ficha, fotografías y visibilidad en la tienda.',
        'Valorar un pack complementario o una campaña simulada; no aplicar descuentos automáticamente.',
      );
    if (signals.some((s) => s.code === 'high-coverage'))
      actions.push('Reducir o aplazar próximas compras hasta revisar la cobertura.');
    return {
      productId: p.id,
      sku: p.sku,
      name: p.name,
      category: p.category,
      stock,
      unitsSold,
      observedDays: days,
      dailyRate,
      coverageDays,
      reorderPoint,
      targetUnits,
      suggestedOrderUnits:
        unitsSold > 0 && stock <= reorderPoint ? Math.max(0, targetUnits - stock) : null,
      policy,
      policyIsDefault: policy.version === 0,
      signals,
      actions,
    };
  });
  return {
    from,
    to,
    days,
    rows: rows.map((row) => ({
      ...row,
      alternatives: rows
        .filter(
          (other) =>
            other.productId !== row.productId &&
            other.category === row.category &&
            other.stock > 0 &&
            other.unitsSold > row.unitsSold,
        )
        .sort((a, b) => b.unitsSold - a.unitsSold || a.sku.localeCompare(b.sku))
        .slice(0, 2)
        .map((p) => ({ sku: p.sku, name: p.name, unitsSold: p.unitsSold })),
    })),
    scope:
      'Estimación con pedidos registrados no cancelados/devueltos y stock actual. No predicción de demanda ni control de compras en tránsito. Valores predeterminados son hipótesis, no plazos reales.',
  };
}
export interface StockPolicyRepository {
  products(): Product[];
  all(): StockPolicy[];
  put(policy: StockPolicy, expectedVersion: number): boolean;
  transaction<T>(op: () => T): T;
  record(actor: string, action: string, detail: unknown): void;
}
export class ConfigureStockPolicy {
  repo: StockPolicyRepository;
  constructor(repo: StockPolicyRepository) {
    this.repo = repo;
  }
  execute(actor: { id: string; role: string }, productId: string, input: Record<string, unknown>) {
    if (actor.role !== 'editor') fail(403, 'FORBIDDEN', 'Solo edición configura reposición.');
    const value = validateStockPolicy(input);
    return this.repo.transaction(() => {
      if (!this.repo.products().some((p) => p.id === productId))
        fail(404, 'PRODUCT_NOT_FOUND', 'Artículo activo no encontrado.');
      const prior = this.repo.all().find((p) => p.productId === productId);
      if ((prior?.version ?? 0) !== value.expectedVersion)
        fail(409, 'POLICY_CHANGED', 'La configuración ha cambiado. Actualiza.');
      const next = {
        productId,
        leadDays: value.leadDays,
        safetyDays: value.safetyDays,
        targetDays: value.targetDays,
        minimumUnits: value.minimumUnits,
        version: value.expectedVersion + 1,
      };
      if (!this.repo.put(next, value.expectedVersion))
        fail(409, 'POLICY_CHANGED', 'La configuración ha cambiado. Actualiza.');
      this.repo.record(actor.id, 'stock.policy-updated', next);
      return next;
    });
  }
}
