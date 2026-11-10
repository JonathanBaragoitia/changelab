import { OperationStore } from '../src/infrastructure/operation-store.ts';
import type { Purchase } from '../src/application/operations.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/infrastructure/store.ts';
import { CommerceStore } from '../src/infrastructure/commerce-store.ts';
import { AuthStore } from '../src/infrastructure/auth-store.ts';
import { ManageOrder } from '../src/application/order-management.ts';
import { Checkout } from '../src/application/commerce.ts';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { makeServer } from '../src/server.ts';
import { sessions } from './auth-fixture.ts';

test('preparar y enviar tienen permisos independientes, conservan stock y autoría', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store);
  const checkout = new Checkout(commerce, randomUUID, () => new Date().toISOString());
  const sale = checkout.execute(
    { id: 'creator', role: 'editor' },
    {
      requestId: randomUUID(),
      lines: [{ productId: 'nc1', quantity: 1, expectedPriceCents: 7990 }],
    },
  );
  const manager = new ManageOrder(commerce);
  const warehouse = {
    id: 'mario',
    name: 'Mario',
    role: 'viewer',
    profile: 'warehouse' as const,
    permissions: ['warehouse.prepare', 'warehouse.handover'],
  };
  const dispatch = { id: 'antonio', name: 'Antonio', role: 'editor', permissions: ['orders.ship'] };
  const stock = () =>
    store.db.prepare("SELECT quantity FROM inventory WHERE productId='nc1'").get()?.quantity;
  assert.equal(stock(), 19);
  assert.throws(
    () => manager.execute(dispatch, sale.id, { status: 'shipped', expectedStatus: 'confirmed' }),
    { code: 'FORBIDDEN' },
  );
  assert.throws(
    () => manager.execute(dispatch, sale.id, { status: 'prepared', expectedStatus: 'confirmed' }),
    { code: 'FORBIDDEN' },
  );
  const prepared = manager.execute(warehouse, sale.id, {
    status: 'prepared',
    expectedStatus: 'confirmed',
  });
  assert.equal(prepared.preparedBy?.by, 'mario');
  assert.equal(stock(), 19);
  manager.execute(warehouse, sale.id, { status: 'prepared', expectedStatus: 'confirmed' });
  assert.throws(
    () => manager.execute(warehouse, sale.id, { status: 'shipped', expectedStatus: 'prepared' }),
    { code: 'DISPATCH_REQUIRED' },
  );
  manager.execute(dispatch, sale.id, {
    status: 'dispatch_ready',
    expectedStatus: 'prepared',
    carrier: 'Transportista',
    reference: 'EXP-1',
  });
  const sent = manager.execute(warehouse, sale.id, {
    status: 'shipped',
    expectedStatus: 'prepared',
  });
  assert.equal(sent.shippedBy?.by, 'mario');
  assert.equal(sent.dispatch?.by, 'antonio');
  const events = store.audit().length;
  manager.execute(warehouse, sale.id, { status: 'shipped', expectedStatus: 'prepared' });
  assert.equal(store.audit().length, events);
  assert.throws(
    () =>
      manager.execute(warehouse, sale.id, {
        status: 'dispatch_ready',
        expectedStatus: 'prepared',
        carrier: 'X',
        reference: 'Y',
      }),
    { code: 'FORBIDDEN' },
  );
  assert.equal(sent.preparedBy?.by, 'mario');
  assert.equal(stock(), 19);
  assert.throws(
    () =>
      manager.execute(
        { id: 'viewer', role: 'viewer', permissions: ['warehouse.prepare', 'orders.ship'] },
        sale.id,
        { status: 'shipped', expectedStatus: 'prepared' },
      ),
    { code: 'FORBIDDEN' },
  );
});

test('sesiones consultan permisos vigentes sin alterar el rol de aprobación ni reponer permisos revocados', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const repo = new AuthStore(store.db);
  repo.add({
    actor: { id: 'reviewer', name: 'Ana', role: 'reviewer', initials: 'A' },
    username: 'ana',
    passwordHash: 'fixture',
    active: true,
  });
  repo.saveSession('session', 'reviewer', 'csrf', Date.now() + 100000);
  assert.deepEqual(repo.session('session')?.actor.permissions, []);
  store.db
    .prepare('INSERT INTO user_order_permissions VALUES(?,?)')
    .run('reviewer', 'warehouse.prepare');
  assert.deepEqual(repo.session('session')?.actor.permissions, ['warehouse.prepare']);
  assert.equal(repo.session('session')?.actor.role, 'reviewer');
  repo.add({
    actor: { id: 'editor', name: 'Antonio', role: 'editor', initials: 'A' },
    username: 'antonio',
    passwordHash: 'fixture',
    active: true,
  });
  store.db.prepare('DELETE FROM user_order_permissions WHERE userId=?').run('editor');
  new AuthStore(store.db);
  assert.deepEqual(repo.account('antonio')?.actor.permissions, ['warehouse.handover']);
});

