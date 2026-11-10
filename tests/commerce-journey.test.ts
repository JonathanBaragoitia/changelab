import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Store } from '../src/infrastructure/store.ts';
import { makeServer } from '../src/server.ts';
import { sessions } from './auth-fixture.ts';

test('recorrido HTTP integral: cliente compra, empleado envía/emite/cobra y recibe devolución con rectificación independiente', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const server = makeServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const base = 'http://127.0.0.1:' + addr.port,
    employees = sessions(store, base);
  const json = async (path: string, body?: unknown, headers = employees('elena'), status = 200) => {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    assert.equal(response.status, status, JSON.stringify(value));
    return value;
  };
  const response = await fetch(base + '/api/shop');
  assert.equal(response.status, 200);
  const customer = await response.json(),
    cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  const guest = {
    'Content-Type': 'application/json',
    Origin: base,
    Cookie: cookie,
    'X-CSRF-Token': customer.csrf,
  };
  const originalOrders = store.orders();
  const basket = {
    requestId: randomUUID(),
    lines: [{ productId: 'nc1', quantity: 1, expectedPriceCents: 7990 }],
    customer: {
      name: 'Cliente integral ficticio',
      email: 'integral@example.com',
      address: 'Calle ficticia 10',
    },
  };
  const sale = await json('/api/shop/orders', basket, guest, 201);
  assert.equal(sale.totalCents, 9668);
  assert.equal(sale.tax.baseCents, 7990);
  assert.ok(!JSON.stringify(sale).includes('costCents'));
  assert.equal((await json('/api/shop/orders', basket, guest, 201)).id, sale.id);
  assert.equal((await json('/api/shop', undefined, guest)).orders.length, 1);
  assert.equal((await json('/api/shop')).orders.length, 0);
  assert.equal(
    store.db.prepare('SELECT quantity FROM inventory WHERE productId=?').get('nc1')!.quantity,
    19,
  );
  const reconciliation = async () =>
    (await json('/api/reconciliation')).rows.find(
      (r: { orderId: string }) => r.orderId === sale.id,
    );
  assert.deepEqual(
    (await reconciliation()).findings.map((f: { code: string }) => f.code),
    ['NO_DOCUMENT', 'PENDING_COLLECTION'],
  );
  await json('/api/orders/' + sale.id + '/status', {
    status: 'prepared',
    expectedStatus: 'confirmed',
  });
  assert.equal(
    (await json('/api/shop', undefined, guest)).orders.find(
      (order: { id: string }) => order.id === sale.id,
    )?.status,
    'prepared',
  );
  await json('/api/orders/' + sale.id + '/status', {
    status: 'dispatch_ready',
    expectedStatus: 'prepared',
    carrier: 'Transportista',
    reference: 'EXP-1',
  });
  await json('/api/orders/' + sale.id + '/status', {
    status: 'shipped',
    expectedStatus: 'prepared',
  });
  assert.equal(
    (await json('/api/shop', undefined, guest)).orders.find(
      (order: { id: string }) => order.id === sale.id,
    )?.status,
    'shipped',
  );
  const draft = await json(
    '/api/orders/' + sale.id + '/draft',
    {
      issuer: { name: 'Emisor ficticio', taxId: 'DEMO-001', address: 'Calle ficticia 20' },
      recipient: { name: 'Cliente ficticio', taxId: 'DEMO-002', address: 'Calle ficticia 10' },
      acceptDemoTax: true,
    },
    undefined,
    201,
  );
  assert.equal(draft.totalCents, sale.totalCents);
  const issueBody = { expectedVersion: 1, confirmDemo: true };
  const invoice = await json(
    '/api/billing/drafts/' + draft.id + '/issue',
    issueBody,
    undefined,
    201,
  );
  assert.equal(
    (await json('/api/billing/drafts/' + draft.id + '/issue', issueBody, undefined, 201)).id,
    invoice.id,
  );
  const payment = {
    requestId: randomUUID(),
    kind: 'collection',
    targetId: sale.id,
    amountCents: 9668,
    date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }),
    reference: 'COBRO-INTEGRAL-PRUEBA',
    method: 'Transferencia',
  };
  await json('/api/cash', payment, undefined, 201);
  await json('/api/cash', payment, undefined, 201);
  assert.deepEqual((await reconciliation()).findings, []);
  const returnBody = { reason: 'Devolución ficticia completa y apta', confirmReceived: true };
  await json('/api/orders/' + sale.id + '/return', returnBody, undefined, 201);
  await json('/api/orders/' + sale.id + '/return', returnBody, undefined, 201);
  assert.equal(
    store.db.prepare('SELECT quantity FROM inventory WHERE productId=?').get('nc1')!.quantity,
    20,
  );
  assert.deepEqual(
    (await reconciliation()).findings.map((f: { code: string }) => f.code),
    ['DOCUMENT_DIFFERENCE', 'COLLECTION_EXCESS'],
  );
  const correctionBody = {
    reason: 'Rectificación ficticia por devolución',
    confirmDemo: true,
    expectedNumber: invoice.number,
  };
  const correction = await json(
    '/api/billing/invoices/' + invoice.id + '/rectify',
    correctionBody,
    undefined,
    201,
  );
  assert.equal(
    (await json('/api/billing/invoices/' + invoice.id + '/rectify', correctionBody, undefined, 201))
      .id,
    correction.id,
  );
  const final = await reconciliation();
  assert.equal(final.documentCents, 0);
  assert.equal(final.expectedCents, 0);
  assert.equal(final.collectedCents, 9668);
  assert.deepEqual(
    final.findings.map((f: { code: string }) => f.code),
    ['COLLECTION_EXCESS'],
  );
  const refundBody = {
    requestId: randomUUID(),
    orderId: sale.id,
    amountCents: 9668,
    date: payment.date,
    reference: 'REFUND-INTEGRAL',
    reason: 'Reembolso ficticio por devolución completa',
  };
  await json('/api/refunds', refundBody, employees('lucia'), 403);
  await json('/api/refunds', refundBody, undefined, 201);
  await json('/api/refunds', refundBody, undefined, 201);
  const refunded = await reconciliation();
  assert.equal(refunded.refundedCents, 9668);
  assert.equal(refunded.pendingCents, 0);
  assert.deepEqual(refunded.findings, []);
  assert.equal((await json('/api/cash')).balanceCents, 0);
  const originalRefund = (await json('/api/cash')).refunds[0];
  await json(
    '/api/refunds/' + originalRefund.requestId + '/reverse',
    { reason: 'Error de registro de prueba' },
    employees('lucia'),
    403,
  );
  await json('/api/refunds/' + originalRefund.requestId + '/reverse', {
    reason: 'Error de registro de prueba',
  });
  await json('/api/refunds/' + originalRefund.requestId + '/reverse', {
    reason: 'Error de registro de prueba',
  });
  assert.equal((await reconciliation()).pendingCents, -9668);
  await json(
    '/api/refunds',
    { ...refundBody, requestId: randomUUID(), reference: 'REFUND-INTEGRAL-CORREGIDO' },
    undefined,
    201,
  );
  assert.equal((await reconciliation()).pendingCents, 0);
  assert.equal((await json('/api/cash')).refunds.length, 2);

  assert.equal((await json('/api/shop', undefined, guest)).orders[0].status, 'returned');
  const otherGuest = await fetch(base + '/api/reconciliation', { headers: guest });
  assert.equal(otherGuest.status, 401);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM sales').get()!.n, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM demo_invoices').get()!.n, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM demo_corrections').get()!.n, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM cash_entries').get()!.n, 1);
  assert.deepEqual(store.orders(), originalOrders);
  assert.equal(store.verifyAudit(), true);
});
