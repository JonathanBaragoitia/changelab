import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { AuthService } from '../src/application/auth.ts';
import { AuthStore } from '../src/infrastructure/auth-store.ts';
import { credentials } from '../src/infrastructure/auth-crypto.ts';
import { Store } from '../src/infrastructure/store.ts';
import { AppError } from '../src/domain/catalog.ts';
import { actors } from '../src/application/proposals.ts';
import { makeServer } from '../src/server.ts';

const password = credentials.token();
const encoded = credentials.hash(password);
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;
async function fixture(t: TestContext) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const repo = new AuthStore(store.db);
  for (const actor of actors)
    repo.add({ actor, username: actor.id, passwordHash: await encoded, active: true });
  return { store, repo, auth: new AuthService(repo, credentials) };
}
async function web(t: TestContext) {
  const context = await fixture(t),
    server = makeServer(context.store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = 'http://127.0.0.1:' + address.port;
  const login = async (username = 'elena', suppliedPassword = password) => {
    const response = await fetch(url + '/api/login', {
      method: 'POST',
      headers: { Origin: url, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: suppliedPassword }),
    });
    return response;
  };
  return { ...context, url, login };
}
async function authorized(response: Response, origin: string) {
  assert.equal(response.status, 200);
  const value: unknown = await response.json();
  assert.ok(
    value && typeof value === 'object' && 'csrf' in value && typeof value.csrf === 'string',
  );
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie);
  return {
    'Content-Type': 'application/json',
    Origin: origin,
    Cookie: cookie.split(';')[0] ?? '',
    'X-CSRF-Token': value.csrf,
  };
}

test('scrypt usa sal aleatoria y verifica sin guardar contraseñas en claro', async () => {
  const a = await encoded,
    b = await credentials.hash(password);
  assert.notEqual(a, b);
  assert.ok(a.startsWith('scrypt$131072$8$1$'));
  assert.ok(!a.includes(password));
  assert.equal(await credentials.verify(password, a), true);
  assert.equal(await credentials.verify('contraseña distinta', a), false);
  assert.equal(await credentials.verify(password, ''), false);
});

test('crear cuentas valida rol, usuario y longitud; no devuelve el hash', async (t) => {
  const { auth } = await fixture(t);
  for (const values of [
    ['ab', 'Nombre', 'editor', password],
    ['nuevo', 'Nombre', 'admin', password],
    ['nuevo', 'Nombre', 'editor', 'corta'],
    ['nuevo', '', 'editor', password],
  ])
    await assert.rejects(
      auth.createAccount(...(values as [unknown, unknown, unknown, unknown])),
      code('INVALID_ACCOUNT'),
    );
  const actor = await auth.createAccount('nuevo', 'Persona Nueva', 'viewer', password);
  assert.equal(actor.role, 'viewer');
  assert.ok(!('passwordHash' in actor));
  await assert.rejects(
    auth.createAccount('nuevo', 'Otra', 'editor', password),
    code('ACCOUNT_EXISTS'),
  );
});

test('login emite sesión nueva y persiste solo hash del token', async (t) => {
  const { store, auth } = await fixture(t);
  const first = await auth.login('elena', password, 'test');
  const second = await auth.login('elena', password, 'test');
  assert.notEqual(first.token, second.token);
  assert.equal(auth.current(first.token).actor.id, 'elena');
  const row = store.db
    .prepare('SELECT * FROM sessions WHERE tokenHash=?')
    .get(credentials.digest(first.token));
  assert.ok(row);
  assert.equal(Object.values(row).includes(first.token), false);
});

test('sesión caducada, inexistente o revocada no autentica', async (t) => {
  const { repo } = await fixture(t);
  let now = Date.now();
  const auth = new AuthService(repo, credentials, () => now);
  const first = await auth.login('elena', password, 'test');
  auth.logout(first.token);
  assert.throws(() => auth.current(first.token), code('LOGIN_REQUIRED'));
  const second = await auth.login('elena', password, 'test');
  now += 8 * 60 * 60 * 1000;
  assert.throws(() => auth.current(second.token), code('LOGIN_REQUIRED'));
  assert.throws(() => auth.current('inventada'), code('LOGIN_REQUIRED'));
});

