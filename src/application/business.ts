import { remainingSale } from './partial-returns.ts';
import type { Product } from '../domain/catalog.ts';
import { fail } from '../domain/catalog.ts';
import type { Sale } from './commerce.ts';
import { businessDate } from './economics.ts';
export type BusinessContext = ReturnType<typeof businessContext>;
export function businessContext(
  products: Product[],
  inventory: { productId: string; quantity: number }[],
  sales: Sale[],
  from: string,
  to: string,
) {
  const selected = sales.filter((s) => {
    const date = businessDate(s.createdAt);
    return date >= from && date <= to && !['cancelled', 'returned'].includes(s.status ?? '');
  });
  const categories = [...new Set(products.map((p) => p.category))].map((category) => {
    const items = products.filter((p) => p.category === category),
      ids = new Set(items.map((p) => p.id));
    const unitsSold = selected
      .flatMap((s) => remainingSale(s).lines)
      .filter((line) => ids.has(line.productId))
      .reduce((sum, line) => sum + line.quantity, 0);
    const stock = items.reduce(
      (sum, p) => sum + (inventory.find((row) => row.productId === p.id)?.quantity ?? 0),
      0,
    );
    const outOfStock = items.filter(
      (p) => (inventory.find((row) => row.productId === p.id)?.quantity ?? 0) === 0,
    ).length;
    const lowMargin = items.filter(
      (p) => (p.priceCents - p.costCents) * 100 < p.priceCents * 25,
    ).length;
    return { category, products: items.length, stock, unitsSold, outOfStock, lowMargin };
  });
  const opportunities = categories.flatMap((row, index) => {
    const result: { id: string; category: string; code: string; message: string }[] = [];
    if (row.stock > 0 && row.unitsSold === 0)
      result.push({
        id: 'c' + index + '-no-sales',
        category: row.category,
        code: 'stock-without-recorded-sales',
        message:
          row.stock +
          ' unidades en stock y ninguna unidad vendida registrada en el periodo. Revisar antes de plantear promociones.',
      });
    if (row.outOfStock > 0)
      result.push({
        id: 'c' + index + '-no-stock',
        category: row.category,
        code: 'out-of-stock',
        message:
          row.outOfStock + ' artículos activos sin existencias. Revisar necesidad de reposición.',
      });
    if (row.lowMargin > 0)
      result.push({
        id: 'c' + index + '-margin',
        category: row.category,
        code: 'margin-under-25',
        message:
          row.lowMargin +
          ' artículos con margen de catálogo inferior al 25 %. Revisar antes de aplicar descuentos.',
      });
    return result;
  });
  return {
    from,
    to,
    categories,
    opportunities,
    scope: 'Solo datos registrados; no predicción de demanda ni prueba de baja rotación.',
  };
}
export interface OpportunityRanker {
  readonly model?: string;
  rank(input: {
    from: string;
    to: string;
    categories: BusinessContext['categories'];
    opportunities: { id: string; category: string; code: string; priority: number }[];
  }): Promise<unknown>;
}
export function opportunityPriority(code: string) {
  return code === 'margin-under-25' ? 0 : ['out-of-stock', 'stock-reorder'].includes(code) ? 1 : 2;
}
export async function rankOpportunities(context: BusinessContext, ranker: OpportunityRanker) {
  if (!context.opportunities.length)
    return { ids: [] as string[], opportunities: [], modelUsed: false };
  let raw: unknown;
  try {
    raw = await ranker.rank({
      from: context.from,
      to: context.to,
      categories: context.categories,
      opportunities: context.opportunities.map(({ id, category, code }) => ({
        id,
        category,
        code,
        priority: opportunityPriority(code),
      })),
    });
  } catch {
    fail(
      502,
      'BUSINESS_MODEL_FAILED',
      'No se pudo priorizar con el modelo local. Las señales calculadas siguen disponibles.',
    );
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    fail(502, 'INVALID_RANKING', 'Respuesta del modelo no válida.');
  const value = raw as Record<string, unknown>;
  if (
    Object.keys(value).join(',') !== 'ids' ||
    !Array.isArray(value.ids) ||
    value.ids.length > 5 ||
    new Set(value.ids).size !== value.ids.length ||
    value.ids.some(
      (id) => typeof id !== 'string' || !context.opportunities.some((o) => o.id === id),
    )
  )
    fail(
      502,
      'INVALID_RANKING',
      'El modelo debe seleccionar hasta cinco señales existentes, sin inventarlas.',
    );

  const ids = value.ids as string[];
  const priority = (id: string) => {
    const code = context.opportunities.find((o) => o.id === id)!.code;
    return opportunityPriority(code);
  };
  if (
    ids.some((id, index) => index > 0 && priority(id) < priority(ids[index - 1]!)) ||
    (ids.length > 0 &&
      context.opportunities.some(
        (o) => !ids.includes(o.id) && priority(o.id) < priority(ids[ids.length - 1]!),
      ))
  )
    fail(
      502,
      'INVALID_PRIORITY',
      'La selección del modelo omite señales de mayor prioridad. Consulta las señales verificables.',
    );
  return {
    ids,
    opportunities: ids.map((id) => context.opportunities.find((o) => o.id === id)!),
    modelUsed: true,
  };
}

export function businessProposalInput(context: BusinessContext, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail(400, 'INVALID_BUSINESS_PROPOSAL', 'Propuesta no válida.');
  const v = input as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (key) => !['contextHash', 'signalId', 'basisPoints', 'reason'].includes(key),
    ) ||
    typeof v.contextHash !== 'string' ||
    typeof v.signalId !== 'string' ||
    !Number.isInteger(v.basisPoints) ||
    Math.abs(v.basisPoints as number) > 5000 ||
    v.basisPoints === 0 ||
    typeof v.reason !== 'string' ||
    v.reason.trim().length < 5 ||
    v.reason.length > 300
  )
    fail(
      400,
      'INVALID_BUSINESS_PROPOSAL',
      'Selecciona una señal, una variación entre −50 % y +50 % distinta de cero y un motivo.',
    );
  const signal = context.opportunities.find((o) => o.id === v.signalId);
  if (!signal) fail(409, 'SIGNAL_CHANGED', 'La señal ya no está disponible.');
  if (!['stock-without-recorded-sales', 'margin-under-25'].includes(signal.code))
    fail(
      400,
      'SIGNAL_NOT_PRICING',
      'Esta señal requiere revisar existencias o estrategia; prepara una campaña explícita para valorar precios.',
    );
  const row = context.categories.find((c) => c.category === signal.category)!;
  return {
    plan: { category: signal.category, basisPoints: v.basisPoints },
    instruction:
      'Revisión comercial desde señal ' +
      signal.id +
      ' (' +
      context.from +
      ' — ' +
      context.to +
      '). ' +
      signal.message +
      ' Datos: stock ' +
      row.stock +
      ', unidades vendidas registradas ' +
      row.unitsSold +
      '. Contexto ' +
      v.contextHash +
      '. Motivo del editor: ' +
      v.reason.trim(),
  };
}
