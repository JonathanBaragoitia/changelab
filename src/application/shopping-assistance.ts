import { fail } from '../domain/catalog.ts';
import { fields, integer, object, text } from './operations.ts';
import type { followUp } from './workbench.ts';
import type { TariffExplanationOption } from './tariff-proposal.ts';
export type PublicProduct = {
  id: string;
  sku: string;
  name: string;
  description: unknown;
  priceCents: number;
  quantity: unknown;
  category: string;
};
export interface CommercialAI {
  explainTariff?(options: TariffExplanationOption[]): Promise<unknown>;
  select(
    need: string,
    products: PublicProduct[],
    limits: { budgetCents: number; maxItems: number },
  ): Promise<unknown>;
  prioritize?(tasks: { id: string; title: string; detail: string }[]): Promise<unknown>;
  draft(task: string, data: unknown): Promise<unknown>;
  extract(source: string): Promise<unknown>;
  classify(data: unknown): Promise<unknown>;
}
const upholsteryMaterials = [
  { id: 'tela', label: 'Tela' },
  { id: 'cuero', label: 'Cuero' },
  { id: 'alcantara', label: 'Alcántara' },
] as const;

function normalized(value: string) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export async function shoppingAdvice(
  ai: CommercialAI,
  body: Record<string, unknown>,
  catalog: PublicProduct[],
) {
  fields(body, ['need', 'budgetCents', 'maxItems', 'upholsteryMaterial']);
  const need = text(body.need, 5, 700),
    budget = integer(body.budgetCents, 1, 1000000),
    maxItems = body.maxItems === undefined ? 3 : integer(body.maxItems, 1, 3);
  const chosen = upholsteryMaterials.find((material) => material.id === body.upholsteryMaterial);
  if (body.upholsteryMaterial !== undefined && !chosen)
    fail(400, 'INVALID_MATERIAL', 'Selecciona un material de la lista.');
  let products = catalog.filter(
    (p) => Number(p.quantity) > 0 && Math.round((p.priceCents * 121) / 100) <= budget,
  );
  if (!products.length)
    return {
      products: [],
      modelUsed: false,
      notice:
        'No hay artículos disponibles que encajen en ese presupuesto. Revisa el catálogo o cambia el importe.',
    };
  const query = normalized(need);
  const upholstery =
    chosen !== undefined ||
    /\b(?:asientos?|tapicerias?|banquetas?|cuero|piel|alcantara)\b/.test(query) ||
    /\b(?:limpiar|lavar|tratar|cuidar|proteger)\s+(?:la\s+)?tela\b/.test(query);
  const stated = upholsteryMaterials.filter((material) =>
    new RegExp('\\b' + (material.id === 'cuero' ? '(?:cuero|piel)' : material.id) + '\\b').test(
      query,
    ),
  );
  const material =
    chosen ??
    (stated.length === 1 && !/\b(?:no|duda|quizas|creo|sintetica|sintetico|imitacion)\b/.test(query)
      ? stated[0]
      : undefined);
  if (upholstery) {
    if (!material)
      return {
        products: [],
        modelUsed: false,
        notice: '¿De qué material son los asientos o la tapicería?',
        materials: upholsteryMaterials,
      };
    // Only explicit positive compatibility claims in the catalogue qualify for upholstery.
    const compatibility = new RegExp(
      '^(?:apto para|compatible con|indicado para) (?:asientos|tapicerias?) de ' +
        material.id +
        '\\.?$',
    );
    products = products.filter(
      (product) =>
        typeof product.description === 'string' &&
        compatibility.test(normalized(product.description.trim())),
    );
    if (!products.length)
      return {
        products: [],
        modelUsed: false,
        notice:
          'No hay fichas con compatibilidad confirmada para ese material dentro de tu presupuesto.',
      };
  }
  const request =
    upholstery && material ? need + ' · Material confirmado: ' + material.label : need;
  const raw = object(await ai.select(request, products, { budgetCents: budget, maxItems }));
  fields(raw, ['ids']);
  if (
    !Array.isArray(raw.ids) ||
    raw.ids.length > maxItems ||
    new Set(raw.ids).size !== raw.ids.length
  )
    fail(502, 'AI_INVALID', 'Selección no válida.');
  const selected = raw.ids.map((id) => {
    const p = products.find((p) => p.id === id);
    if (!p) fail(502, 'AI_INVALID', 'El modelo propuso un artículo no disponible.');
    return { ...p, totalCents: Math.round((p.priceCents * 121) / 100) };
  });
  if (selected.reduce((s, p) => s + p.totalCents, 0) > budget)
    fail(
      502,
      'AI_BUDGET',
      'La selección supera tu presupuesto. Prueba con una necesidad más concreta.',
    );
  return {
    products: selected,
    modelUsed: true,
    notice: selected.length
      ? 'Selección orientativa basada en las fichas. Comprueba superficie, modo de uso y compatibilidad. No se ha añadido nada al carrito.'
      : 'No he encontrado una opción que pueda recomendar con las fichas disponibles. Describe mejor la superficie o el uso; también puedes consultar el catálogo.',
  };
}
export async function safeDraft(ai: CommercialAI, task: string, data: unknown) {
  const result = object(await ai.draft(task, data));
  fields(result, ['text']);
  return { text: text(result.text, 1, 1800), modelUsed: true };
}
const incidentTemplates = {
  damage:
    'Gracias por avisarnos del estado del artículo. Lamentamos la incidencia. El equipo revisará los detalles para valorar el siguiente paso.',
  'wrong-item':
    'Gracias por avisarnos de la diferencia entre el artículo pedido y el recibido. El equipo revisará el pedido y los detalles de la incidencia.',
  delivery:
    'Gracias por avisarnos de la incidencia de entrega. El equipo revisará el estado del pedido y los datos de envío disponibles.',
  other: 'Gracias por ponerte en contacto. El equipo revisará los detalles de tu incidencia.',
} as const;

