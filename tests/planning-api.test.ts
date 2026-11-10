import { sessions } from './auth-fixture.ts';
import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Store } from '../src/infrastructure/store.ts';
import { makeServer } from '../src/server.ts';
import type { PlanGenerator } from '../src/application/planning.ts';

async function fixture(t: TestContext, generator: PlanGenerator) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const server = makeServer(store, {
    ...generator,
    async status() {
      return { provider: 'test', model: 'double', available: true, message: 'Doble de prueba' };
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const headersFor = sessions(store, 'http://127.0.0.1:' + address.port);
  const send = (instruction: unknown, actor = 'elena') =>
    fetch('http://127.0.0.1:' + address.port + '/api/plans', {
      method: 'POST',
      headers: headersFor(actor),
      body: JSON.stringify({ instruction }),
    });
  return { store, send };
}
const valid = {
  kind: 'plan',
  plan: { category: 'Lavado exterior', basisPoints: 500 },
  explanation: 'Subida',
};

test('API prepara para editora sin persistir; roles de lectura y revisión no invocan el modelo', async (t) => {
  let calls = 0;
  const { store, send } = await fixture(t, {
    async generate() {
      calls++;
      return valid;
    },
  });
  const before = store.products(),
    audit = store.audit();
  for (const actor of ['lucia', 'marcos']) assert.equal((await send('Cambio', actor)).status, 403);
  assert.equal(calls, 0);
  const response = await send('Sube Lavado exterior un 5 %');
  assert.equal(response.status, 200);
  const body: unknown = await response.json();
  assert.ok(body && typeof body === 'object' && 'status' in body);
  assert.equal(body.status, 'ready');
  assert.equal(calls, 1);
  assert.equal(store.proposals().length, 0);
  assert.deepEqual(store.products(), before);
  assert.deepEqual(store.audit(), audit);
});

test('API limita generaciones concurrentes y libera el bloqueo al terminar', async (t) => {
  let release: (value: unknown) => void = () => {};
  let started: () => void = () => {};
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const waiting = new Promise<unknown>((resolve) => {
    release = resolve;
  });
  const { send } = await fixture(t, {
    async generate() {
      started();
      return waiting;
    },
  });
  const first = send('Sube Lavado exterior un 5 %');
  await entered;
  assert.equal((await send('Otro cambio')).status, 429);
  release(valid);
  assert.equal((await first).status, 200);
  assert.equal((await send('Nueva petición')).status, 200);
});

test('API no escribe ante respuestas inválidas, aclaración, rechazo ni errores del proveedor', async (t) => {
  let result: unknown = {
    kind: 'plan',
    plan: { category: 'Lavado exterior', basisPoints: 500 },
    explanation: 'x',
    sql: 'DROP TABLE products',
  };
  const { send, store } = await fixture(t, {
    async generate() {
      if (result instanceof Error) throw result;
      return result;
    },
  });
  assert.equal((await send('Cambio')).status, 502);
  result = { kind: 'clarification', question: '¿Qué categoría?' };
  assert.equal((await send('Cambio')).status, 200);
  result = { kind: 'refusal', reason: 'No se borran pedidos' };
  assert.equal((await send('Cambio')).status, 200);
  result = new Error('private error');
  assert.equal((await send('Cambio')).status, 502);
  result = valid;
  assert.equal((await send('Cambio')).status, 200);
  assert.equal(store.proposals().length, 0);
});
