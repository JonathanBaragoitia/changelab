import { mkdir, writeFile } from 'node:fs/promises';
import { LocalCommercialAI } from '../infrastructure/commercial-ai.ts';
import {
  shoppingAdvice,
  explainFollowUp,
  incidentReply,
  dailyBrief,
} from '../application/shopping-assistance.ts';
import { validateExtracted } from '../application/document-imports.ts';
const ai = new LocalCommercialAI(),
  results: unknown[] = [];
async function run(
  name: string,
  operation: () => Promise<unknown>,
  check: (value: any) => boolean,
) {
  const started = Date.now();
  try {
    const value = await operation();
    results.push({
      name,
      accepted: true,
      criterionPassed: check(value),
      durationMs: Date.now() - started,
      value,
    });
  } catch (error) {
    results.push({
      name,
      accepted: false,
      criterionPassed: false,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  console.log(name + ' terminado');
}
const products = [
  {
    id: 'glass',
    sku: 'DEMO-G',
    name: 'Limpiador de cristales',
    description:
      'Limpieza de cristales interiores y exteriores. Seguir instrucciones del fabricante.',
    priceCents: 900,
    quantity: 10,
    category: 'Cristales',
  },
  {
    id: 'tyres',
    sku: 'DEMO-T',
    name: 'Limpiador de neumáticos',
    description: 'Solo para neumáticos. No usar en cristales.',
    priceCents: 1100,
    quantity: 10,
    category: 'Ruedas',
  },
];
await run(
  'shopping-glass',
  () =>
    shoppingAdvice(
      ai,
      { need: 'Quiero limpiar los cristales interiores', budgetCents: 2000 },
      products,
    ),
  (v) => v.products.length === 1 && v.products[0].id === 'glass',
);
await run(
  'shopping-material-without-compatibility',
  () => shoppingAdvice(ai, { need: 'Quiero limpiar cuero', budgetCents: 2000 }, products),
  (v) => !v.modelUsed && v.products.length === 0,
);
await run(
  'document-explicit',
  async () => {
    const source =
      'Tarifa de prueba. Coste unitario neto EUR.\nSKU;Cantidad;Coste unitario neto\nNA-001;2;5,00\nNA-004;3;12,00';
    return validateExtracted(await ai.extract(source), source);
  },
  (v) =>
    v.length === 2 &&
    v.some((r: any) => r.sku === 'NA-001' && r.quantity === 2 && r.costCents === 500) &&
    v.some((r: any) => r.sku === 'NA-004' && r.costCents === 1200),
);
await run(
  'incident-damage',
  () =>
    incidentReply(ai, {
      kind: 'other',
      description: 'El envase llegó roto y el contenido se derramó.',
      status: 'open',
      resolution: '',
    }),
  (v) => v.kind === 'damage' && v.text.length > 10,
);
await run(
  'followup-incomplete',
  async () =>
    explainFollowUp({
      id: 'qa-followup',
      category: 'Cristales',
      appliedAt: '2026-11-08T10:00:00Z',
      currentProductCount: 1,
      before: { units: 30, revenueCents: 30000, marginCents: 12000, excludedHistoricalOrders: 0 },
      after: { units: 5, revenueCents: 5200, marginCents: 2100, excludedHistoricalOrders: 0 },
      observedDays: 2,
      complete: false,
      overlappingChanges: 1,
    }),
  (v) =>
    !v.modelUsed &&
    /5 unidades.*52,00.*21,00.*no se pueden comparar.*1 cambio cercano/.test(v.text),
);
await run(
  'daily-validated',
  () =>
    dailyBrief(ai, [
      {
        id: 'stock-demo',
        title: 'Revisar stock del limpiador de cristales',
        detail: 'Quedan 2 unidades; revisar reposición',
      },
      { id: 'order-demo', title: 'Preparar pedido DEMO', detail: 'Confirmado, sin enviar' },
    ]),
  (v) => {
    const expected = [
      'Revisar stock del limpiador de cristales · Quedan 2 unidades; revisar reposición',
      'Preparar pedido DEMO · Confirmado, sin enviar',
    ];
    const lines = String(v.text).split('\n');
    return lines.length === expected.length && expected.every((fact) => lines.includes(fact));
  },
);
const report = {
  at: new Date().toISOString(),
  model: process.env.CHANGELAB_MODEL ?? 'qwen3:4b-instruct',
  promptVersion: 'operations-v2',
  scope:
    'Seis casos sintéticos de desarrollo, una ejecución. Incluye controles deterministas y llamadas al modelo. No es una evaluación independiente.',
  results,
};
await mkdir('docs/evaluations', { recursive: true });
const path = 'docs/evaluations/operations-' + report.at.replaceAll(':', '-') + '.json';
await writeFile(path, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ path, results }));