test('desactivar la cuenta revoca acceso y el rol se relee desde el servidor', async (t) => {
  const { store, auth } = await fixture(t);
  const session = await auth.login('elena', password, 'test');
  store.db.prepare("UPDATE users SET role='viewer' WHERE id='elena'").run();
  assert.equal(auth.current(session.token).actor.role, 'viewer');
  store.db.prepare("UPDATE users SET active=0 WHERE id='elena'").run();
  assert.throws(() => auth.current(session.token), code('LOGIN_REQUIRED'));
});

test('límite de intentos sobrevive a recrear el servicio y permite reintentar tras la ventana', async (t) => {
  const { repo } = await fixture(t);
  let now = Date.now();
  const fake = {
    ...credentials,
    async verify() {
      return false;
    },
  };
  for (let i = 0; i < 5; i++)
    await assert.rejects(
      new AuthService(repo, fake, () => now).login('elena', 'incorrecta', 'test'),
      code('INVALID_CREDENTIALS'),
    );
  await assert.rejects(
    new AuthService(repo, fake, () => now).login('elena', 'incorrecta', 'test'),
    code('LOGIN_LIMIT'),
  );
  now += 59_999;
  await assert.rejects(
    new AuthService(repo, fake, () => now).login('elena', 'incorrecta', 'test'),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'LOGIN_LIMIT');
      assert.match(error.message, /1 minuto/);
      return true;
    },
  );
  now += 1;
  await assert.rejects(
    new AuthService(repo, fake, () => now).login('elena', 'incorrecta', 'test'),
    code('INVALID_CREDENTIALS'),
  );
});

test('cuentas y sesiones persisten al cerrar y reabrir SQLite', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'changelab-auth-'));
  t.after(() => {
    if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith('changelab-auth-'))
      throw new Error('Ruta temporal inesperada');
    rmSync(dir, { recursive: true, force: true });
  });
  const path = join(dir, 'auth.sqlite');
  let store = new Store(path),
    repo = new AuthStore(store.db);
  repo.add({ actor: actors[0], username: 'elena', passwordHash: await encoded, active: true });
  const session = await new AuthService(repo, credentials).login('elena', password, 'test');
  store.close();
  store = new Store(path);
  try {
    repo = new AuthStore(store.db);
    assert.equal(new AuthService(repo, credentials).current(session.token).actor.id, 'elena');
  } finally {
    store.close();
  }
});

