import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  analyzeStock,
  ConfigureStockPolicy,
  DEFAULT_STOCK_POLICY,
} from '../src/application/stock-analysis.ts';
import type { Sale } from '../src/application/commerce.ts';
import {
  businessContext,
  rankOpportunities,
  businessProposalInput,
} from '../src/application/business.ts';
import { StockPolicyStore } from '../src/infrastructure/stock-policy-store.ts';
import { Store } from '../src/infrastructure/store.ts';
import { makeServer } from '../src/server.ts';
import { sessions } from './auth-fixture.ts';
const products = [
  {
    id: 'p',
    sku: 'P1',
    name: 'Producto de prueba',
    category: 'Interior',
    priceCents: 1000,
    costCents: 500,
    version: 1,
  },
  {
    id: 'q',
    sku: 'P2',
    name: 'Alternativa de prueba',
    category: 'Interior',
    priceCents: 1200,
    costCents: 600,
    version: 1,
  },
];
const sale = (productId: string, quantity: number, status: Sale['status'] = 'confirmed'): Sale => ({
  id: 'private-order',
  actorId: 'private-actor',
  requestId: 'private-request',
  createdAt: '2026-10-10T12:00:00Z',
  totalCents: 1000,
  costCents: 500,
  customer: { name: 'Private Name', email: 'secret@example.com', address: 'Private address' },
  lines: [
    {
      productId,
      name: 'Producto',
      quantity,
      expectedPriceCents: 1000,
      unitPriceCents: 1000,
      unitCostCents: 500,
    },
  ],
  status,
});
const from = '2026-10-01',
  to = '2026-10-30';