test('HTTP: revisión con preparación explícita puede preparar, pero no enviar sin su permiso', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const server = makeServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port,
    staff = sessions(store, base);
  const commerce = new CommerceStore(store);
  const sale = new Checkout(commerce, randomUUID, () => new Date().toISOString()).execute(
    { id: 'creator', role: 'editor' },
    {
      requestId: randomUUID(),
      lines: [{ productId: 'nc1', quantity: 1, expectedPriceCents: 7990 }],
    },
  );
  const post = async (status: string, expectedStatus: string) =>
    fetch(base + '/api/orders/' + sale.id + '/status', {
      method: 'POST',
      headers: staff('marcos'),
      body: JSON.stringify({ status, expectedStatus }),
    });
  assert.equal((await post('prepared', 'confirmed')).status, 403);
  store.db
    .prepare('INSERT INTO user_order_permissions VALUES(?,?)')
    .run('marcos', 'warehouse.prepare');
  assert.equal((await post('prepared', 'confirmed')).status, 200);
  assert.equal((await post('shipped', 'prepared')).status, 403);
  store.db.prepare('INSERT INTO user_order_permissions VALUES(?,?)').run('marcos', 'orders.ship');
  assert.equal((await post('shipped', 'prepared')).status, 403);
  const arranged = await fetch(base + '/api/orders/' + sale.id + '/status', {
    method: 'POST',
    headers: staff('marcos'),
    body: JSON.stringify({
      status: 'dispatch_ready',
      expectedStatus: 'prepared',
      carrier: 'Transportista',
      reference: 'EXP-HTTP',
    }),
  });
  assert.equal(arranged.status, 200);
  store.db
    .prepare('INSERT INTO user_warehouse_permissions VALUES(?,?)')
    .run('marcos', 'warehouse.handover');
  assert.equal((await post('shipped', 'prepared')).status, 200);
  assert.equal(commerce.sale(sale.id)?.status, 'shipped');
});

