import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/infrastructure/store.ts';
import { AuthStore } from '../src/infrastructure/auth-store.ts';
import { AuthService } from '../src/application/auth.ts';
import { makeServer } from '../src/server.ts';
import { sessions } from './auth-fixture.ts';
import { Checkout } from '../src/application/commerce.ts';
import { CommerceStore } from '../src/infrastructure/commerce-store.ts';
import { StaffNotices } from '../src/infrastructure/staff-notices.ts';
import { ManageOrder } from '../src/application/order-management.ts';
import { canApprove, needsOwnerDecision } from '../src/application/company-roles.ts';

test('HTTP: un editor heredado no puede registrar entradas indirectamente con un albarán', async (t) => {
  const store = new Store(':memory:');
  const server = makeServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  const staff = sessions(store, base);
  store.db.prepare('UPDATE users SET role=? WHERE id=?').run('editor', 'marcos');
  store.db.prepare('INSERT INTO user_business_roles VALUES(?,?)').run('marcos', 'owner');
  const post = async (path: string, body: unknown, who = 'elena') => {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: staff(who),
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  const before = new CommerceStore(store).snapshot().inventory;
  const direct = await post('/api/inventory/receipts', {
    requestId: randomUUID(),
    supplierId: 'demo-lavado',
    supplier: 'Proveedor de prueba',
    reference: 'ALB-ROL',
    productId: 'nc1',
    quantity: 2,
  });
  assert.equal(direct.status, 403);
  const document = await post('/api/document-imports/extract', {
    format: 'text',
    source: 'SKU;Cantidad\nNA-001;2',
    useAI: false,
  });
  assert.equal(document.status, 201, JSON.stringify(document.body));
  const path = '/api/document-imports/' + document.body.id + '/process';
  const body = {
    expectedVersion: 1,
    confirmReviewed: true,
    kind: 'receipt',
    supplierId: 'demo-lavado',
    reference: 'ALB-ROL',
    rows: [{ sku: 'NA-001', quantity: 2, costCents: null }],
  };
  const bypass = await post(path, body);
  assert.equal(bypass.status, 403, JSON.stringify(bypass.body));
  assert.equal(bypass.body.error, 'WAREHOUSE_REQUIRED');
  assert.deepEqual(new CommerceStore(store).snapshot().inventory, before);
  const approved = await post(path, body, 'marcos');
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(
    new CommerceStore(store).snapshot().inventory.find((row) => row.productId === 'nc1')?.quantity,
    22,
  );
});

test('desactivar dirección no restaura permisos comerciales antiguos ni en sesiones abiertas', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const repo = new AuthStore(store.db);
  for (const [id, role] of [
    ['legacy-reviewer', 'reviewer'],
    ['legacy-editor', 'editor'],
    ['direction', 'editor'],
  ] as const) {
    repo.add({
      actor: { id, name: id, initials: 'QA', role },
      username: id,
      passwordHash: 'synthetic-test-hash',
      active: true,
    });
    repo.saveSession(id + '-session', id, 'synthetic-csrf', Date.now() + 60000);
  }
  assert.equal(canApprove(repo.account('legacy-reviewer')!.actor), true);
  assert.equal(needsOwnerDecision(repo.account('legacy-editor')!.actor), false);

  store.db.prepare('INSERT INTO user_business_roles VALUES(?,?)').run('direction', 'owner');
  for (const active of [1, 0, 1]) {
    store.db.prepare('UPDATE users SET active=? WHERE id=?').run(active, 'direction');
    const reloaded = new AuthStore(store.db);
    for (const id of ['legacy-reviewer', 'legacy-editor']) {
      for (const actor of [reloaded.account(id)!.actor, reloaded.session(id + '-session')!.actor]) {
        assert.equal(actor.ownerApprovalRequired, true);
        assert.equal(canApprove(actor), false);
        assert.equal(needsOwnerDecision(actor), true);
      }
    }
    assert.equal(Boolean(reloaded.session('direction-session')), Boolean(active));
  }
});

test('dirección y oficina conservan su perfil y capacidades en nuevas cuentas', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const repo = new AuthStore(store.db);
  const crypto = {
    hash: async () => 'test-hash',
    verify: async () => true,
    token: () => randomUUID(),
    digest: (v: string) => v,
  };
  const auth = new AuthService(repo, crypto);
  await auth.createAccount('ana', 'Ana', 'office', 'fixture-password');
  await auth.createAccount('antonio', 'Antonio', 'owner', 'fixture-password');
  const office = repo.account('ana')!.actor,
    owner = repo.account('antonio')!.actor;
  assert.equal(office.role, 'editor');
  assert.equal(office.businessRole, 'office');
  assert.equal(canApprove(office), false);
  assert.deepEqual(office.permissions, ['orders.ship']);
  assert.equal(owner.businessRole, 'owner');
  assert.equal(canApprove(owner), true);
  assert.equal(canApprove({ id: 'legacy', role: 'reviewer', ownerApprovalRequired: true }), false);
  assert.ok(owner.permissions?.includes('warehouse.handover'));
});

