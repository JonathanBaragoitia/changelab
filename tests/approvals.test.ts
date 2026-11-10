import test from 'node:test';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { Store } from '../src/infrastructure/store.ts';
import { ApprovalStore } from '../src/infrastructure/approval-store.ts';
import { Approvals } from '../src/application/approvals.ts';
const editor = { id: 'editor-a', role: 'editor' as const };
const reviewer = { id: 'reviewer-b', role: 'reviewer' as const };
const body = (cents = 10001) => ({
  id: 'approval-request-001',
  kind: 'expense',
  category: 'Servicios',
  description: 'Servicio del taller',
  cents,
});
test('política de importes, personal, roles y resoluciones inmutables', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const repo = new ApprovalStore(store),
    service = new Approvals(repo, () => '2026-10-30T12:00:00Z');
  assert.equal(
    service.create(editor, { ...body(10000), id: 'approval-request-auto' }).status,
    'approved',
  );
  assert.equal(
    service.create(editor, { ...body(1), id: 'approval-request-personal', category: 'Personal' })
      .status,
    'rejected',
  );
  assert.throws(() => service.create(reviewer, body()));
  assert.equal(service.create(editor, body()).status, 'pending');
  assert.throws(() =>
    service.resolve({ ...reviewer, id: editor.id }, String(body().id), {
      status: 'approved',
      reason: 'Visto y revisado',
    }),
  );
  assert.throws(() =>
    service.resolve(reviewer, String(body().id), { status: 'rejected', reason: '' }),
  );
  assert.equal(repo.get(String(body().id))?.status, 'pending');
  service.resolve(reviewer, String(body().id), { status: 'approved', reason: 'Visto y revisado' });
  assert.throws(() =>
    service.resolve(reviewer, String(body().id), { status: 'rejected', reason: 'Otra decisión' }),
  );
  repo.deliver();
  repo.deliver();
  assert.equal(repo.inbox(editor.id).length, 3);
  assert.equal(repo.inbox(reviewer.id).length, 0);
  assert.equal(service.create(editor, body()).status, 'approved');
  assert.throws(() => service.create(editor, { ...body(), cents: 20000 }));
});
test('fallo de notificación no pierde decisión: outbox reintentable e idempotente', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const repo = new ApprovalStore(store),
    service = new Approvals(repo, () => '2026-10-30T12:00:00Z');
  service.create(editor, body());
  service.resolve(reviewer, String(body().id), {
    status: 'rejected',
    reason: 'Presupuesto insuficiente',
  });
  store.db.exec(
    "CREATE TRIGGER fail_delivery BEFORE INSERT ON approval_inbox BEGIN SELECT RAISE(ABORT, 'simulated failure'); END",
  );
  assert.throws(() => repo.deliver());
  assert.equal(repo.get(String(body().id))?.status, 'rejected');
  assert.equal(store.db.prepare('SELECT delivered FROM approval_outbox').get()?.delivered, 0);
  store.db.exec('DROP TRIGGER fail_delivery');
  repo.deliver();
  repo.deliver();
  assert.equal(repo.inbox(editor.id).length, 1);
});
test('fallo al encolar revierte solicitud e historial', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const repo = new ApprovalStore(store),
    service = new Approvals(repo, () => '2026-10-30T12:00:00Z');
  store.db.exec(
    "CREATE TRIGGER fail_enqueue BEFORE INSERT ON approval_outbox BEGIN SELECT RAISE(ABORT, 'simulated failure'); END",
  );
  assert.throws(() => service.create(editor, body(100)));
  assert.equal(repo.get(String(body().id)), undefined);
});

test('HTTP: permisos, CSRF, aprobación y gasto ejecutado una sola vez', async (t) => {
  const { makeServer } = await import('../src/server.ts');
  const { sessions } = await import('./auth-fixture.ts');
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
  const call = async (path: string, body?: unknown, actor = 'elena', status = 200) => {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: headers(actor),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    assert.equal(response.status, status, JSON.stringify(value));
    return value;
  };
  assert.equal((await fetch(base + '/api/approvals')).status, 401);
  const missing = { ...headers('elena') };
  delete missing['X-CSRF-Token'];
  assert.equal(
    (
      await fetch(base + '/api/approvals', {
        method: 'POST',
        headers: missing,
        body: JSON.stringify(body()),
      })
    ).status,
    403,
  );
  await call('/api/approvals', body(), 'lucia', 403);
  await call('/api/approvals', body(), 'elena', 201);
  const url = '/api/approvals/' + body().id;
  await call(
    url + '/expense',
    { date: '2026-10-30', reference: 'AP-001', vatRate: 21 },
    'elena',
    409,
  );
  await call(url, { status: 'approved', reason: 'Revisión correcta' }, 'marcos');
  const expense = { date: '2026-10-30', reference: 'AP-001', vatRate: 21 };
  await call(url + '/expense', expense, 'marcos', 403);
  await call(url + '/expense', expense, 'elena', 201);
  await call(url + '/expense', expense, 'elena', 201);
  const report = await call('/api/economics?from=2026-10-01&to=2026-10-31');
  assert.equal(report.expenseCents, 10001);
  assert.equal(report.expenses.length, 1);
  assert.equal((await call('/api/approvals')).notifications.length, 1);
  assert.equal((await call('/api/approvals', undefined, 'marcos')).notifications.length, 0);
});
