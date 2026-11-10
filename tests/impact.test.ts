import { sessions } from './auth-fixture.ts';
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { calculateScenario, reviewChanges } from '../src/domain/impact.ts';
import { AppError } from '../src/domain/catalog.ts';
import type { Change } from '../src/domain/catalog.ts';
import { Store, sha } from '../src/infrastructure/store.ts';
import { ProposalService, actorFor } from '../src/application/proposals.ts';
import { makeServer } from '../src/server.ts';

const rows: Change[] = [
  {
    productId: 'a',
    name: 'A',
    baseVersion: 1,
    beforeCents: 1000,
    afterCents: 1100,
    costCents: 600,
  },
  {
    productId: 'b',
    name: 'B',
    baseVersion: 1,
    beforeCents: 3000,
    afterCents: 3300,
    costCents: 1000,
  },
];
const quantities = [
  { productId: 'a', quantity: 2 },
  { productId: 'b', quantity: 1 },
];
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
const editor = actorFor('elena'),
  reviewer = actorFor('marcos');
function setup(t: TestContext) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const app = new ProposalService(
    store,
    { hash: sha },
    { now: () => new Date().toISOString() },
    { next: randomUUID },
  );
  const proposal = app.create(editor, {
    instruction: 'Escenario de campaña',
    plan: { category: 'Lavado exterior', basisPoints: 500 },
  });
  return { store, app, proposal };
}

test('escenario pondera cantidades y calcula contribución y margen sobre ingresos', () => {
  const result = calculateScenario(rows, quantities);
  assert.equal(result.units, 3);
  assert.equal(result.beforeRevenueCents, 5000);
  assert.equal(result.afterRevenueCents, 5500);
  assert.equal(result.costCents, 2200);
  assert.equal(result.beforeContributionCents, 2800);
  assert.equal(result.afterContributionCents, 3300);
  assert.equal(result.revenueDeltaCents, 500);
  assert.equal(result.contributionDeltaCents, 500);
  assert.equal(result.beforeMarginPercent, 56);
  assert.equal(result.afterMarginPercent, 60);
});

test('cero unidades no inventa ingresos ni divide entre cero', () => {
  const result = calculateScenario(
    rows,
    rows.map((row) => ({ productId: row.productId, quantity: 0 })),
  );
  assert.equal(result.beforeRevenueCents, 0);
  assert.equal(result.afterRevenueCents, 0);
  assert.equal(result.afterMarginPercent, null);
  assert.equal(result.beforeMarginPercent, null);
});

test('riesgo usa el umbral exacto de margen sin redondear para decidir', () => {
  const result = reviewChanges([
    { ...rows[0]!, costCents: 100, beforeCents: 125, afterCents: 125 },
    { ...rows[1]!, costCents: 100, beforeCents: 125, afterCents: 124 },
  ]);
  assert.equal(result.belowMinimum, 1);
  assert.equal(result.rows[0]?.afterMarginPercent, 20);
  assert.equal(result.rows[0]?.belowMinimum, false);
  assert.equal(result.rows[1]?.belowMinimum, true);
});

test('cantidades inválidas, duplicados, alcance ajeno y campos arbitrarios se rechazan', () => {
  for (const input of [
    null,
    [],
    {},
    quantities.slice(0, 1),
    [
      { productId: 'a', quantity: 2 },
      { productId: 'a', quantity: 1 },
    ],
    [
      { productId: 'a', quantity: 2 },
      { productId: 'x', quantity: 1 },
    ],
    ...[-1, 1.5, 100001, '2', NaN, Infinity].map((quantity) => [
      { productId: 'a', quantity },
      { productId: 'b', quantity: 1 },
    ]),
    [
      { productId: 'a', quantity: 2, price: 1 },
      { productId: 'b', quantity: 1 },
    ],
  ])
    assert.throws(() => calculateScenario(rows, input), code('INVALID_QUANTITIES'));
});

test('importes demasiado grandes no pierden exactitud silenciosamente', () => {
  const large = [
    { ...rows[0]!, beforeCents: Number.MAX_SAFE_INTEGER, afterCents: Number.MAX_SAFE_INTEGER },
  ];
  assert.throws(
    () => calculateScenario(large, [{ productId: 'a', quantity: 2 }]),
    code('SCENARIO_OVERFLOW'),
  );
});