test('HTTP: Ana solicita incluso gastos pequeños; Antonio decide y Ana registra solo el importe aprobado', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const server = makeServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  const staff = sessions(store, base);
  store.db.prepare('UPDATE users SET role=? WHERE id=?').run('editor', 'marcos');
  store.db.prepare('INSERT INTO user_business_roles VALUES(?,?)').run('elena', 'office');
  store.db.prepare('INSERT INTO user_business_roles VALUES(?,?)').run('marcos', 'owner');
  const post = async (path: string, body: unknown, id = 'elena', expected = 200) => {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: staff(id),
      body: JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result;
  };
  const requestId = randomUUID();
  const request = await post(
    '/api/approvals',
    {
      id: requestId,
      kind: 'expense',
      category: 'Servicios',
      description: 'Revisión del equipo de oficina',
      cents: 5000,
    },
    'elena',
    201,
  );
  assert.equal(request.status, 'pending');
  await post(
    '/api/approvals/' + requestId,
    { status: 'approved', reason: 'Lo apruebo como oficina' },
    'elena',
    403,
  );
  await post('/api/expenses', {}, 'elena', 403);
  await post('/api/supplier-offers', {}, 'elena', 403);
  await post('/api/catalog-management', {}, 'elena', 403);
  await post(
    '/api/approvals/' + requestId,
    { status: 'approved', reason: 'Gasto necesario autorizado por dirección' },
    'marcos',
  );
  const expense = await post(
    '/api/approvals/' + requestId + '/expense',
    { date: '2026-11-04', reference: 'JUST-ROLE', vatRate: 21 },
    'elena',
    201,
  );
  assert.equal(expense.baseCents, 5000);
  assert.equal(expense.actorId, 'elena');
  const proposal = await post(
    '/api/proposals',
    {
      instruction: 'Propuesta de ajuste razonable',
      plan: { category: 'Lavado exterior', basisPoints: 500 },
    },
    'elena',
    201,
  );
  await post(
    '/api/proposals/' + proposal.id + '/publish',
    { digest: proposal.digest },
    'elena',
    403,
  );
  await post('/api/proposals/' + proposal.id + '/publish', { digest: proposal.digest }, 'marcos');
  const notices = new StaffNotices(store);
  const repo = new AuthStore(store.db);
  assert.ok(notices.list(repo.account('marcos')!.actor).some((n) => n.section === 'approvals'));
  assert.ok(notices.list(repo.account('elena')!.actor).some((n) => n.message.includes('resuelto')));
  store.db.prepare('INSERT INTO user_operational_profiles VALUES(?,?)').run('lucia', 'warehouse');
  store.db
    .prepare('INSERT INTO user_warehouse_permissions VALUES(?,?)')
    .run('lucia', 'warehouse.receive');
  const commerce = new CommerceStore(store),
    product = store.products().find((p) => p.id === 'nc1')!;
  const sale = new Checkout(commerce, randomUUID, () => new Date().toISOString()).execute(
    { id: 'fixture', role: 'editor' },
    {
      requestId: randomUUID(),
      lines: [{ productId: 'nc1', quantity: 2, expectedPriceCents: product.priceCents }],
    },
  );
  const manage = new ManageOrder(commerce);
  manage.execute({ id: 'fixture', role: 'editor' }, sale.id, {
    status: 'prepared',
    expectedStatus: 'confirmed',
  });
  manage.execute({ id: 'fixture', role: 'editor' }, sale.id, {
    status: 'shipped',
    expectedStatus: 'prepared',
  });
  const before = Number(commerce.snapshot().inventory.find((r) => r.productId === 'nc1')?.quantity);
  const returned = {
    requestId: randomUUID(),
    orderId: sale.id,
    productId: 'nc1',
    quantity: 1,
    expectedReturned: 0,
    reason: 'Unidad recibida en perfecto estado',
    confirmReceived: true,
  };
  await post('/api/partial-returns', returned, 'elena', 403);
  const physical = await post('/api/partial-returns', returned, 'lucia', 201);
  assert.deepEqual(Object.keys(physical), ['id']);
  await post('/api/partial-returns', returned, 'lucia', 201);
  assert.equal(
    Number(commerce.snapshot().inventory.find((r) => r.productId === 'nc1')?.quantity),
    before + 1,
  );
  assert.ok(
    notices.list(repo.account('elena')!.actor).some((n) => n.message.includes('devolución')),
  );
  const damaged = {
    ...returned,
    requestId: randomUUID(),
    expectedReturned: 1,
    condition: 'damaged',
    reason: 'Envase partido en la devolución',
  };
  await post('/api/partial-returns', damaged, 'elena', 403);
  await post('/api/partial-returns', { ...damaged, condition: 'unknown' }, 'lucia', 400);
  const saved = await post('/api/partial-returns', damaged, 'lucia', 201);
  assert.deepEqual(Object.keys(saved), ['id']);
  assert.deepEqual(await post('/api/partial-returns', damaged, 'lucia', 201), saved);
  await post('/api/partial-returns', { ...damaged, condition: 'sellable' }, 'lucia', 409);
  assert.equal(commerce.sale(sale.id)?.status, 'returned');
  assert.equal(
    Number(commerce.snapshot().inventory.find((r) => r.productId === 'nc1')?.quantity),
    before + 1,
  );
  assert.equal(
    notices.list(repo.account('elena')!.actor).filter((n) => n.message.includes('mercancía dañada'))
      .length,
    1,
  );
  const workspace = await fetch(base + '/api/workspace', { headers: staff('lucia') });
  assert.equal(workspace.status, 200);
  const { goodsReturns } = await workspace.json();
  const entry = goodsReturns.find((r: { id: string }) => r.id === saved.id);
  assert.equal(entry.condition, 'damaged');
  assert.equal(entry.quantity, 1);
  assert.equal('baseCents' in entry || 'grossCents' in entry, false);
  const disposalPath = '/api/partial-returns/' + saved.id + '/disposal';
  const disposal = {
    expectedVersion: 1,
    reason: 'Envase retirado para gestión de residuos',
    reference: 'BAJA-001',
    confirmDisposed: true,
  };
  const beforeDisposal = commerce.snapshot();
  await post(disposalPath, disposal, 'elena', 403);
  await post(disposalPath, disposal, 'lucia', 403);
  store.db
    .prepare('INSERT INTO user_warehouse_permissions VALUES(?,?)')
    .run('lucia', 'warehouse.damage');
  await post(disposalPath, { ...disposal, confirmDisposed: false }, 'lucia', 400);
  await post(disposalPath, { ...disposal, expectedVersion: 2 }, 'lucia', 409);
  await post('/api/partial-returns/' + physical.id + '/disposal', disposal, 'lucia', 409);
  const disposed = await post(disposalPath, disposal, 'lucia', 200);
  assert.deepEqual(disposed, { id: saved.id, version: 2 });
  assert.deepEqual(await post(disposalPath, disposal, 'lucia', 200), disposed);
  await post(disposalPath, { ...disposal, reason: 'Intento de sobrescritura' }, 'lucia', 409);
  assert.deepEqual(commerce.snapshot(), beforeDisposal);
  assert.equal(
    store.audit().filter((event) => event.action === 'order.damaged-return-disposed').length,
    1,
  );
  assert.equal(
    notices.list(repo.account('elena')!.actor).filter((n) => n.message.includes('baja física'))
      .length,
    1,
  );
  const after = await (await fetch(base + '/api/workspace', { headers: staff('lucia') })).json();
  const recorded = after.goodsReturns.find((r: { id: string }) => r.id === saved.id);
  assert.equal(recorded.disposal.by, 'lucia');
  assert.equal(recorded.disposal.reason, disposal.reason);
  assert.equal(recorded.disposal.reference, disposal.reference);
  assert.equal('baseCents' in recorded || 'grossCents' in recorded, false);

  store.db
    .prepare('INSERT INTO suppliers VALUES(?,?,?,?,?,?)')
    .run('own-purchase', 'Proveedor de compras', '', '', 1, 1);
  store.db
    .prepare('INSERT INTO supplier_offers VALUES(?,?,?,?,?,?)')
    .run('own-purchase', 'nc1', 4900, 1, 3, 1);
  const decisions = [
    ['approve', 'sent'],
    ['reject', 'rejected'],
    ['request-changes', 'changes_requested'],
  ] as const;
  const ownPurchases = [];
  for (const [action, status] of decisions) {
    const purchase = await post(
      '/api/purchases',
      {
        requestId: randomUUID(),
        supplierId: 'own-purchase',
        reason: 'Reposición preparada por Dirección',
        lines: [{ productId: 'nc1', quantity: 2 }],
      },
      'marcos',
      201,
    );
    const path = '/api/purchases/' + purchase.id;
    const body = {
      action,
      expectedVersion: purchase.version,
      ...(action === 'approve' ? {} : { reason: 'Decisión explícita de Dirección' }),
    };
    await post(path, body, 'elena', 403);
    const decided = await post(path, body, 'marcos');
    assert.equal(decided.approvedBy ?? decided.review.actor, purchase.createdBy);
    if (action === 'approve')
      await post(path, { action: 'send', expectedVersion: decided.version }, 'marcos');
    ownPurchases.push({ id: purchase.id, status });
  }
  store.db.prepare('UPDATE users SET active=0 WHERE id=?').run('marcos');
  const operations = await fetch(base + '/api/operations', { headers: staff('elena') });
  assert.equal(operations.status, 200);
  const { purchases } = await operations.json();
  for (const { id, status } of ownPurchases)
    assert.equal(purchases.find((purchase: { id: string }) => purchase.id === id)?.status, status);
});