test('punto de pedido, cobertura y cantidad usan ritmo registrado y plazo configurado', () => {
  const report = analyzeStock(
    products,
    [
      { productId: 'p', quantity: 4 },
      { productId: 'q', quantity: 50 },
    ],
    [sale('p', 30)],
    from,
    to,
    [{ productId: 'p', leadDays: 3, safetyDays: 2, targetDays: 20, minimumUnits: 2, version: 1 }],
  );
  const row = report.rows[0]!;
  assert.equal(row.dailyRate, 1);
  assert.equal(row.reorderPoint, 5);
  assert.equal(row.targetUnits, 20);
  assert.equal(row.suggestedOrderUnits, 16);
  assert.equal(row.coverageDays, 4);
  assert.ok(row.signals.some((s) => s.code === 'reorder'));
  assert.equal(row.policyIsDefault, false);
  for (const secret of [
    'private-order',
    'private-actor',
    'private-request',
    'Private Name',
    'secret@example.com',
    'Private address',
  ])
    assert.ok(!JSON.stringify(report).includes(secret));
});
test('sin ventas no inventa compra y mínimo explícito avisa sin calcular unidades', () => {
  const report = analyzeStock(
    products,
    [
      { productId: 'p', quantity: 2 },
      { productId: 'q', quantity: 10 },
    ],
    [],
    from,
    to,
    [{ productId: 'p', ...DEFAULT_STOCK_POLICY, version: 1 }],
  );
  const row = report.rows[0]!;
  assert.equal(row.coverageDays, null);
  assert.equal(row.suggestedOrderUnits, null);
  assert.ok(row.signals.some((s) => s.code === 'reorder'));
  assert.ok(row.actions.some((a) => a.includes('fotografías')));
  assert.equal(report.rows[1]!.policyIsDefault, true);
});
test('excluye devueltos/cancelados/fuera de periodo y ofrece alternativas con ventas de su categoría', () => {
  const report = analyzeStock(
    products,
    [
      { productId: 'p', quantity: 20 },
      { productId: 'q', quantity: 20 },
    ],
    [
      sale('p', 10, 'returned'),
      sale('p', 10, 'cancelled'),
      { ...sale('p', 10), createdAt: '2026-09-01T00:00:00Z' },
      sale('q', 3),
    ],
    from,
    to,
    [],
  );
  assert.equal(report.rows[0]!.unitsSold, 0);
  assert.equal(report.rows[0]!.alternatives[0]?.sku, 'P2');
  assert.ok(report.rows[1]!.signals.some((s) => s.code === 'high-coverage'));
  assert.equal(report.rows[1]!.suggestedOrderUnits, null);
});
test('configuración valida roles/versiones y fallo de evento revierte guardado sin modificar stock', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const repo = new StockPolicyStore(store),
    service = new ConfigureStockPolicy(repo),
    actor = { id: 'editor', role: 'editor' },
    body = { ...DEFAULT_STOCK_POLICY, expectedVersion: 0 };
  const before = store.products();
  for (const role of ['viewer', 'reviewer'])
    assert.throws(() => service.execute({ id: role, role }, 'nc1', body));
  for (const patch of [{ leadDays: -1 }, { targetDays: 2 }, { minimumUnits: 1.5 }, { extra: true }])
    assert.throws(() => service.execute(actor, 'nc1', { ...body, ...patch }));
  const policy = service.execute(actor, 'nc1', body);
  assert.equal(policy.version, 1);
  assert.throws(() => service.execute(actor, 'nc1', body));
  repo.record = () => {
    throw Error('disk');
  };
  assert.throws(() => service.execute(actor, 'nc1', { ...body, leadDays: 8, expectedVersion: 1 }));
  assert.equal(repo.all()[0]!.leadDays, 7);
  assert.deepEqual(store.products(), before);
});
test('IA recibe prioridad de reposición y no puede convertirla en descuento de categoría', async () => {
  const context = businessContext(
    products,
    [
      { productId: 'p', quantity: 10 },
      { productId: 'q', quantity: 10 },
    ],
    [],
    from,
    to,
  );
  context.opportunities.push({
    id: 'reorder',
    category: 'Interior',
    code: 'stock-reorder',
    message: 'Revisar reposición',
  });
  await rankOpportunities(context, {
    rank: async (input) => {
      assert.equal(input.opportunities.find((o) => o.id === 'reorder')!.priority, 1);
      return { ids: ['reorder'] };
    },
  });
  await assert.rejects(
    rankOpportunities(context, { rank: async () => ({ ids: [context.opportunities[0]!.id] }) }),
  );
  assert.throws(() =>
    businessProposalInput(context, {
      contextHash: 'hash',
      signalId: 'reorder',
      basisPoints: -500,
      reason: 'Intento de descuento automático',
    }),
  );
});
test('HTTP protege políticas y cambio de configuración invalida contexto IA', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const server = makeServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const a = server.address();
  assert.ok(a && typeof a !== 'string');
  const base = 'http://127.0.0.1:' + a.port,
    headers = sessions(store, base);
  assert.equal((await fetch(base + '/api/stock-analysis')).status, 401);
  const read = await fetch(base + '/api/stock-analysis', { headers: headers('lucia') });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).rows.length, 18);
  const prior = await (
    await fetch(base + '/api/business-context', { headers: headers('elena') })
  ).json();
  const send = (actor: string) =>
    fetch(base + '/api/stock-policies/nc1', {
      method: 'POST',
      headers: headers(actor),
      body: JSON.stringify({ ...DEFAULT_STOCK_POLICY, expectedVersion: 0 }),
    });
  assert.equal((await send('lucia')).status, 403);
  assert.equal((await send('elena')).status, 200);
  assert.equal((await send('elena')).status, 409);
  const next = await (
    await fetch(base + '/api/business-context', { headers: headers('elena') })
  ).json();
  assert.notEqual(next.contextHash, prior.contextHash);
  store.db.prepare('UPDATE inventory SET quantity=0 WHERE productId=?').run('nc1');
  const workspace = await (
    await fetch(base + '/api/workspace', { headers: headers('elena') })
  ).json();
  assert.ok(workspace.stockReviewCount >= 1);
});