test('HTTP exige sesión, ignora cabecera demo y devuelve cookie HttpOnly SameSite sin token JSON', async (t) => {
  const { url, login } = await web(t);
  assert.equal(
    (await fetch(url + '/api/workspace', { headers: { 'X-Demo-User': 'marcos' } })).status,
    401,
  );
  const response = await login(),
    cookie = response.headers.get('set-cookie');
  assert.ok(cookie?.includes('HttpOnly'));
  assert.ok(cookie?.includes('SameSite=Strict'));
  const headers = await authorized(response, url);
  const session = await fetch(url + '/api/session', { headers });
  assert.equal(session.status, 200);
  const body: unknown = await session.json();
  assert.ok(
    body &&
      typeof body === 'object' &&
      'actor' in body &&
      !('token' in body) &&
      !('passwordHash' in body),
  );
  const bad = await login('elena', 'incorrecta'),
    unknown = await login('desconocido', 'incorrecta');
  assert.equal(bad.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(await bad.json(), await unknown.json());
});

test('HTTP aplica origen, CSRF, separación de roles y revocación al salir', async (t) => {
  const { url, login } = await web(t),
    editorHeaders = await authorized(await login(), url);
  const send = (headers: Record<string, string>, path: string, body: unknown) =>
    fetch(url + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const request = {
    instruction: 'Cambio autenticado',
    plan: { category: 'Lavado exterior', basisPoints: 500 },
  };
  assert.equal(
    (await send({ ...editorHeaders, 'X-CSRF-Token': '' }, '/api/proposals', request)).status,
    403,
  );
  assert.equal(
    (await send({ ...editorHeaders, Origin: 'http://otro.example' }, '/api/proposals', request))
      .status,
    403,
  );
  const created = await send(editorHeaders, '/api/proposals', request);
  assert.equal(created.status, 201);
  const proposal: unknown = await created.json();
  assert.ok(
    proposal &&
      typeof proposal === 'object' &&
      'id' in proposal &&
      typeof proposal.id === 'string' &&
      'digest' in proposal,
  );
  const publish = '/api/proposals/' + proposal.id + '/publish';
  assert.equal(
    (
      await send({ ...editorHeaders, 'X-Demo-User': 'marcos' }, publish, {
        digest: proposal.digest,
      })
    ).status,
    403,
  );
  const reviewerHeaders = await authorized(await login('marcos'), url);
  assert.equal((await send(reviewerHeaders, '/api/proposals', request)).status, 403);
  assert.equal((await send(reviewerHeaders, publish, { digest: proposal.digest })).status, 200);
  const viewerHeaders = await authorized(await login('lucia'), url);
  assert.equal((await send(viewerHeaders, '/api/proposals', request)).status, 403);
  assert.equal((await send(editorHeaders, '/api/logout', {})).status, 200);
  assert.equal((await fetch(url + '/api/workspace', { headers: editorHeaders })).status, 401);
});

test('HTTP impide aprobar una propuesta propia incluso tras cambiar al rol revisor', async (t) => {
  const { url, login, store } = await web(t);
  const headers = await authorized(await login(), url);
  const response = await fetch(url + '/api/proposals', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      instruction: 'Cambio propio',
      plan: { category: 'Lavado exterior', basisPoints: 500 },
    }),
  });
  assert.equal(response.status, 201);
  const proposal: unknown = await response.json();
  assert.ok(
    proposal &&
      typeof proposal === 'object' &&
      'id' in proposal &&
      typeof proposal.id === 'string' &&
      'digest' in proposal,
  );
  store.db.prepare("UPDATE users SET role='reviewer' WHERE id='elena'").run();
  const denied = await fetch(url + '/api/proposals/' + proposal.id + '/publish', {
    method: 'POST',
    headers,
    body: JSON.stringify({ digest: proposal.digest, role: 'reviewer', createdBy: 'otra-persona' }),
  });
  assert.equal(denied.status, 403);
  const body: unknown = await denied.json();
  assert.ok(body && typeof body === 'object' && 'error' in body);
  assert.equal(body.error, 'SELF_APPROVAL');
});

test('HTTP renueva la sesión al volver a entrar y revoca la cookie anterior', async (t) => {
  const { url, login } = await web(t);
  const first = await authorized(await login(), url);
  const again = await fetch(url + '/api/login', {
    method: 'POST',
    headers: first,
    body: JSON.stringify({ username: 'elena', password }),
  });
  const second = await authorized(again, url);
  assert.notEqual(first.Cookie, second.Cookie);
  assert.equal((await fetch(url + '/api/workspace', { headers: first })).status, 401);
  assert.equal((await fetch(url + '/api/workspace', { headers: second })).status, 200);
});

test('contraseñas de nueve caracteres admiten números, letras o combinación y permiten entrar', async (t) => {
  const { auth } = await fixture(t);
  for (const [index, value] of ['123456789', 'abcdefghi', 'abc123456'].entries()) {
    const username = 'prueba' + index;
    const actor = await auth.createAccount(username, 'Prueba', 'editor', value);
    const session = await auth.login(username, value, 'test');
    assert.equal(session.actor.id, actor.id);
  }
  for (const value of ['12345678', 'x'.repeat(129)]) {
    await assert.rejects(
      auth.createAccount('invalido', 'Prueba', 'editor', value),
      code('INVALID_ACCOUNT'),
    );
  }
});