test('perfil de almacén: entradas autorizadas, lectura ordinaria y modificación comercial bloqueadas', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const server = makeServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  const repo = new AuthStore(store.db);
  repo.add({
    actor: { id: 'mario', name: 'Mario', role: 'viewer', initials: 'M' },
    username: 'mario',
    passwordHash: 'fixture',
    active: true,
  });
  store.db.prepare('INSERT INTO user_operational_profiles VALUES(?,?)').run('mario', 'warehouse');
  store.db
    .prepare('INSERT INTO user_warehouse_permissions VALUES(?,?)')
    .run('mario', 'warehouse.receive');
  const { credentials } = await import('../src/infrastructure/auth-crypto.ts');
  const token = credentials.token();
  const csrf = credentials.token();
  repo.saveSession(credentials.digest(token), 'mario', csrf, Date.now() + 60000);
  const headers = {
    'Content-Type': 'application/json',
    Origin: base,
    Cookie: 'changelab_session=' + token,
    'X-CSRF-Token': csrf,
  };
  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const request = {
    requestId: randomUUID(),
    productId: 'nc1',
    quantity: 2,
    supplier: 'Proveedor ocasional',
    reference: 'ALB-MARIO',
  };
  assert.equal((await post('/api/inventory/receipts', request)).status, 201);
  assert.equal((await post('/api/inventory/receipts', request)).status, 201);
  assert.equal(
    new CommerceStore(store).snapshot().inventory.find((r) => r.productId === 'nc1')?.quantity,
    22,
  );
  assert.equal((await post('/api/plans', {})).status, 403);
  assert.equal(repo.account('mario')?.actor.profile, 'warehouse');
  for (const path of [
    '/api/economics',
    '/api/cash',
    '/api/operations',
    '/api/suppliers',
    '/api/tariffs',
    '/api/approvals',
    '/api/catalog-management',
    '/api/reconciliation',
    '/api/business-context',
  ]) {
    assert.equal((await fetch(base + path, { headers })).status, 403, path);
  }
  assert.equal(
    (await post('/api/purchases/unknown', { action: 'send', expectedVersion: 1 })).status,
    403,
  );
  assert.equal(
    (
      await post('/api/orders/unknown/status', {
        status: 'dispatch_ready',
        expectedStatus: 'prepared',
      })
    ).status,
    403,
  );
  const commerce = new CommerceStore(store);
  const sale = new Checkout(commerce, randomUUID, () => new Date().toISOString()).customerCheckout(
    'client',
    {
      requestId: randomUUID(),
      customer: {
        name: 'Cliente de prueba',
        email: 'private@example.invalid',
        address: 'Dirección privada',
      },
      lines: [{ productId: 'nc1', quantity: 1, expectedPriceCents: 7990 }],
    },
  );
  store.db
    .prepare('INSERT INTO user_order_permissions VALUES(?,?)')
    .run('mario', 'warehouse.prepare');
  const prepared = await post('/api/orders/' + sale.id + '/status', {
    status: 'prepared',
    expectedStatus: 'confirmed',
  });
  assert.equal(prepared.status, 200);
  assert.deepEqual(await prepared.json(), { id: sale.id, status: 'prepared' });
  const workspace = await (await fetch(base + '/api/workspace', { headers })).json();
  assert.equal(workspace.actor.profile, 'warehouse');
  assert.equal(workspace.sales[0].customer.name, 'Cliente de prueba');
  const encoded = JSON.stringify(workspace);
  for (const key of [
    'priceCents',
    'costCents',
    'unitPriceCents',
    'unitCostCents',
    'totalCents',
    'fiscalMetrics',
    'invoices',
    'drafts',
    'email',
    'address',
  ])
    assert.equal(encoded.includes('"' + key + '"'), false, key);
  store.db
    .prepare('INSERT INTO suppliers VALUES(?,?,?,?,?,?)')
    .run(
      'warehouse-supplier',
      'Proveedor operativo',
      'secret@example.invalid',
      'private-phone',
      1,
      1,
    );
  const purchase: Purchase = {
    id: randomUUID(),
    version: 1,
    createdBy: 'commercial',
    createdAt: new Date().toISOString(),
    supplierId: 'warehouse-supplier',
    supplierName: 'Proveedor operativo',
    reason: 'Reposición autorizada de almacén',
    status: 'sent',
    approvedBy: 'independent-reviewer',
    sentAt: new Date().toISOString(),
    expectedDate: '2026-11-06',
    lines: [
      {
        productId: 'nc1',
        sku: 'NC1',
        name: 'Champú',
        quantity: 3,
        costCents: 5555,
        baseVersion: 1,
      },
    ],
    totalCents: 16665,
  };
  new OperationStore<Purchase>(store, 'purchase').save(purchase, 0);
  const delivery = await fetch(base + '/api/warehouse/purchases', { headers });
  assert.equal(delivery.status, 200);
  const operationalPurchases = await delivery.json();
  assert.equal(operationalPurchases.purchases[0].lines[0].quantity, 3);
  assert.equal(JSON.stringify(operationalPurchases).includes('costCents'), false);
  assert.equal(JSON.stringify(operationalPurchases).includes('totalCents'), false);
  const beforeReceive = Number(
    commerce.snapshot().inventory.find((r) => r.productId === 'nc1')?.quantity,
  );
  const receipt = {
    action: 'receive-partial',
    expectedVersion: 1,
    requestId: randomUUID(),
    reference: 'ALB-LINKED',
    confirmReceived: true,
    lines: [{ productId: 'nc1', quantity: 3 }],
  };
  const received = await post('/api/purchases/' + purchase.id, receipt);
  assert.equal(received.status, 200);
  assert.deepEqual(await received.json(), { id: purchase.id, status: 'received', version: 2 });
  assert.equal((await post('/api/purchases/' + purchase.id, receipt)).status, 200);
  assert.equal(
    Number(commerce.snapshot().inventory.find((r) => r.productId === 'nc1')?.quantity),
    beforeReceive + 3,
  );

  const damaged = await fetch(base + '/api/transport-damages', { headers });
  assert.equal(damaged.status, 200);

  store.db.prepare('DELETE FROM user_operational_profiles WHERE userId=?').run('mario');
  assert.equal(
    (
      await post('/api/inventory/receipts', {
        ...request,
        requestId: randomUUID(),
        reference: 'ALB-2',
      })
    ).status,
    403,
  );
});