test('Mario avisa a Ana al preparar; Ana avisa a Mario al tramitar; lectura individual y reintentos sin duplicados', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const auth = new AuthStore(store.db);
  const notices = new StaffNotices(store);
  for (const [id, role, businessRole] of [
    ['ana', 'editor', 'office'],
    ['antonio', 'editor', 'owner'],
  ] as const)
    auth.add({
      actor: { id, name: id, initials: id[0]!, role, businessRole },
      username: id,
      passwordHash: 'test',
      active: true,
    });
  auth.add({
    actor: { id: 'mario', name: 'Mario', initials: 'M', role: 'viewer', profile: 'warehouse' },
    username: 'mario',
    passwordHash: 'test',
    active: true,
  });
  const mario = auth.account('mario')!.actor,
    ana = auth.account('ana')!.actor,
    antonio = auth.account('antonio')!.actor;
  const commerce = new CommerceStore(store);
  const sale = new Checkout(commerce, randomUUID, () => new Date().toISOString()).execute(
    { id: 'buyer', role: 'editor' },
    {
      requestId: randomUUID(),
      lines: [{ productId: 'nc1', quantity: 1, expectedPriceCents: 7990 }],
    },
  );
  const orders = new ManageOrder(commerce);
  orders.execute(mario, sale.id, { status: 'prepared', expectedStatus: 'confirmed' });
  orders.execute(mario, sale.id, { status: 'prepared', expectedStatus: 'confirmed' });
  const inbox = notices.list(ana);
  assert.equal(inbox.length, 1);
  assert.match(inbox[0]!.message, /Almacén ha preparado/);
  assert.equal(inbox[0]!.by, 'Mario');
  assert.equal(notices.list(mario).length, 0);
  assert.throws(() => notices.read(mario, inbox[0]!.id), { code: 'NOTICE_NOT_FOUND' });
  notices.read(ana, inbox[0]!.id);
  assert.equal(notices.list(ana)[0]!.read, true);
  assert.equal(notices.list(antonio)[0]!.read, false);
  orders.execute(ana, sale.id, {
    status: 'dispatch_ready',
    expectedStatus: 'prepared',
    carrier: 'Transportista',
    reference: 'EXP-ROLE',
  });
  assert.equal(notices.list(mario).length, 1);
  assert.match(notices.list(mario)[0]!.message, /Oficina ha tramitado/);
  assert.throws(
    () => orders.execute(ana, sale.id, { status: 'shipped', expectedStatus: 'prepared' }),
    { code: 'FORBIDDEN' },
  );
  orders.execute(mario, sale.id, { status: 'shipped', expectedStatus: 'prepared' });
  assert.ok(notices.list(ana).some((n) => n.message.includes('recogido')));
});

test('los avisos no reinterpretan como dirección el historial anterior al nuevo reparto', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const auth = new AuthStore(store.db);
  auth.add({
    actor: { id: 'ana', name: 'Ana', initials: 'A', role: 'editor', businessRole: 'office' },
    username: 'ana',
    passwordHash: 'fixture',
    active: true,
  });
  const notices = new StaffNotices(store);
  store.record('old', 'order.status-changed', { orderId: 'antiguo', after: 'prepared' });
  store.record('local-setup', 'account.company-roles-configured', {});
  store.record('new', 'order.status-changed', { orderId: 'nuevo', after: 'prepared' });
  const result = notices.list(auth.account('ana')!.actor);
  assert.equal(result.length, 1);
  assert.match(result[0]!.message, /nuevo/);
});