export async function incidentReply(ai: CommercialAI, data: unknown) {
  const result = object(await ai.classify(data));
  fields(result, ['kind']);
  if (typeof result.kind !== 'string' || !Object.hasOwn(incidentTemplates, result.kind))
    fail(502, 'INVALID_CLASSIFICATION', 'Clasificación no válida.');
  const kind = result.kind as keyof typeof incidentTemplates;
  // The model can choose a draft category. Only the reviewed template reaches the user.
  return { kind, text: incidentTemplates[kind], modelUsed: true };
}
export async function dailyBrief(
  ai: CommercialAI,
  tasks: { id: string; title: string; detail: string }[],
) {
  if (!tasks.length) return { text: 'No hay asuntos pendientes detectados.', modelUsed: false };
  const selected = tasks.slice(0, 30);
  try {
    const result = object(await ai.prioritize?.(selected));
    fields(result, ['ids']);
    if (
      !Array.isArray(result.ids) ||
      result.ids.length !== Math.min(5, selected.length) ||
      new Set(result.ids).size !== result.ids.length ||
      result.ids.some((id) => typeof id !== 'string' || !selected.some((task) => task.id === id))
    )
      throw new Error('Invalid task selection');
    // Only trusted task facts are rendered; model output controls ordering, never factual prose.
    const ordered = result.ids.map((id) => selected.find((task) => task.id === id)!);
    return {
      text: ordered.map((task) => task.title + ' · ' + task.detail).join('\n'),
      modelUsed: true,
    };
  } catch {
    // The work queue remains useful when the model fails or omits its evidence.
    return {
      text: tasks
        .slice(0, 5)
        .map((t) => t.title + ' · ' + t.detail)
        .join('\n'),
      modelUsed: false,
      warning:
        'Se muestra un resumen por reglas: la IA no produjo un resumen verificable o no estaba disponible.',
    };
  }
}
export function explainFollowUp(report: ReturnType<typeof followUp>[number]) {
  const format = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
  const facts = (period: typeof report.before) =>
    `${period.units} ${period.units === 1 ? 'unidad' : 'unidades'}, ${format.format(period.revenueCents / 100)} de ventas netas y ${format.format(period.marginCents / 100)} de margen bruto`;
  const overlap = report.overlappingChanges
    ? `Hay ${report.overlappingChanges} ${report.overlappingChanges === 1 ? 'cambio cercano' : 'cambios cercanos'} sobre los mismos artículos.`
    : 'No hay cambios cercanos registrados sobre los mismos artículos.';
  const text = report.complete
    ? `Se observaron dos ventanas de 14 días. Antes del cambio se registraron ${facts(report.before)}. Después se registraron ${facts(report.after)}. ${overlap} La comparación no controla la estacionalidad ni todas las roturas de stock y no permite atribuir la variación al cambio de precio.`
    : `El periodo posterior todavía no alcanza 14 días. Se han registrado ${facts(report.after)}. Estas cifras no se pueden comparar con una ventana anterior completa ni atribuir al cambio de precio. ${overlap}`;
  return { modelUsed: false, text };
}