test('propuestas antiguas sin coste no inventan márgenes ni escenarios', () => {
  const legacy = rows.map(({ costCents, ...row }) => row);
  const review = reviewChanges(legacy);
  assert.equal(review.costSnapshotComplete, false);
  assert.equal(review.rows[0]?.afterMarginPercent, null);
  assert.throws(() => calculateScenario(legacy, quantities), code('MISSING_COST_SNAPSHOT'));
});

test('revisión y cálculo son lecturas sin cambios en catálogo, propuestas, pedidos o auditoría', (t) => {
  const { store, app, proposal } = setup(t);
  const before = {
    products: store.products(),
    orders: store.orders(),
    proposals: store.proposals(),
    audit: store.audit(),
  };
  assert.equal(app.review(proposal.id).costSnapshotComplete, true);
  app.scenario(proposal.id, {
    digest: proposal.digest,
    quantities: proposal.changes.map((change) => ({ productId: change.productId, quantity: 10 })),
  });
  assert.deepEqual(
    {
      products: store.products(),
      orders: store.orders(),
      proposals: store.proposals(),
      audit: store.audit(),
    },
    before,
  );
});

test('costes conservados permiten revisar lo simulado tras publicar y variar el coste actual', (t) => {
  const { store, app, proposal } = setup(t);
  const before = app.review(proposal.id).rows;
  app.publish(reviewer, proposal.id, proposal.digest);
  store.db.prepare('UPDATE products SET costCents=5000 WHERE id=?').run('nc1');
  assert.deepEqual(app.review(proposal.id).rows, before);
});

test('cambiar costes conservando un margen válido invalida la publicación pendiente', (t) => {
  const { store, app, proposal } = setup(t);
  store.db.prepare('UPDATE products SET costCents=5000 WHERE id=?').run('nc1');
  const before = store.products(),
    audit = store.audit();
  assert.throws(() => app.publish(reviewer, proposal.id, proposal.digest), code('COST_CHANGED'));
  assert.deepEqual(store.products(), before);
  assert.deepEqual(store.audit(), audit);
});

test('coste capturado queda vinculado al digest para cálculo y publicación', (t) => {
  const { store, app, proposal } = setup(t);
  store.save({
    ...proposal,
    changes: proposal.changes.map((change) => ({ ...change, costCents: 1 })),
  });
  assert.throws(
    () => app.scenario(proposal.id, { digest: proposal.digest, quantities: [] }),
    code('REVIEW_MISMATCH'),
  );
  assert.throws(() => app.publish(reviewer, proposal.id, proposal.digest), code('REVIEW_MISMATCH'));
});

test('API de revisión y escenario permite lectura, valida digest y no publica', async (t) => {
  const { store, proposal } = setup(t),
    server = makeServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port + '/api/proposals/';
  const headers = sessions(store, 'http://127.0.0.1:' + address.port)('lucia');
  assert.equal((await fetch(base + proposal.id + '/review')).status, 401);
  const review = await fetch(base + proposal.id + '/review', { headers });
  assert.equal(review.status, 200);
  const reviewBody: unknown = await review.json();
  assert.ok(reviewBody && typeof reviewBody === 'object' && 'costSnapshotComplete' in reviewBody);
  assert.equal(reviewBody.costSnapshotComplete, true);
  const body = {
    digest: proposal.digest,
    quantities: proposal.changes.map((change) => ({ productId: change.productId, quantity: 10 })),
  };
  const post = (value: unknown) =>
    fetch(base + proposal.id + '/scenario', {
      method: 'POST',
      headers,
      body: JSON.stringify(value),
    });
  assert.equal((await post(body)).status, 200);
  assert.equal((await post({ ...body, digest: 'alterado' })).status, 409);
  assert.equal((await post({ ...body, quantities: [] })).status, 400);
  assert.equal((await post({ ...body, sql: 'UPDATE products' })).status, 400);
  assert.equal((await fetch(base + 'missing/review', { headers })).status, 404);
  assert.equal(store.proposal(proposal.id)?.status, 'ready');
  assert.equal(store.audit().filter((row) => row.action === 'proposal.applied').length, 0);
});