test('compras HTTP: sin sesión, CSRF, roles y concurrencia por la última unidad', async (t) => {
  const { store, url, login } = await web(t);
  const editorHeaders = await authorized(await login(), url);
  const payload = () => ({
    requestId: credentials.token(),
    lines: [{ productId: 'nc1', quantity: 1, expectedPriceCents: 7990 }],
  });
  const send = (headers: Record<string, string>, body: unknown) =>
    fetch(url + '/api/orders', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  const noSession = await send({ Origin: url, 'Content-Type': 'application/json' }, payload());
  assert.equal(noSession.status, 401);
  assert.equal((await send({ ...editorHeaders, 'X-CSRF-Token': '' }, payload())).status, 403);
  for (const user of ['marcos', 'lucia']) {
    const headers = await authorized(await login(user), url);
    assert.equal((await send(headers, payload())).status, 403);
  }
  store.db.prepare("UPDATE inventory SET quantity=1 WHERE productId='nc1'").run();
  const results = await Promise.all([
    send(editorHeaders, payload()),
    send(editorHeaders, payload()),
  ]);
  assert.deepEqual(results.map((response) => response.status).sort(), [201, 409]);
  assert.equal(
    store.db.prepare("SELECT quantity FROM inventory WHERE productId='nc1'").get()?.quantity,
    0,
  );
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM sales').get()?.n, 1);
  assert.equal(store.verifyAudit(), true);
});

test('tienda invitada: catálogo sin costes, pedidos privados y sin permisos internos', async (t) => {
  const { url, store } = await web(t);
  const open = async () => {
    const response = await fetch(url + '/api/shop');
    assert.equal(response.status, 200);
    const value = await response.json();
    return {
      value,
      headers: {
        Origin: url,
        'Content-Type': 'application/json',
        Cookie: response.headers.get('set-cookie')!.split(';')[0]!,
        'X-CSRF-Token': value.csrf,
      },
    };
  };
  const first = await open(),
    second = await open();
  assert.equal(first.value.products.length, 18);
  assert.ok(!JSON.stringify(first.value).includes('costCents'));
  assert.ok(!JSON.stringify(first.value).includes('metrics'));
  const body = {
    requestId: credentials.token(),
    lines: [{ productId: 'nc2', quantity: 1, expectedPriceCents: 3490 }],
    customer: {
      name: 'Cliente Demo',
      email: 'demo@example.com',
      address: 'Calle de Prueba 1, Madrid',
    },
  };
  const send = (headers: Record<string, string>, payload: unknown) =>
    fetch(url + '/api/shop/orders', { method: 'POST', headers, body: JSON.stringify(payload) });
  assert.equal((await send({ ...first.headers, 'X-CSRF-Token': '' }, body)).status, 403);
  assert.equal((await send({ ...first.headers, Origin: 'http://otro.example' }, body)).status, 403);
  assert.equal((await send(first.headers, { ...body, customer: { name: 'X' } })).status, 400);
  const created = await send(first.headers, body);
  assert.equal(created.status, 201);
  const order = await created.json();
  assert.ok(!JSON.stringify(order).includes('Cost'));
  assert.ok(!('actorId' in order));
  assert.ok(!('customer' in order));
  assert.deepEqual(await (await send(first.headers, body)).json(), order);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM sales').get()?.n, 1);
  const own = await (await fetch(url + '/api/shop', { headers: first.headers })).json();
  const other = await (await fetch(url + '/api/shop', { headers: second.headers })).json();
  assert.equal(own.orders.length, 1);
  assert.equal(other.orders.length, 0);
  assert.equal((await fetch(url + '/api/workspace', { headers: first.headers })).status, 401);
  assert.equal(
    (
      await fetch(url + '/api/orders', {
        method: 'POST',
        headers: first.headers,
        body: JSON.stringify(body),
      })
    ).status,
    401,
  );
  assert.equal(store.verifyAudit(), true);
});

test('gestión HTTP de estados exige cuenta editora y CSRF, sincroniza tienda y cancela una sola vez', async (t) => {
  const { url, login, store } = await web(t);
  const headers = await authorized(await login(), url);
  const created = await fetch(url + '/api/orders', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: credentials.token(),
      lines: [{ productId: 'nc1', quantity: 1, expectedPriceCents: 7990 }],
    }),
  });
  assert.equal(created.status, 201);
  const sale = await created.json(),
    path = url + '/api/orders/' + sale.id + '/status';
  const body = { status: 'cancelled', expectedStatus: 'confirmed' };
  const send = (h: Record<string, string>) =>
    fetch(path, { method: 'POST', headers: h, body: JSON.stringify(body) });
  assert.equal((await send({ ...headers, 'X-CSRF-Token': '' })).status, 403);
  const reviewer = await authorized(await login('marcos'), url);
  assert.equal((await send(reviewer)).status, 403);
  const responses = await Promise.all([send(headers), send(headers)]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [200, 200],
  );
  assert.equal(
    store.db.prepare("SELECT quantity FROM inventory WHERE productId='nc1'").get()?.quantity,
    20,
  );
  assert.equal(
    store.db.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE kind='cancellation'").get()
      ?.n,
    1,
  );
  assert.equal(store.verifyAudit(), true);
});

