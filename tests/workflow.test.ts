import { sessions } from './auth-fixture.ts';
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Store, sha } from '../src/infrastructure/store.ts';
import { ProposalService, actorFor } from '../src/application/proposals.ts';
import { AppError, simulate, validatePlan } from '../src/domain/catalog.ts';
import { makeServer } from '../src/server.ts';
function required<T>(value: T | undefined): T {
  assert.notEqual(value, undefined);
  if (value === undefined) throw new Error('Falta un dato esperado');
  return value;
}
const editor = actorFor('elena'),
  reviewer = actorFor('marcos'),
  viewer = actorFor('lucia');
const service = (store: Store) =>
  new ProposalService(
    store,
    { hash: sha },
    { now: () => new Date().toISOString() },
    { next: randomUUID },
  );
const request = (basisPoints = 500) => ({
  instruction: 'Ajuste de campaña',
  plan: { category: 'Lavado exterior', basisPoints },
});
const setup = (t: TestContext) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  return { store, app: service(store) };
};
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
test('simular no modifica catálogo ni pedidos', (t) => {
  const { store, app } = setup(t),
    products = store.products(),
    orders = store.orders(),
    p = app.create(editor, request());
  assert.equal(p.status, 'ready');
  assert.equal(p.changes.length, 3);
  assert.deepEqual(store.products(), products);
  assert.deepEqual(store.orders(), orders);
  assert.equal(store.proposals().length, 1);
});
test('publicar aplica céntimos exactos, incrementa versiones y conserva pedidos confirmados', (t) => {
  const { store, app } = setup(t),
    orders = store.orders(),
    p = app.create(editor, request());
  const applied = app.publish(reviewer, p.id, p.digest);
  assert.equal(applied.status, 'applied');
  assert.equal(required(store.products()[0]).priceCents, 8390);
  assert.equal(required(store.products()[0]).version, 2);
  assert.equal(required(store.products()[3]).version, 1);
  assert.deepEqual(store.orders(), orders);
  assert.equal(store.verifyAudit(), true);
});
test('rebaja bajo margen mínimo se guarda bloqueada y nunca se publica', (t) => {
  const { store, app } = setup(t),
    before = store.products(),
    p = app.create(editor, request(-2500));
  assert.equal(p.status, 'blocked');
  assert.ok(p.findings.some((f) => f.code === 'MIN_MARGIN'));
  assert.throws(() => app.publish(reviewer, p.id, p.digest), code('INVALID_STATE'));
  assert.deepEqual(store.products(), before);
});
test('límite exacto de margen bruto usa 20 % sobre precio, no sobre coste', () => {
  const p = {
    id: 'x',
    sku: 'x',
    name: 'x',
    category: 'x',
    priceCents: 100,
    costCents: 100,
    version: 1,
  };
  assert.equal(simulate([p], { category: 'x', basisPoints: 2500 }).findings.length, 0);
  assert.equal(
    simulate([p], { category: 'x', basisPoints: 2400 }).findings.at(0)?.code,
    'MIN_MARGIN',
  );
});
test('lector no crea y editor no publica; revisor no crea', (t) => {
  const { app } = setup(t);
  assert.throws(() => app.create(viewer, request()), code('FORBIDDEN'));
  assert.throws(() => app.create(reviewer, request()), code('FORBIDDEN'));
  const p = app.create(editor, request());
  assert.throws(() => app.publish(editor, p.id, p.digest), code('FORBIDDEN'));
});
test('dos propuestas sobre la misma versión: la segunda queda desactualizada', (t) => {
  const { store, app } = setup(t),
    a = app.create(editor, request()),
    b = app.create(editor, request(600));
  app.publish(reviewer, a.id, a.digest);
  const before = store.products(),
    audit = store.audit();
  assert.throws(() => app.publish(reviewer, b.id, b.digest), code('STALE_DATA'));
  assert.deepEqual(store.products(), before);
  assert.deepEqual(store.audit(), audit);
});
test('solo se publica el digest de la versión revisada', (t) => {
  const { store, app } = setup(t),
    p = app.create(editor, request()),
    before = store.products();
  assert.throws(() => app.publish(reviewer, p.id, 'alterado'), code('REVIEW_MISMATCH'));
  assert.deepEqual(store.products(), before);
  const modified = { ...p, changes: p.changes.map((c, i) => (i ? c : { ...c, afterCents: 9999 })) };
  store.save(modified);
  assert.throws(() => app.publish(reviewer, p.id, p.digest), code('REVIEW_MISMATCH'));
  assert.deepEqual(store.products(), before);
});
test('fallo en la segunda escritura revierte también la primera y no registra publicación', (t) => {
  const { store, app } = setup(t),
    p = app.create(editor, request()),
    before = store.products(),
    audit = store.audit();
  const update = store.updatePrice.bind(store);
  let calls = 0;
  store.updatePrice = (c) => (++calls === 2 ? false : update(c));
  assert.throws(() => app.publish(reviewer, p.id, p.digest), code('STALE_DATA'));
  assert.deepEqual(store.products(), before);
  assert.deepEqual(store.audit(), audit);
  assert.equal(store.proposal(p.id)?.status, 'ready');
});
test('un cambio de coste que invalida el margen se comprueba de nuevo al publicar', (t) => {
  const { store, app } = setup(t),
    p = app.create(editor, request());
  store.db.prepare('UPDATE products SET costCents=8000 WHERE id=?').run('nc1');
  assert.throws(() => app.publish(reviewer, p.id, p.digest), code('MIN_MARGIN'));
  assert.equal(required(store.products()[0]).priceCents, 7990);
});
test('planes rechazan claves arbitrarias, porcentajes fuera de rango, no enteros y categorías vacías', () => {
  for (const plan of [
    { category: 'x', basisPoints: 5010 },
    { category: 'x', basisPoints: 1.5 },
    { category: 'x', basisPoints: 0 },
    { category: '', basisPoints: 500 },
    { category: 'x', basisPoints: 500, sql: 'DROP TABLE products' },
  ])
    assert.throws(() => validatePlan(plan));
});
test('persistencia real tras cerrar y reabrir SQLite', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'changelab-'));
  t.after(() => {
    if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith('changelab-'))
      throw new Error('Ruta temporal inesperada');
    rmSync(dir, { recursive: true, force: true });
  });
  const path = join(dir, 'test.sqlite');
  let store = new Store(path);
  const app = service(store),
    p = app.create(editor, request());
  app.publish(reviewer, p.id, p.digest);
  store.close();
  store = new Store(path);
  try {
    assert.equal(required(store.products()[0]).priceCents, 8390);
    assert.equal(store.proposal(p.id)?.status, 'applied');
    assert.equal(store.verifyAudit(), true);
  } finally {
    store.close();
  }
});
test('la cadena detecta una modificación del historial', (t) => {
  const { store } = setup(t);
  assert.equal(store.verifyAudit(), true);
  store.db.prepare('UPDATE audit SET detail=? WHERE seq=1').run('{}');
  assert.equal(store.verifyAudit(), false);
});
test('API: sesión autenticada, origen, JSON y doble publicación concurrente', async (t) => {
  const { store } = setup(t),
    server = makeServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = 'http://127.0.0.1:' + address.port;
  const headersFor = sessions(store, url);
  const headers = headersFor('elena');
  assert.equal((await fetch(url + '/api/workspace')).status, 401);
  assert.equal(
    (
      await fetch(url + '/api/proposals', {
        method: 'POST',
        headers: { ...headers, Origin: 'https://otro.example' },
        body: JSON.stringify(request()),
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(url + '/api/proposals', { method: 'POST', headers, body: 'mal JSON' })).status,
    400,
  );
  assert.equal(
    (await fetch(url + '/api/proposals', { method: 'POST', headers, body: 'null' })).status,
    400,
  );
  assert.equal(
    (
      await fetch(url + '/api/proposals', {
        method: 'POST',
        headers: headersFor('lucia'),
        body: JSON.stringify(request()),
      })
    ).status,
    403,
  );
  const created = await fetch(url + '/api/proposals', {
    method: 'POST',
    headers,
    body: JSON.stringify(request()),
  });
  assert.equal(created.status, 201);
  const p: unknown = await created.json();
  assert.ok(
    p &&
      typeof p === 'object' &&
      'id' in p &&
      typeof p.id === 'string' &&
      'digest' in p &&
      typeof p.digest === 'string',
  );
  const results = await Promise.all(
    [1, 2].map(() =>
      fetch(url + '/api/proposals/' + p.id + '/publish', {
        method: 'POST',
        headers: headersFor('marcos'),
        body: JSON.stringify({ digest: p.digest }),
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(required(store.products()[0]).version, 2);
  assert.equal(store.audit().filter((a) => a.action === 'proposal.applied').length, 1);
  const html = await fetch(url + '/');
  assert.equal(html.status, 200);
  assert.match(await html.text(), /ChangeLab/);
  assert.ok(html.headers.get('content-security-policy')?.includes("script-src 'self'"));
});

test('cambiar el motivo después de revisar también invalida la aprobación', (t) => {
  const { store, app } = setup(t),
    p = app.create(editor, request());
  store.save({ ...p, instruction: 'Un motivo distinto al revisado' });
  assert.throws(() => app.publish(reviewer, p.id, p.digest), code('REVIEW_MISMATCH'));
  assert.equal(required(store.products()[0]).priceCents, 7990);
});
