import { sessions } from './auth-fixture.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { Store } from '../src/infrastructure/store.ts';
import { makeServer } from '../src/server.ts';

test('HTTP conserva caracteres UTF-8 partidos entre fragmentos de red', async (t) => {
  const store = new Store(':memory:');
  const server = makeServer(store);
  t.after(() => store.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const headersFor = sessions(store, 'http://127.0.0.1:' + address.port);
  const instruction = 'Revisión de Lavado exterior';
  const body = Buffer.from(
    JSON.stringify({ instruction, plan: { category: 'Lavado exterior', basisPoints: 500 } }),
  );
  const split = body.indexOf(Buffer.from('ó')) + 1;
  assert.ok(split > 0);
  const completed = new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path: '/api/proposals',
        method: 'POST',
        headers: headersFor('elena'),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('error', reject);
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body.subarray(0, split));
    void setImmediate().then(() => req.end(body.subarray(split)));
  });
  const response = await completed;
  assert.equal(response.status, 201);
  assert.ok(response.body && typeof response.body === 'object' && 'instruction' in response.body);
  assert.equal(response.body.instruction, instruction);
});

test('HTTP rechaza cuerpos por encima del límite sin crear propuestas', async (t) => {
  const store = new Store(':memory:');
  const server = makeServer(store);
  t.after(() => store.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const headersFor = sessions(store, 'http://127.0.0.1:' + address.port);
  const response = await fetch('http://127.0.0.1:' + address.port + '/api/proposals', {
    method: 'POST',
    headers: headersFor('elena'),
    body: JSON.stringify({ instruction: 'x'.repeat(17000) }),
  });
  assert.equal(response.status, 413);
  assert.equal(store.proposals().length, 0);
});