test('recepción HTTP: permisos, CSRF, duplicados concurrentes y persistencia de stock', async (t) => {
  const { url, login, store } = await web(t),
    headers = await authorized(await login(), url);
  const body = {
    requestId: credentials.token(),
    productId: 'nc1',
    quantity: 5,
    supplier: 'Proveedor Demo',
    reference: 'ALB-HTTP-001',
  };
  const send = (h: Record<string, string>, payload = body) =>
    fetch(url + '/api/inventory/receipts', {
      method: 'POST',
      headers: h,
      body: JSON.stringify(payload),
    });
  assert.equal((await send({ ...headers, 'X-CSRF-Token': '' })).status, 403);
  const viewer = await authorized(await login('lucia'), url);
  assert.equal((await send(viewer)).status, 403);
  const responses = await Promise.all([send(headers), send(headers)]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [201, 201],
  );
  assert.equal(
    store.db.prepare("SELECT quantity FROM inventory WHERE productId='nc1'").get()?.quantity,
    25,
  );
  assert.equal((await send(headers, { ...body, requestId: credentials.token() })).status, 409);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM stock_receipts').get()?.n, 1);
  assert.equal(store.verifyAudit(), true);
});

test('borradores HTTP: crear sin duplicar, acceso interno y aviso de cancelación', async (t) => {
  const { url, login } = await web(t),
    headers = await authorized(await login(), url);
  const response = await fetch(url + '/api/orders', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: credentials.token(),
      lines: [{ productId: 'nc1', quantity: 1, expectedPriceCents: 7990 }],
    }),
  });
  const sale = await response.json();
  const payload = {
    issuer: { name: 'Emisor Demo', taxId: 'DEMO-001', address: 'Calle Emisor 1' },
    recipient: { name: 'Cliente Demo', taxId: 'DEMO-002', address: 'Calle Cliente 2' },
    acceptDemoTax: true,
  };
  const path = url + '/api/orders/' + sale.id + '/draft';
  const send = (h: Record<string, string>) =>
    fetch(path, { method: 'POST', headers: h, body: JSON.stringify(payload) });
  const viewer = await authorized(await login('lucia'), url);
  assert.equal((await send(viewer)).status, 403);
  assert.equal((await send({ ...headers, 'X-CSRF-Token': '' })).status, 403);
  const [a, b] = await Promise.all([send(headers), send(headers)]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  const draft = await a.json();
  assert.deepEqual(await b.json(), draft);
  assert.equal((await fetch(url + '/api/billing/drafts/' + draft.id)).status, 401);
  await fetch(url + '/api/orders/' + sale.id + '/status', {
    method: 'POST',
    headers,
    body: JSON.stringify({ status: 'cancelled', expectedStatus: 'confirmed' }),
  });
  const saved = await (await fetch(url + '/api/billing/drafts/' + draft.id, { headers })).json();
  assert.equal(saved.orderCancelled, true);
  assert.equal(saved.draft.totalCents, 9668);
});

