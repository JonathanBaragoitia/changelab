import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Store, sha } from '../src/infrastructure/store.ts';
import { CommerceStore } from '../src/infrastructure/commerce-store.ts';
import { OperationStore } from '../src/infrastructure/operation-store.ts';
import {
  Purchases,
  Incidents,
  type Purchase,
  type Incident,
} from '../src/application/operations.ts';
import {
  PartialReturns,
  returnedValue,
  remainingSale,
  type PartialReturn,
} from '../src/application/partial-returns.ts';
import {
  DocumentImports,
  validateExtracted,
  type DocumentImport,
} from '../src/application/document-imports.ts';
import { dailyWork, followUp } from '../src/application/workbench.ts';
import {
  shoppingAdvice,
  safeDraft,
  dailyBrief,
  type CommercialAI,
} from '../src/application/shopping-assistance.ts';
import { documentText } from '../src/infrastructure/document-text.ts';
import { LocalCommercialAI } from '../src/infrastructure/commercial-ai.ts';
import { demoTax } from '../src/domain/tax.ts';
import { CashStore } from '../src/infrastructure/cash-store.ts';
import { ExpenseStore } from '../src/infrastructure/expense-store.ts';
import { RegisterCash } from '../src/application/cash.ts';
import { RegisterRefund } from '../src/application/refunds.ts';
import { Warehouse } from '../src/application/warehouse.ts';
import { businessContext } from '../src/application/business.ts';
import { economicReport } from '../src/application/economics.ts';
import { makeServer } from '../src/server.ts';
import { sessions } from './auth-fixture.ts';
import type { Sale } from '../src/application/commerce.ts';
const actor = { id: 'elena', role: 'editor' },
  reviewer = { id: 'marcos', role: 'reviewer' },
  viewer = { id: 'lucia', role: 'viewer' };
