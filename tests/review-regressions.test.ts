import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serverAddress, ollamaBase, localModel } from '../src/infrastructure/runtime-config.ts';
import { LocalCommercialAI } from '../src/infrastructure/commercial-ai.ts';
import {
  shoppingAdvice,
  explainFollowUp,
  incidentReply,
  type CommercialAI,
} from '../src/application/shopping-assistance.ts';
import { Store, sha } from '../src/infrastructure/store.ts';
import { OperationStore } from '../src/infrastructure/operation-store.ts';
import { Purchases, type Purchase } from '../src/application/operations.ts';
import { DocumentImports, type DocumentImport } from '../src/application/document-imports.ts';
import { dailyWork } from '../src/application/workbench.ts';
import type { Proposal } from '../src/domain/catalog.ts';
test('configuración mantiene loopback y solo permite apertura explícita para Docker', () => {
  assert.deepEqual(serverAddress({}), { host: '127.0.0.1', port: 4317 });
  assert.deepEqual(serverAddress({ CHANGELAB_HOST: '0.0.0.0', PORT: '4320' }), {
    host: '0.0.0.0',
    port: 4320,
  });
  for (const env of [
    { PORT: '0' },
    { PORT: '99999' },
    { PORT: 'NaN' },
    { CHANGELAB_HOST: 'public.example' },
  ])
    assert.throws(() => serverAddress(env));
});
test('Ollama configurable sigue siendo local y bloquea etiquetas cloud y redirecciones remotas', () => {
  assert.equal(
    ollamaBase('http://host.docker.internal:11434'),
    'http://host.docker.internal:11434',
  );
  assert.equal(ollamaBase('http://ollama:11434'), 'http://ollama:11434');
  for (const endpoint of [
    'https://example.com',
    'http://169.254.169.254',
    'http://localhost:11434/private',
    'http://user:secret@localhost:11434',
    'http://localhost:11434/?key=x',
  ])
    assert.throws(() => ollamaBase(endpoint));
  assert.equal(localModel('qwen3:4b-instruct'), 'qwen3:4b-instruct');
  for (const model of ['model:cloud', 'gpt-oss:120b-cloud', 'model:CLOUD', 'bad model'])
    assert.throws(() => localModel(model));
  assert.throws(() => new LocalCommercialAI('model:cloud'));
});
test('asistente recibe presupuesto total y límite de productos en contexto y esquema', async () => {
  let sent: Record<string, unknown> = {};
  const ai = new LocalCommercialAI('fixture', async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    assert.equal(init?.redirect, 'error');
    return new Response(JSON.stringify({ message: { content: '{"ids":["glass"]}' } }));
  });
  const products = [
    {
      id: 'glass',
      sku: 'G',
      name: 'Cristales',
      description: 'Para cristales',
      priceCents: 890,
      quantity: 4,
      category: 'Cristales',
    },
  ];
  const result = await shoppingAdvice(
    ai,
    { need: 'Solo un limpiacristales', budgetCents: 2000, maxItems: 1 },
    products,
  );
  assert.equal(result.products.length, 1);
  const messages = sent.messages as { content: string }[];
  const input = JSON.parse(messages[1]!.content);
  assert.equal(input.budgetCents, 2000);
  assert.equal(input.maxItems, 1);
  const format = sent.format as { properties: { ids: { maxItems: number } } };
  assert.equal(format.properties.ids.maxItems, 1);
});
test('catálogo sin candidatos no llama al modelo ni presenta selección inventada', async () => {
  let invoked = false;
  const ai: CommercialAI = {
    select: async () => {
      invoked = true;
      return { ids: ['invented'] };
    },
    draft: async () => ({}),
    extract: async () => ({}),
    classify: async () => ({}),
  };
  const result = await shoppingAdvice(
    ai,
    { need: 'Limpiar cristales', budgetCents: 100, maxItems: 1 },
    [],
  );
  assert.equal(invoked, false);
  assert.equal(result.modelUsed, false);
  assert.deepEqual(result.products, []);
});
test('el asistente pregunta por tapicería y solo considera fichas con compatibilidad explícita', async () => {
  const base = { sku: 'QA', priceCents: 900, quantity: 2, category: 'Interior' };
  const products = [
    { ...base, id: 'plastic', name: 'Acondicionador de plásticos', description: 'Para plásticos.' },
    {
      ...base,
      id: 'cloth',
      name: 'Limpiador de tela',
      description: 'Apto para tapicerías de tela.',
    },
    {
      ...base,
      id: 'excluded',
      name: 'Otro limpiador',
      description: 'No apto para tapicerías de tela.',
    },
  ];
  let calls = 0;
  const ai: CommercialAI = {
    select: async (_need, candidates) => {
      calls++;
      assert.deepEqual(
        candidates.map((product) => product.id),
        ['cloth'],
      );
      return { ids: ['cloth'] };
    },
    draft: async () => ({}),
    extract: async () => ({}),
    classify: async () => ({}),
  };
  const input = { need: 'Quiero limpiar los asientos', budgetCents: 3000 };
  for (const need of [input.need, 'Limpiar los asientos, no sé si son tela o piel']) {
    const response = await shoppingAdvice(ai, { ...input, need }, products);
    assert.deepEqual(response.products, []);
    assert.deepEqual(
      response.materials?.map((option) => option.id),
      ['tela', 'cuero', 'alcantara'],
    );
  }
  const unknown = await shoppingAdvice(ai, { ...input, upholsteryMaterial: 'cuero' }, products);
  assert.match(unknown.notice, /compatibilidad confirmada/);
  assert.equal(calls, 0);
  const result = await shoppingAdvice(ai, { ...input, upholsteryMaterial: 'tela' }, products);
  assert.equal(result.products[0]?.id, 'cloth');
  assert.equal(calls, 1);
  const directMaterial = await shoppingAdvice(
    ai,
    { ...input, need: 'Quiero limpiar cuero' },
    products,
  );
  assert.deepEqual(directMaterial.products, []);
  assert.match(directMaterial.notice, /compatibilidad confirmada/);
  assert.equal(calls, 1);
});
test('lectura de compra corrupta se bloquea sin cambiar precios o historial', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const repo = new OperationStore<Purchase>(store, 'purchase');
  const service = new Purchases(
    repo,
    () => store.products(),
    () => ({ name: 'Proveedor QA', active: 1 }),
    () => {},
    randomUUID,
    () => new Date().toISOString(),
  );
  const value = service.create(
    { id: 'qa', role: 'editor' },
    {
      supplierId: 'supplier',
      reason: 'Reponer artículo',
      lines: [{ productId: 'nc1', quantity: 2 }],
    },
  );
  const prior = store.products(),
    events = store.audit();
  store.db
    .prepare('UPDATE operation_documents SET document=? WHERE kind=? AND id=?')
    .run(JSON.stringify({ ...value, totalCents: 1 }), 'purchase', value.id);
  assert.throws(
    () => repo.get(value.id),
    (e) => (e as { code: string }).code === 'CORRUPT_OPERATION',
  );
  assert.throws(() => repo.all());
  assert.deepEqual(store.products(), prior);
  assert.deepEqual(store.audit(), events);
});
test('texto de documento alterado no se acepta como evidencia original', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const repo = new OperationStore<DocumentImport>(store, 'document-import'),
    service = new DocumentImports(
      repo,
      () => store.products(),
      sha,
      randomUUID,
      () => new Date().toISOString(),
    );
  const value = service.save({ id: 'qa', role: 'editor' }, 'NA-001;2;5,00', [], false);
  store.db
    .prepare('UPDATE operation_documents SET document=? WHERE kind=? AND id=?')
    .run(JSON.stringify({ ...value, source: 'NA-001;99;1,00' }), 'document-import', value.id);
  assert.throws(
    () => repo.get(value.id),
    (e) => (e as { code: string }).code === 'CORRUPT_OPERATION',
  );
});
test('bandeja distingue una propuesta desactualizada de una lista para revisar', () => {
  const p: Proposal = {
    id: 'proposal',
    instruction: 'Revisar precio',
    createdBy: 'qa',
    createdAt: new Date().toISOString(),
    plan: { category: 'Prueba', basisPoints: 500 },
    changes: [
      { productId: 'p', name: 'Producto', baseVersion: 1, beforeCents: 1000, afterCents: 1050 },
    ],
    findings: [],
    digest: 'fixture',
    status: 'ready',
  };
  const tasks = dailyWork({
    products: [
      {
        id: 'p',
        sku: 'P',
        name: 'Producto',
        category: 'Prueba',
        priceCents: 1200,
        costCents: 500,
        version: 2,
      },
    ],
    sales: [],
    purchases: [],
    incidents: [],
    proposals: [p],
    stock: [],
    reconciliation: [],
  });
  assert.match(tasks[0]!.title, /desactualizada/);
  assert.match(tasks[0]!.detail, /no puede publicarse/);
});

