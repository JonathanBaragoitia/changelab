import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/infrastructure/store.ts';
import { CommerceStore } from '../src/infrastructure/commerce-store.ts';
import { Checkout } from '../src/application/commerce.ts';
import { businessContext, rankOpportunities } from '../src/application/business.ts';
import { randomUUID } from 'node:crypto';
test('contexto suma unidades/stock por categoría, excluye devueltos y no expone datos personales', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store);
  const sale = new Checkout(commerce, randomUUID, () => '2026-10-28T10:00:00Z').customerCheckout(
    'guest-secret',
    {
      requestId: randomUUID(),
      lines: [{ productId: 'nc1', quantity: 2, expectedPriceCents: 7990 }],
      customer: {
        name: 'Nombre privado',
        email: 'private@example.com',
        address: 'Dirección privada 1',
      },
    },
  );
  const context = businessContext(
    store.products(),
    commerce.publicCatalog().map((p) => ({ productId: p.id, quantity: Number(p.quantity) })),
    [sale, { ...sale, id: 'returned', status: 'returned' }],
    '2026-10-01',
    '2026-10-28',
  );
  assert.equal(context.categories.find((c) => c.category === 'Lavado exterior')?.unitsSold, 2);
  assert.ok(
    !context.opportunities.some(
      (o) => o.category === 'Lavado exterior' && o.code === 'stock-without-recorded-sales',
    ),
  );
  for (const secret of [
    'Nombre privado',
    'private@example.com',
    'Dirección privada',
    'guest-secret',
    sale.id,
  ])
    assert.ok(!JSON.stringify(context).includes(secret));
});
test('IA solo ordena señales existentes; inventadas y duplicadas se rechazan', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store);
  const context = businessContext(
    store.products(),
    commerce.publicCatalog().map((p) => ({ productId: p.id, quantity: Number(p.quantity) })),
    [],
    '2026-10-01',
    '2026-10-28',
  );
  const before = store.audit();
  const id = context.opportunities[0]!.id;
  const ranked = await rankOpportunities(context, {
    rank: async (input) => {
      assert.ok(!JSON.stringify(input).includes('email'));
      return { ids: [id] };
    },
  });
  assert.equal(ranked.opportunities[0]?.id, id);
  for (const result of [
    { ids: ['invented'] },
    { ids: [id, id] },
    { ids: [id], sql: 'DROP TABLE products' },
  ])
    await assert.rejects(rankOpportunities(context, { rank: async () => result }));
  assert.deepEqual(store.audit(), before);
});

test('priorización rechaza omitir agotados por elegir stock sin ventas', async () => {
  const context = businessContext(
    [
      {
        id: 'p',
        sku: 'SKU',
        name: 'Artículo',
        category: 'Limpieza',
        priceCents: 1000,
        costCents: 500,
        version: 1,
      },
    ],
    [{ productId: 'p', quantity: 0 }],
    [],
    '2026-10-01',
    '2026-10-28',
  );
  context.opportunities.push({
    id: 'other',
    category: 'Otra',
    code: 'stock-without-recorded-sales',
    message: 'Sin ventas',
  });
  await assert.rejects(rankOpportunities(context, { rank: async () => ({ ids: ['other'] }) }));
  assert.equal(
    (
      await rankOpportunities(context, {
        rank: async () => ({ ids: [context.opportunities[0]!.id, 'other'] }),
      })
    ).ids.length,
    2,
  );
});
import { businessProposalInput } from '../src/application/business.ts';
import { ProposalService, actorFor } from '../src/application/proposals.ts';
import { sha } from '../src/infrastructure/store.ts';
import { makeServer } from '../src/server.ts';
import { sessions } from './auth-fixture.ts';
import { once } from 'node:events';

test('señal exige decisión explícita, rechaza agotados y conserva precios al simular', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const context = businessContext(
    store.products(),
    store.products().map((p) => ({ productId: p.id, quantity: 20 })),
    [],
    '2026-10-01',
    '2026-10-28',
  );
  const input = {
    contextHash: 'snapshot',
    signalId: context.opportunities[0]!.id,
    basisPoints: -500,
    reason: 'Revisar campaña de prueba',
  };
  for (const change of [
    { basisPoints: 0 },
    { basisPoints: 5001 },
    { basisPoints: 1.5 },
    { reason: 'a' },
    { sql: 'bad' },
    { signalId: 'missing' },
  ])
    assert.throws(() => businessProposalInput(context, { ...input, ...change }));
  context.opportunities.push({
    id: 'empty',
    category: context.categories[0]!.category,
    code: 'out-of-stock',
    message: 'Agotado',
  });
  assert.throws(() => businessProposalInput(context, { ...input, signalId: 'empty' }));
  const before = store.products(),
    orders = store.orders();
  const app = new ProposalService(
    store,
    { hash: sha },
    { now: () => '2026-10-28T12:00:00Z' },
    { next: randomUUID },
  );
  const p = app.create(actorFor('elena'), businessProposalInput(context, input));
  assert.equal(p.status, 'ready');
  assert.ok(p.instruction.includes(input.contextHash));
  assert.ok(p.instruction.includes(input.reason));
  assert.deepEqual(store.products(), before);
  assert.deepEqual(store.orders(), orders);
  assert.notEqual(
    p.digest,
    app.create(
      actorFor('elena'),
      businessProposalInput(context, { ...input, reason: 'Otro motivo de prueba' }),
    ).digest,
  );
});

test('API comercial rechaza contexto antiguo y roles no editores; crea propuesta sin publicar', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const server = makeServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port,
    headers = sessions(store, base);
  const snap = await (
    await fetch(base + '/api/business-context', { headers: headers('elena') })
  ).json();
  const body = {
    contextHash: snap.contextHash,
    signalId: snap.context.opportunities.find((o: { code: string }) => o.code !== 'out-of-stock')
      .id,
    basisPoints: 500,
    reason: 'Verificar efecto en margen',
  };
  const post = (value: unknown, actor = 'elena') =>
    fetch(base + '/api/business-proposals', {
      method: 'POST',
      headers: headers(actor),
      body: JSON.stringify(value),
    });
  assert.equal((await post(body, 'lucia')).status, 403);
  assert.equal((await post(body, 'marcos')).status, 403);
  assert.equal((await post({ ...body, contextHash: 'old' })).status, 409);
  const before = store.products();
  const response = await post(body);
  assert.equal(response.status, 201);
  const proposal = await response.json();
  assert.equal(proposal.status, 'ready');
  assert.deepEqual(store.products(), before);
  store.db.prepare('UPDATE products SET version=version+1 WHERE id=?').run(before[0]!.id);
  assert.equal((await post(body)).status, 409);
});