const now = () => '2026-10-29T12:00:00Z';
function setup(t: test.TestContext) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store);
  store.db
    .prepare('INSERT INTO suppliers VALUES(?,?,?,?,?,?)')
    .run('supplier', 'Proveedor de prueba', '', '', 1, 1);
  return { store, commerce };
}
function sale(commerce: CommerceStore) {
  const lines = [
    {
      productId: 'nc1',
      name: 'Prueba',
      quantity: 3,
      unitPriceCents: 101,
      unitCostCents: 40,
      expectedPriceCents: 101,
    },
  ];
  const value: Sale = {
    id: randomUUID(),
    actorId: 'customer',
    requestId: randomUUID(),
    status: 'shipped',
    createdAt: now(),
    totalCents: 303,
    costCents: 120,
    lines,
    tax: demoTax(lines),
  };
  commerce.saveSale(value);
  return value;
}
const fakeAI: CommercialAI = {
  classify: async () => ({ kind: 'damage' }),
  select: async (_need, products) => ({ ids: products.slice(0, 1).map((p) => p.id) }),
  draft: async () => ({ text: 'Borrador de prueba. Revisa el pedido antes de responder.' }),
  extract: async () => ({
    rows: [{ sku: 'NA-001', quantity: 2, costCents: 500, evidence: 'NA-001;2;5,00' }],
  }),
};
test('compra exige revisión independiente, vigencia y versión, recepción única', (t) => {
  const { store } = setup(t),
    repo = new OperationStore<Purchase>(store, 'purchase');
  let receipts = 0;
  const service = new Purchases(
    repo,
    () => store.products(),
    () => ({ name: 'Proveedor', active: 1 }),
    () => {
      receipts++;
    },
    randomUUID,
    now,
  );
  const input = {
    supplierId: 'supplier',
    reason: 'Reponer artículo de prueba',
    lines: [{ productId: 'nc1', quantity: 2 }],
  };
  assert.throws(() => service.create(viewer, input));
  const p = service.create(actor, input);
  assert.throws(() => service.transition(actor, p.id, { action: 'approve', expectedVersion: 1 }));
  assert.throws(() =>
    service.transition({ ...reviewer, id: actor.id }, p.id, {
      action: 'approve',
      expectedVersion: 1,
    }),
  );
  const a = service.transition(reviewer, p.id, { action: 'approve', expectedVersion: 1 });
  assert.equal(a.status, 'approved');
  assert.throws(() =>
    service.transition(actor, p.id, {
      action: 'receive',
      confirmReceived: true,
      expectedVersion: 1,
      reference: 'ALB-1',
    }),
  );
  const received = service.transition(actor, p.id, {
    action: 'receive',
    confirmReceived: true,
    expectedVersion: 2,
    reference: 'ALB-1',
  });
  assert.equal(received.status, 'received');
  assert.throws(() =>
    service.transition(actor, p.id, {
      action: 'receive',
      confirmReceived: true,
      expectedVersion: 2,
      reference: 'ALB-1',
    }),
  );
  assert.equal(receipts, 1);
  const p2 = service.create(actor, input);
  store.db.prepare('UPDATE products SET version=version+1 WHERE id=?').run('nc1');
  assert.throws(() =>
    service.transition(reviewer, p2.id, { action: 'approve', expectedVersion: 1 }),
  );
});
test('savepoints revierten recepciones y compra cuando falla una escritura anidada', (t) => {
  const { store } = setup(t),
    repo = new OperationStore<Purchase>(store, 'purchase');
  const service = new Purchases(
    repo,
    () => store.products(),
    () => ({ name: 'Proveedor', active: 1 }),
    () => {
      store.transaction(() => {
        store.db.prepare('UPDATE inventory SET quantity=quantity+2 WHERE productId=?').run('nc1');
        store.record('test', 'test.receipt', {});
      });
      throw new Error('second receipt failed');
    },
    randomUUID,
    now,
  );
  const p = service.create(actor, {
    supplierId: 'supplier',
    reason: 'Reponer artículos',
    lines: [{ productId: 'nc1', quantity: 2 }],
  });
  service.transition(reviewer, p.id, { action: 'approve', expectedVersion: 1 });
  const events = store.audit().length;
  assert.throws(() =>
    service.transition(actor, p.id, {
      action: 'receive',
      confirmReceived: true,
      expectedVersion: 2,
      reference: 'ALB',
    }),
  );
  assert.equal(repo.get(p.id)!.status, 'approved');
  assert.equal(
    store.db.prepare('SELECT quantity FROM inventory WHERE productId=?').get('nc1')!.quantity,
    20,
  );
  assert.equal(store.audit().length, events);
});
test('devoluciones sucesivas conservan unidades, céntimos, stock y pedido original', (t) => {
  const { store, commerce } = setup(t),
    s = sale(commerce),
    repo = new OperationStore<PartialReturn>(store, 'partial-return');
  const service = new PartialReturns(
    repo,
    (id) => commerce.sale(id),
    (r, s) => commerce.applyPartialReturn(r, s),
    now,
  );
  const input = {
    requestId: randomUUID(),
    orderId: s.id,
    productId: 'nc1',
    quantity: 1,
    expectedReturned: 0,
    reason: 'Producto devuelto apto',
    confirmReceived: true,
  };
  assert.throws(() => service.execute(viewer, input));
  const first = service.execute(actor, input);
  assert.equal(first.grossCents, 122);
  assert.deepEqual(service.execute(actor, input), first);
  assert.throws(() => service.execute(actor, { ...input, requestId: randomUUID() }));
  assert.throws(() =>
    new Warehouse(commerce, now).returnAll(actor, s.id, {
      reason: 'Todo devuelto ahora',
      confirmReceived: true,
    }),
  );
  const partial = commerce.sale(s.id)!;
  assert.equal(remainingSale(partial).totalCents, 202);
  assert.equal(remainingSale(partial).tax!.totalCents, 245);
  assert.equal(commerce.snapshot().metrics.revenueCents, 202);
  const context = businessContext(store.products(), [], [partial], '2026-10-29', '2026-10-29');
  assert.equal(
    context.categories.find(
      (c) => c.category === store.products().find((p) => p.id === 'nc1')!.category,
    )!.unitsSold,
    2,
  );
  assert.equal(economicReport([partial], [], '2026-10-29', '2026-10-29').revenueCents, 202);
  const second = service.execute(actor, { ...input, requestId: randomUUID(), expectedReturned: 1 }),
    third = service.execute(actor, { ...input, requestId: randomUUID(), expectedReturned: 2 });
  assert.equal(first.grossCents + second.grossCents + third.grossCents, 367);
  assert.equal(commerce.sale(s.id)!.status, 'returned');
  assert.equal(returnedValue(commerce.sale(s.id)!), 367);
  assert.equal(commerce.sale(s.id)!.totalCents, 303);
  assert.equal(
    store.db.prepare('SELECT quantity FROM inventory WHERE productId=?').get('nc1')!.quantity,
    23,
  );
});
test('devolver una unidad apta en el límite de stock revierte la recepción; dañada queda fuera del stock', (t) => {
  const { store, commerce } = setup(t);
  const shipped = sale(commerce);
  const repo = new OperationStore<PartialReturn>(store, 'partial-return');
  const returns = new PartialReturns(
    repo,
    (id) => commerce.sale(id),
    (value, updated) => commerce.applyPartialReturn(value, updated),
    now,
  );
  store.db.prepare('UPDATE inventory SET quantity=1000000 WHERE productId=?').run('nc1');
  const before = commerce.snapshot();
  const audit = store.audit();
  const input = {
    requestId: randomUUID(),
    orderId: shipped.id,
    productId: 'nc1',
    quantity: 1,
    expectedReturned: 0,
    reason: 'Unidad devuelta por el cliente',
    confirmReceived: true,
  };
  assert.throws(() => returns.execute(actor, input), { code: 'STOCK_LIMIT' });
  assert.deepEqual(commerce.snapshot(), before);
  assert.deepEqual(store.audit(), audit);
  assert.equal(repo.get(input.requestId), undefined);
  returns.execute(actor, { ...input, condition: 'damaged' });
  assert.deepEqual(commerce.snapshot().inventory, before.inventory);
  assert.deepEqual(commerce.snapshot().movements, before.movements);
  assert.equal(commerce.sale(shipped.id)?.returnedQuantities?.[0]?.quantity, 1);
});
test('devolución parcial limita reembolso y permite cobrar el saldo después', (t) => {
  const { store, commerce } = setup(t),
    s = sale(commerce),
    cash = new CashStore(store, commerce, new ExpenseStore(store)),
    register = new RegisterCash(cash),
    refund = new RegisterRefund(cash);
  const entry = {
    requestId: randomUUID(),
    kind: 'collection',
    targetId: s.id,
    amountCents: 150,
    date: '2026-10-29',
    reference: 'COBRO-1',
    method: 'Efectivo',
  };
  register.execute(actor, entry);
  const returns = new PartialReturns(
    new OperationStore<PartialReturn>(store, 'partial-return'),
    (id) => commerce.sale(id),
    (r, s) => commerce.applyPartialReturn(r, s),
    now,
  );
  returns.execute(actor, {
    requestId: randomUUID(),
    orderId: s.id,
    productId: 'nc1',
    quantity: 1,
    expectedReturned: 0,
    reason: 'Devuelto por cliente',
    confirmReceived: true,
  });
  assert.equal(cash.refundable(s.id), 122);
  assert.throws(() =>
    refund.execute(actor, {
      requestId: randomUUID(),
      orderId: s.id,
      amountCents: 123,
      date: '2026-10-29',
      reference: 'REF-TOO',
      reason: 'Demasiado importe',
    }),
  );
  refund.execute(actor, {
    requestId: randomUUID(),
    orderId: s.id,
    amountCents: 122,
    date: '2026-10-29',
    reference: 'REF-OK',
    reason: 'Devolución recibida',
  });
  assert.equal(cash.refundable(s.id), 0);
  register.execute(actor, {
    ...entry,
    requestId: randomUUID(),
    amountCents: 217,
    reference: 'COBRO-2',
  });
  const target = cash.report().targets.find((t) => t.id === s.id)!;
  assert.equal(target.pendingCents, 0);
  assert.equal(target.settledCents, 245);
});
test('incidencias enlazan pedidos, conservan resolución y rechazan cambios de versión', (t) => {
  const { store } = setup(t),
    repo = new OperationStore<Incident>(store, 'incident'),
    service = new Incidents(repo, (id) => id === 'ORDER', randomUUID, now);
  const body = { orderId: 'ORDER', kind: 'damage', description: 'El envase llegó roto.' };
  assert.throws(() => service.create(viewer, body));
  assert.throws(() => service.create(actor, { ...body, orderId: 'missing' }));
  const i = service.create(actor, body);
  const updated = service.update(actor, i.id, {
    expectedVersion: 1,
    status: 'resolved',
    resolution: 'Se acordó una devolución.',
  });
  assert.equal(updated.status, 'resolved');
  assert.throws(() =>
    service.update(actor, i.id, {
      expectedVersion: 1,
      status: 'investigating',
      resolution: 'Intento posterior',
    }),
  );
  assert.equal(repo.get(i.id)!.description, body.description);
});
test('bandeja agrega solo asuntos abiertos y no expone datos del cliente', () => {
  const tasks = dailyWork({
    products: [],
    sales: [
      {
        id: 'ORDER',
        status: 'confirmed',
        customer: { name: 'PRIVATE', email: 'secret@example.com', address: 'PRIVATE' },
      } as Sale,
    ],
    purchases: [],
    incidents: [],
    proposals: [],
    stock: [],
    reconciliation: [],
  });
  assert.equal(tasks[0]!.area, 'warehouse');
  assert.ok(!JSON.stringify(tasks).includes('PRIVATE'));
});
test('seguimiento usa mismos artículos, ventanas y avisa de periodo incompleto y solapamiento', () => {
  const proposal = {
    id: 'p',
    status: 'applied',
    appliedAt: '2026-10-20T12:00:00Z',
    plan: { category: 'Test' },
    changes: [{ productId: 'nc1' }],
  } as any;
  const line = { productId: 'nc1', quantity: 2, unitPriceCents: 500, unitCostCents: 300 };
  const sales = [
    { createdAt: '2026-10-19T12:00:00Z', lines: [line], tax: demoTax([line]) },
    { createdAt: '2026-10-21T12:00:00Z', lines: [line], tax: demoTax([line]) },
  ] as Sale[];
  const r = followUp([proposal, { ...proposal, id: 'other' }], sales, [], now())[0]!;
  assert.equal(r.before.units, 2);
  assert.equal(r.after.marginCents, 400);
  assert.equal(r.complete, false);
  assert.equal(r.overlappingChanges, 1);
  const legacy = followUp(
    [proposal],
    [{ createdAt: '2026-10-19T12:00:00Z', lines: [line] } as Sale],
    [],
    now(),
  )[0]!;
  assert.equal(legacy.before.units, 0);
  assert.equal(legacy.before.excludedHistoricalOrders, 1);
});
test('asistente solo devuelve catálogo público disponible y dentro del presupuesto', async () => {
  const products = [
    {
      id: 'a',
      sku: 'A',
      name: 'Cristales',
      description: 'Para cristales',
      priceCents: 1000,
      quantity: 3,
      category: 'Test',
    },
  ];
  const r = await shoppingAdvice(
    fakeAI,
    { need: 'Limpiar cristales', budgetCents: 1500 },
    products,
  );
  assert.equal(r.products[0]!.totalCents, 1210);
  await assert.rejects(
    shoppingAdvice(
      { ...fakeAI, select: async () => ({ ids: ['invented'] }) },
      { need: 'Cristales', budgetCents: 1500 },
      products,
    ),
  );
  await assert.rejects(
    shoppingAdvice(
      { ...fakeAI, select: async () => ({ ids: ['a', 'a'] }) },
      { need: 'Cristales', budgetCents: 1500 },
      products,
    ),
  );
  assert.equal(
    (await shoppingAdvice(fakeAI, { need: 'Cristales', budgetCents: 500 }, products)).products
      .length,
    0,
  );
  await assert.rejects(
    safeDraft({ ...fakeAI, draft: async () => ({ text: 'Algo', execute: 'SQL' }) }, 'Resumen', []),
  );
});
test('extracción exige evidencia literal, importes presentes y referencias únicas', () => {
  const evidence = 'NA-001;2;5,00;10,00';
  const source = 'SKU;Cantidad;Coste unitario neto;Total\n' + evidence;
  const row = { sku: 'NA-001', quantity: 2, costCents: 500, evidence };
  assert.deepEqual(validateExtracted({ rows: [row] }, source), [row]);
  assert.deepEqual(
    validateExtracted({ rows: [{ ...row, quantity: 1, costCents: 1000 }] }, source),
    [{ ...row, quantity: null, costCents: null }],
  );
  assert.deepEqual(validateExtracted({ rows: [row] }, evidence), [
    { ...row, quantity: null, costCents: null },
  ]);
  const labelled = {
    ...row,
    evidence: 'SKU: NA-001 | Unidades: 2 | Precio unitario sin IVA: 5,00 EUR | Total: 10,00',
  };
  assert.deepEqual(validateExtracted({ rows: [labelled] }, labelled.evidence), [labelled]);
  const ambiguous = {
    ...labelled,
    evidence: labelled.evidence + ' | Coste unitario neto: pendiente',
  };
  assert.deepEqual(validateExtracted({ rows: [ambiguous] }, ambiguous.evidence), [
    { ...ambiguous, costCents: null },
  ]);
  assert.deepEqual(
    validateExtracted({ rows: [row] }, source.replace('Coste unitario neto', 'IVA incluido')),
    [{ ...row, costCents: null }],
  );
  for (const rows of [
    [{ ...row, sku: 'NA-00' }],
    [{ ...row, evidence: 'NA-001;2;5,00' }],
    [{ ...row, evidence: 'texto inventado' }],
    [row, row],
  ])
    assert.throws(() => validateExtracted({ rows }, source));
});
test('importación exige confirmación, referencia conocida y no repite efectos', (t) => {
  const { store } = setup(t),
    repo = new OperationStore<DocumentImport>(store, 'document-import'),
    service = new DocumentImports(repo, () => store.products(), sha, randomUUID, now);
  const doc = service.save(actor, 'Texto del documento', [], false);
  let effects = 0;
  const body = {
    expectedVersion: 1,
    confirmReviewed: true,
    kind: 'receipt',
    supplierId: 'supplier',
    reference: 'ALB',
    rows: [{ sku: store.products()[0]!.sku, quantity: 2, costCents: null }],
  };
  assert.throws(() => service.process(viewer, doc.id, body, () => {}));
  assert.throws(() =>
    service.process(actor, doc.id, { ...body, confirmReviewed: false }, () => {}),
  );
  service.process(actor, doc.id, body, () => {
    effects++;
    return { received: true };
  });
  assert.throws(() =>
    service.process(actor, doc.id, body, () => {
      effects++;
    }),
  );
  assert.equal(effects, 1);
});
test('un fallo al incorporar documento revierte todos los movimientos y su estado', (t) => {
  const { store } = setup(t),
    repo = new OperationStore<DocumentImport>(store, 'document-import'),
    service = new DocumentImports(repo, () => store.products(), sha, randomUUID, now),
    doc = service.save(actor, 'Texto original', [], false);
  assert.throws(() =>
    service.process(
      actor,
      doc.id,
      {
        expectedVersion: 1,
        confirmReviewed: true,
        kind: 'receipt',
        supplierId: 'supplier',
        reference: 'ALB',
        rows: [{ sku: store.products()[0]!.sku, quantity: 2, costCents: null }],
      },
      () => {
        store.transaction(() => store.db.prepare('UPDATE inventory SET quantity=quantity+2').run());
        throw new Error('failed');
      },
    ),
  );
  assert.equal(repo.get(doc.id)!.status, 'review');
  assert.equal(store.db.prepare('SELECT quantity FROM inventory LIMIT 1').get()!.quantity, 20);
});
test('PDF inválido y texto sobredimensionado se rechazan antes de interpretar', async () => {
  await assert.rejects(
    documentText({ format: 'pdf', source: Buffer.from('not PDF').toString('base64') }),
  );
  await assert.rejects(documentText({ format: 'text', source: 'x'.repeat(12001) }));
  assert.equal(await documentText({ format: 'text', source: 'NA-001;2;5,00' }), 'NA-001;2;5,00');
});
test('API completa compras, incidencias y documentos mantiene permisos y CSRF', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const server = makeServer(store, undefined, undefined, fakeAI);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port,
    headers = sessions(store, base);
  store.db
    .prepare('INSERT INTO suppliers VALUES(?,?,?,?,?,?)')
    .run('supplier', 'Proveedor', '', '', 1, 1);
  const post = async (path: string, body: unknown, who = 'elena') =>
    fetch(base + path, { method: 'POST', headers: headers(who), body: JSON.stringify(body) });
  assert.equal((await fetch(base + '/api/operations')).status, 401);
  const body = {
    requestId: 'purchase-authorized-0001',

    supplierId: 'supplier',
    reason: 'Reponer artículo',
    lines: [{ productId: 'nc1', quantity: 2 }],
  };
  assert.equal((await post('/api/purchases', body, 'lucia')).status, 403);
  store.db
    .prepare('INSERT INTO supplier_offers VALUES(?,?,?,?,?,?)')
    .run('supplier', 'nc1', 4900, 1, 3, 1);
  const p = await (await post('/api/purchases', body)).json();
  assert.ok(p.id);
  assert.equal((await post('/api/purchases', body)).status, 201);
  assert.equal(
    (await fetch(base + '/api/operations', { headers: headers('elena') }).then((r) => r.json()))
      .purchases.length,
    1,
  );
  assert.equal(
    (await post('/api/purchases/' + p.id, { action: 'approve', expectedVersion: 1 }, 'marcos'))
      .status,
    200,
  );
  assert.equal(
    (
      await post('/api/purchases/' + p.id, {
        action: 'receive',
        confirmReceived: true,
        expectedVersion: 2,
        reference: 'ALB-API',
      })
    ).status,
    200,
  );
  assert.equal(
    store.db.prepare('SELECT quantity FROM inventory WHERE productId=?').get('nc1')!.quantity,
    22,
  );
  assert.equal(
    (
      await post(
        '/api/document-imports/extract',
        { format: 'text', source: 'NA-001;2;5,00', useAI: false },
        'lucia',
      )
    ).status,
    403,
  );
  const doc = await (
    await post('/api/document-imports/extract', {
      format: 'text',
      source: 'NA-001;2;5,00',
      useAI: true,
    })
  ).json();
  assert.equal(doc.rows.length, 1);
  const processed = await post('/api/document-imports/' + doc.id + '/process', {
    expectedVersion: 1,
    confirmReviewed: true,
    kind: 'receipt',
    supplierId: 'supplier',
    reference: 'ALB-IMPORT',
    rows: [{ sku: store.products()[0]!.sku, quantity: 3, costCents: null }],
  });
  assert.equal(processed.status, 200);
  const c = new CommerceStore(store),
    s = sale(c);
  const incident = await (
    await post('/api/incidents', {
      orderId: s.id,
      kind: 'damage',
      description: 'Envase dañado de prueba',
    })
  ).json();
  assert.equal((await post('/api/incidents/draft', { id: incident.id })).status, 200);
  assert.equal((await post('/api/daily/brief', {})).status, 200);
  const operations = await (
    await fetch(base + '/api/operations', { headers: headers('elena') })
  ).json();
  assert.ok(operations.tasks.length);
  assert.equal(operations.imports[0].source, undefined);
  const guest = await fetch(base + '/api/shop'),
    shop = await guest.json(),
    guestCookie = guest.headers.get('set-cookie')!.split(';')[0]!;
  const advice = await fetch(base + '/api/shop/advice', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: base,
      Cookie: guestCookie,
      'X-CSRF-Token': shop.csrf,
    },
    body: JSON.stringify({ need: 'Limpiar el coche', budgetCents: 50000 }),
  });
  assert.equal(advice.status, 200);
  const suggestions = await advice.json();
  assert.ok(!JSON.stringify(suggestions).includes('costCents'));
  const denied = await fetch(base + '/api/shop/advice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base, Cookie: guestCookie },
    body: JSON.stringify({ need: 'Limpiar el coche', budgetCents: 50000 }),
  });
  assert.equal(denied.status, 403);
  const tariffDoc = await (
    await post('/api/document-imports/extract', {
      format: 'text',
      source: 'NA-001;2;5,00',
      useAI: false,
    })
  ).json();
  const costBefore = store.products()[0]!.costCents;
  const batchResponse = await post('/api/document-imports/' + tariffDoc.id + '/process', {
    expectedVersion: 1,
    confirmReviewed: true,
    kind: 'tariff',
    supplierId: 'supplier',
    reference: 'TARIFF-IMPORT',
    rows: [{ sku: store.products()[0]!.sku, quantity: null, costCents: 500 }],
  });
  assert.equal(batchResponse.status, 200);
  assert.equal(store.products()[0]!.costCents, costBefore);
  const batch = (await batchResponse.json()).result;
  assert.equal(batch.status, 'ready');
  const receipt = c.snapshot().receipts.find((r) => r.reference === 'ALB-API')!;
  const quantity = Number(
    store.db.prepare('SELECT quantity FROM inventory WHERE productId=?').get(receipt.productId)!
      .quantity,
  );
  assert.equal(
    (
      await post('/api/inventory/receipts/' + receipt.id + '/cancel', {
        reason: 'Entrada registrada por error',
        expectedQuantity: quantity,
      })
    ).status,
    200,
  );
  const afterCancel = await (
    await fetch(base + '/api/operations', { headers: headers('elena') })
  ).json();
  assert.equal(afterCancel.purchases[0].status, 'sent');
  assert.equal(afterCancel.purchases[0].receiptWarnings, 0);
  assert.equal(afterCancel.purchases[0].deliveries[0].lines[0].cancelledReceiptId, receipt.id);
});
test('PDF con texto se lee en proceso aislado y conserva referencia e importe', async () => {
  const stream = 'BT /F1 12 Tf 40 150 Td (NA-001;2;5.00) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, obj] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += i + 1 + ' 0 obj\n' + obj + '\nendobj\n';
  }
  const start = Buffer.byteLength(pdf);
  pdf +=
    'xref\n0 6\n0000000000 65535 f \n' +
    offsets
      .slice(1)
      .map((o) => String(o).padStart(10, '0') + ' 00000 n \n')
      .join('') +
    'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' +
    start +
    '\n%%EOF';
  const extracted = await documentText({
    format: 'pdf',
    source: Buffer.from(pdf).toString('base64'),
  });
  assert.ok(extracted.includes('NA-001;2;5.00'));
});
test('adaptador IA limita respuesta, rechaza JSON inválido y mantiene disponible el modo manual', async () => {
  const invalid = new LocalCommercialAI(
    'fixture',
    async () => new Response(JSON.stringify({ message: { content: 'not JSON' } })),
  );
  await assert.rejects(
    invalid.draft('Resumen', []),
    (e) => (e as { code: string }).code === 'AI_UNAVAILABLE',
  );
  const huge = new LocalCommercialAI('fixture', async () => new Response('x'.repeat(70000)));
  await assert.rejects(huge.draft('Resumen', []));
  let release!: (r: Response) => void;
  const busy = new LocalCommercialAI(
    'fixture',
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = busy.draft('Resumen', []);
  await assert.rejects(busy.draft('Otro', []), (e) => (e as { code: string }).code === 'AI_BUSY');
  release(new Response(JSON.stringify({ message: { content: '{"text":"Prueba"}' } })));
  assert.deepEqual(await pending, { text: 'Prueba' });
});
test('compra con referencia de operación conserva idempotencia sin aceptar datos distintos', (t) => {
  const { store } = setup(t),
    repo = new OperationStore<Purchase>(store, 'purchase'),
    service = new Purchases(
      repo,
      () => store.products(),
      () => ({ name: 'Proveedor', active: 1 }),
      () => {},
      randomUUID,
      now,
    );
  const body = {
    requestId: randomUUID(),
    supplierId: 'supplier',
    reason: 'Reponer existencias',
    lines: [{ productId: 'nc1', quantity: 2 }],
  };
  const first = service.create(actor, body);
  assert.deepEqual(service.create(actor, body), first);
  assert.equal(repo.all().length, 1);
  assert.throws(() =>
    service.create(actor, { ...body, lines: [{ productId: 'nc1', quantity: 3 }] }),
  );
});

test('resumen diario no oculta tareas cuando la IA las omite o falla', async () => {
  const tasks = [{ id: 'task-demo', title: 'Preparar pedido', detail: 'Confirmado' }];
  const incorrect = await dailyBrief(
    { ...fakeAI, draft: async () => ({ text: 'No se han encontrado tareas disponibles.' }) },
    tasks,
  );
  assert.equal(incorrect.modelUsed, false);
  assert.ok(incorrect.text.includes('Preparar pedido'));
  const failure = await dailyBrief(
    {
      ...fakeAI,
      draft: async () => {
        throw new Error('offline');
      },
    },
    tasks,
  );
  assert.equal(failure.modelUsed, false);
  const grounded = await dailyBrief(
    { ...fakeAI, prioritize: async () => ({ ids: ['task-demo'] }) },
    tasks,
  );
  assert.equal(grounded.modelUsed, true);
  assert.equal(grounded.text, 'Preparar pedido · Confirmado');
  for (const response of [
    { ids: ['task-demo'], text: 'Se reembolsaron 5000 euros' },
    { ids: ['unknown'] },
    { ids: ['task-demo', 'task-demo'] },
    { ids: [] },
    { text: 'task-demo Preparar pedido. El cliente ya recibió el paquete.' },
  ]) {
    const rejected = await dailyBrief({ ...fakeAI, prioritize: async () => response }, tasks);
    assert.equal(rejected.modelUsed, false);
    assert.equal(rejected.text, tasks[0]!.title + ' \u00b7 ' + tasks[0]!.detail);
  }
  const idOnly = await dailyBrief({ ...fakeAI, draft: async () => ({ text: 'task-demo' }) }, tasks);
  assert.equal(idOnly.modelUsed, false);
  assert.ok(idOnly.text.includes('Preparar pedido'));
});

test('compra concreta: revisión independiente, rechazo y alternativa sin heredar aprobación', (t) => {
  const { store } = setup(t);
  const repo = new OperationStore<Purchase>(store, 'purchase');
  const purchases = new Purchases(
    repo,
    () => store.products(),
    () => ({ name: 'Proveedor', active: 1 }),
    () => {},
    randomUUID,
    now,
  );
  const body = {
    supplierId: 'supplier',
    reason: 'Reponer champú',
    lines: [{ productId: 'nc1', quantity: 2 }],
  };
  const first = purchases.create(actor, body);
  assert.equal(first.status, 'draft');
  assert.throws(() =>
    purchases.transition({ ...reviewer, id: actor.id }, first.id, {
      action: 'approve',
      expectedVersion: 1,
    }),
  );
  assert.throws(() =>
    purchases.transition(reviewer, first.id, { action: 'reject', expectedVersion: 1, reason: '' }),
  );
  const changed = purchases.transition(reviewer, first.id, {
    action: 'request-changes',
    expectedVersion: 1,
    reason: 'Cambiar producto y comprar menos unidades',
  });
  assert.equal(changed.status, 'changes_requested');
  assert.throws(() =>
    purchases.transition(actor, first.id, {
      action: 'receive',
      expectedVersion: 2,
      confirmReceived: true,
      reference: 'ALB',
    }),
  );
  const replacement = purchases.create(actor, {
    ...body,
    replacesId: first.id,
    lines: [{ productId: 'nc2', quantity: 1 }],
  });
  assert.equal(replacement.status, 'draft');
  assert.equal(replacement.approvedBy, undefined);
  assert.equal(repo.get(first.id)?.replacementId, replacement.id);
  assert.equal(repo.get(first.id)?.review?.reason, 'Cambiar producto y comprar menos unidades');
  assert.throws(() => purchases.create(actor, { ...body, replacesId: first.id }));
  purchases.transition(reviewer, replacement.id, { action: 'approve', expectedVersion: 1 });
  assert.throws(() =>
    purchases.transition(reviewer, replacement.id, {
      action: 'reject',
      expectedVersion: 2,
      reason: 'Cambiar decisión',
    }),
  );
  const rejected = purchases.create(actor, body);
  purchases.transition(reviewer, rejected.id, {
    action: 'reject',
    expectedVersion: 1,
    reason: 'No hace falta comprar más',
  });
  assert.equal(repo.get(rejected.id)?.status, 'rejected');
});