test('el seguimiento explica periodos completos e incompletos con cifras observadas', () => {
  const totals = { units: 1, revenueCents: 2366, marginCents: 1166, excludedHistoricalOrders: 0 };
  const report = {
    id: 'p',
    category: 'Interior',
    appliedAt: '2026-10-29T10:00:00Z',
    before: { ...totals, units: 0, revenueCents: 0, marginCents: 0 },
    after: totals,
    complete: false,
    observedDays: 0.1,
    overlappingChanges: 0,
    currentProductCount: 1,
  };
  const result = explainFollowUp(report);
  assert.equal(result.modelUsed, false);
  assert.match(result.text, /23,66/);
  assert.match(result.text, /No hay cambios cercanos/);
  assert.match(result.text, /no se pueden comparar/);
  const full = explainFollowUp({
    ...report,
    complete: true,
    observedDays: 14,
    overlappingChanges: 2,
  });
  assert.equal(full.modelUsed, false);
  assert.match(full.text, /Antes.*0 unidades.*Después.*1 unidad.*23,66.*11,66/);
  assert.match(full.text, /2 cambios cercanos.*no permite atribuir/);
});

test('la clasificación de incidencias no puede añadir compromisos al borrador', async () => {
  const ai: CommercialAI = {
    select: async () => ({ ids: [] }),
    draft: async () => ({}),
    extract: async () => ({}),
    classify: async () => ({ kind: 'delivery' }),
  };
  const valid = await incidentReply(ai, { description: 'El pedido no ha llegado.' });
  assert.match(valid.text, /revisará el estado del pedido/);
  await assert.rejects(
    incidentReply(
      {
        ...ai,
        classify: async () => ({ kind: 'delivery', text: 'Te devolveremos 500 euros mañana.' }),
      },
      {},
    ),
  );
  await assert.rejects(incidentReply({ ...ai, classify: async () => ({ kind: 'refund' }) }, {}), {
    code: 'INVALID_CLASSIFICATION',
  });
});
