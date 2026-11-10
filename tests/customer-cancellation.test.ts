import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/infrastructure/store.ts';
import { makeServer } from '../src/server.ts';
import { sessions } from './auth-fixture.ts';
test('cliente cancela solo sus pedidos, con CSRF y devolución única de stock; envío bloquea cancelación', async (t) => {
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
  const guest = async () => {
    const response = await fetch(base + '/api/shop');
    const data = await response.json();
    return {
      'Content-Type': 'application/json',
      Origin: base,
      Cookie: response.headers.get('set-cookie')!.split(';')[0]!,
      'X-CSRF-Token': data.csrf,
    };
  };
  const a = await guest(),
    b = await guest();
  const post = async (
    path: string,
    body: unknown,
    headers: Record<string, string> = a,
    status = 200,
  ) => {
    const response = await fetch(base + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  };
  const buy = () =>
    post(
      '/api/shop/orders',
      {
        requestId: randomUUID(),
        lines: [{ productId: 'nc1', quantity: 1, expectedPriceCents: 7990 }],
        customer: {
          name: 'Cliente ficticio',
          email: 'test@example.com',
          address: 'Calle ficticia 123',
        },
      },
      a,
      201,
    );
  const sale = await buy(),
    path = '/api/shop/orders/' + sale.id + '/cancel';
  await post(path, { expectedStatus: 'confirmed' }, b, 404);
  const noCsrf = { ...a };
  delete noCsrf['X-CSRF-Token'];
  await post(path, { expectedStatus: 'confirmed' }, noCsrf, 403);
  assert.equal((await post(path, { expectedStatus: 'confirmed' })).status, 'cancelled');
  await post(path, { expectedStatus: 'confirmed' });
  assert.equal(
    store.db.prepare('SELECT quantity FROM inventory WHERE productId=?').get('nc1')?.quantity,
    20,
  );
  const next = await buy();
  await post(
    '/api/orders/' + next.id + '/status',
    { status: 'prepared', expectedStatus: 'confirmed' },
    staff('elena'),
  );
  await post('/api/shop/orders/' + next.id + '/cancel', { expectedStatus: 'confirmed' }, a, 409);
  await post(
    '/api/orders/' + next.id + '/status',
    {
      status: 'dispatch_ready',
      expectedStatus: 'prepared',
      carrier: 'Transportista',
      reference: 'EXP-2',
    },
    staff('elena'),
  );
  await post(
    '/api/orders/' + next.id + '/status',
    { status: 'shipped', expectedStatus: 'prepared' },
    staff('elena'),
  );
  await post('/api/shop/orders/' + next.id + '/cancel', { expectedStatus: 'prepared' }, a, 409);
  assert.equal(
    store.db.prepare('SELECT quantity FROM inventory WHERE productId=?').get('nc1')?.quantity,
    19,
  );
});