test('control económico HTTP exige acceso y rol para registrar gastos', async (t) => {
  const { url, login } = await web(t);
  assert.equal((await fetch(url + '/api/economics?from=2026-10-01&to=2026-10-31')).status, 401);
  const headers = await authorized(await login(), url),
    viewer = await authorized(await login('lucia'), url);
  const payload = {
    requestId: credentials.token(),
    date: '2026-10-27',
    reference: 'GASTO-HTTP',
    category: 'Servicios',
    description: 'Servicio de prueba',
    baseCents: 1000,
    vatRate: 21,
  };
  const send = (h: Record<string, string>) =>
    fetch(url + '/api/expenses', { method: 'POST', headers: h, body: JSON.stringify(payload) });
  assert.equal((await send(viewer)).status, 403);
  assert.equal((await send({ ...headers, 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await send(headers)).status, 201);
  const report = await (
    await fetch(url + '/api/economics?from=2026-10-01&to=2026-10-31', { headers: viewer })
  ).json();
  assert.equal(report.expenseCents, 1000);
  assert.equal(report.operatingResultCents, -1000);
  assert.equal(
    (await fetch(url + '/api/economics?from=2026-11-01&to=2026-10-01', { headers })).status,
    400,
  );
});

test('cobros HTTP: sesión, CSRF, roles y dos peticiones no sobrecobran', async (t) => {
  const { url, login, store } = await web(t),
    headers = await authorized(await login(), url);
  const response = await fetch(url + '/api/orders', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requestId: credentials.token(),
      lines: [{ productId: 'nc1', quantity: 1, expectedPriceCents: 7990 }],
    }),
  });
  const sale = await response.json();
  const body = {
    requestId: credentials.token(),
    kind: 'collection',
    targetId: sale.id,
    amountCents: 9668,
    date: '2026-10-27',
    reference: 'COBRO-HTTP',
    method: 'Transferencia',
  };
  const send = (h: Record<string, string>, payload = body) =>
    fetch(url + '/api/cash', { method: 'POST', headers: h, body: JSON.stringify(payload) });
  assert.equal((await fetch(url + '/api/cash')).status, 401);
  assert.equal((await send({ ...headers, 'X-CSRF-Token': '' })).status, 403);
  const viewer = await authorized(await login('lucia'), url);
  assert.equal((await send(viewer)).status, 403);
  const responses = await Promise.all([
    send(headers),
    send(headers, { ...body, requestId: credentials.token(), reference: 'OTRO-COBRO' }),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM cash_entries').get()?.n, 1);
  const report = await (await fetch(url + '/api/cash', { headers: viewer })).json();
  assert.equal(report.targets[0].pendingCents, 0);
});

test('cuenta cliente conserva pedidos de invitado, permite volver a entrar y no accede a gestión', async (t) => {
  const { url } = await web(t);
  const open = await fetch(url + '/api/shop'),
    guest = await open.json();
  const guestHeaders = {
    'Content-Type': 'application/json',
    Origin: url,
    Cookie: open.headers.get('set-cookie')!.split(';')[0]!,
    'X-CSRF-Token': guest.csrf,
  };
  const purchase = await fetch(url + '/api/shop/orders', {
    method: 'POST',
    headers: guestHeaders,
    body: JSON.stringify({
      requestId: credentials.token(),
      lines: [{ productId: 'nc1', quantity: 1, expectedPriceCents: 7990 }],
      customer: {
        name: 'Cliente Demo',
        email: 'account@example.com',
        address: 'Calle de Prueba 1',
      },
    }),
  });
  assert.equal(purchase.status, 201);
  const pw = credentials.token();
  const send = (path: string, headers: Record<string, string>, body: unknown) =>
    fetch(url + path, { method: 'POST', headers, body: JSON.stringify(body) });
  const registered = await send('/api/shop/register', guestHeaders, {
    name: 'Cliente Demo',
    email: 'account@example.com',
    password: pw,
  });
  assert.equal(registered.status, 200);
  const account = await registered.json();
  assert.equal(account.account.email, 'account@example.com');
  const headers = {
    ...guestHeaders,
    Cookie: registered.headers.get('set-cookie')!.split(';')[0]!,
    'X-CSRF-Token': account.csrf,
  };
  assert.notEqual(headers.Cookie, guestHeaders.Cookie);
  assert.equal((await fetch(url + '/api/workspace', { headers })).status, 401);
  assert.equal((await send('/api/shop/orders', guestHeaders, {})).status, 401);
  const own = await (await fetch(url + '/api/shop', { headers })).json();
  assert.equal(own.orders.length, 1);

  assert.equal(
    (await send('/api/shop/address', guestHeaders, { address: 'Calle ajena 1' })).status,
    401,
  );
  assert.equal(
    (
      await send(
        '/api/shop/address',
        { ...headers, 'X-CSRF-Token': '' },
        { address: 'Calle cliente 1' },
      )
    ).status,
    403,
  );
  assert.equal(
    (await send('/api/shop/address', headers, { address: 'Calle cliente 22' })).status,
    200,
  );
  const updatedProfile = await (await fetch(url + '/api/shop', { headers })).json();
  assert.equal(updatedProfile.account.address, 'Calle cliente 22');
  const logout = await send('/api/shop/logout', headers, {});
  assert.equal(logout.status, 200);
  const loggedOut = await logout.json(),
    guestAgain = {
      ...headers,
      Cookie: logout.headers.get('set-cookie')!.split(';')[0]!,
      'X-CSRF-Token': loggedOut.csrf,
    };
  const empty = await (await fetch(url + '/api/shop', { headers: guestAgain })).json();
  assert.equal(empty.orders.length, 0);
  assert.equal(
    (
      await send('/api/shop/login', guestAgain, {
        email: 'account@example.com',
        password: 'incorrecta',
      })
    ).status,
    401,
  );
  const login = await send('/api/shop/login', guestAgain, {
    email: 'account@example.com',
    password: pw,
  });
  assert.equal(login.status, 200);
  const restored = await (
    await fetch(url + '/api/shop', {
      headers: { Cookie: login.headers.get('set-cookie')!.split(';')[0]! },
    })
  ).json();
  assert.equal(restored.orders.length, 1);
  assert.equal(restored.account.name, 'Cliente Demo');
  assert.ok(!JSON.stringify(restored).includes('passwordHash'));
});

test('proveedores HTTP: lectura interna, permisos y ficha seleccionable en workspace', async (t) => {
  const { url, login } = await web(t),
    headers = await authorized(await login(), url),
    viewer = await authorized(await login('lucia'), url);
  assert.equal((await fetch(url + '/api/suppliers')).status, 401);
  const body = {
    name: 'Proveedor HTTP de prueba',
    email: 'demo@example.com',
    phone: '',
    active: true,
  };
  const send = (h: Record<string, string>) =>
    fetch(url + '/api/suppliers', { method: 'POST', headers: h, body: JSON.stringify(body) });
  assert.equal((await send(viewer)).status, 403);
  assert.equal((await send({ ...headers, 'X-CSRF-Token': '' })).status, 403);
  const response = await send(headers);
  assert.equal(response.status, 200);
  const supplier = await response.json();
  const workspace = await (await fetch(url + '/api/workspace', { headers })).json();
  assert.ok(workspace.suppliers.some((entry: { id: string }) => entry.id === supplier.id));
});
