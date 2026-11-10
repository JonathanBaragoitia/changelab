import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync, existsSync } from 'node:fs';
import { Store } from '../src/infrastructure/store.ts';
import { BusinessRunStore } from '../src/infrastructure/business-run-store.ts';
import { TrackBusinessRanking } from '../src/application/business-runs.ts';
import { businessContext } from '../src/application/business.ts';
import { makeServer } from '../src/server.ts';
import { sessions } from './auth-fixture.ts';

function snapshot(store: Store) {
  return {
    contextHash: 'snapshot-v1',
    context: businessContext(
      store.products(),
      store.products().map((p) => ({ productId: p.id, quantity: 20 })),
      [],
      '2026-10-01',
      '2026-10-28',
    ),
  };
}
test('historial conserva éxito al reabrir, contexto y orden sin alterar catálogo ni pedidos', async (t) => {
  const path = join(tmpdir(), 'changelab-runs-' + randomUUID() + '.sqlite');
  let store = new Store(path);
  t.after(() => {
    store.close();
    for (const file of [path, path + '-wal', path + '-shm']) if (existsSync(file)) unlinkSync(file);
  });
  const repo = new BusinessRunStore(store),
    service = new TrackBusinessRanking(repo),
    snap = snapshot(store);
  const before = store.products(),
    orders = store.orders(),
    audit = store.audit(),
    id = snap.context.opportunities[0]!.id;
  const result = await service.execute(
    'editor',
    snap,
    { model: 'test-local', rank: async () => ({ ids: [id] }) },
    () => snap.contextHash,
  );
  assert.equal(result.modelUsed, true);
  const run = repo.latest()[0]!;
  assert.equal(run.status, 'accepted');
  assert.equal(run.model, 'test-local');
  assert.deepEqual(run.context, snap.context);
  assert.deepEqual(run.ids, [id]);
  assert.ok(run.durationMs! >= 0);
  assert.deepEqual(store.products(), before);
  assert.deepEqual(store.orders(), orders);
  assert.deepEqual(store.audit(), audit);
  store.close();
  store = new Store(path);
  assert.equal(new BusinessRunStore(store).latest()[0]!.id, result.runId);
});
test('respuestas inválidas, proveedor caído y datos cambiados dejan registro seguro', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const repo = new BusinessRunStore(store),
    service = new TrackBusinessRanking(repo),
    snap = snapshot(store);
  for (const item of [
    {
      rank: async () => ({ ids: ['inventado'], secret: 'private' }),
      hash: () => snap.contextHash,
      status: 'rejected',
      code: 'INVALID_RANKING',
    },
    {
      rank: async () => {
        throw Error('secret credential');
      },
      hash: () => snap.contextHash,
      status: 'failed',
      code: 'BUSINESS_MODEL_FAILED',
    },
    {
      rank: async () => ({ ids: [snap.context.opportunities[0]!.id] }),
      hash: () => 'changed',
      status: 'stale',
      code: 'CONTEXT_CHANGED',
    },
  ]) {
    await assert.rejects(service.execute('editor', snap, { rank: item.rank }, item.hash));
    const run = repo.latest()[0]!;
    assert.equal(run.status, item.status);
    assert.equal(run.errorCode, item.code);
    assert.deepEqual(run.ids, []);
    assert.ok(!JSON.stringify(run).includes('secret'));
  }
});
test('fallo al iniciar no invoca modelo, y fallo al guardar impide devolver éxito', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const repo = new BusinessRunStore(store),
    snap = snapshot(store);
  let calls = 0;
  const ranker = {
    rank: async () => {
      calls++;
      return { ids: [] };
    },
  };
  await assert.rejects(
    new TrackBusinessRanking({
      start: () => {
        throw Error('disk');
      },
      finish: () => {},
      latest: () => [],
    }).execute('e', snap, ranker, () => snap.contextHash),
  );
  assert.equal(calls, 0);
  await assert.rejects(
    new TrackBusinessRanking({
      start: (r) => repo.start(r),
      finish: () => {
        throw Error('disk');
      },
      latest: () => repo.latest(),
    }).execute('e', snap, ranker, () => snap.contextHash),
  );
  assert.equal(repo.latest()[0]!.status, 'running');
});
test('sin señales registra omisión; historial limita a veinte ejecuciones', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const repo = new BusinessRunStore(store),
    service = new TrackBusinessRanking(repo);
  const snap = {
    contextHash: 'none',
    context: businessContext([], [], [], '2026-10-01', '2026-10-28'),
  };
  let calls = 0;
  for (let i = 0; i < 22; i++)
    await service.execute(
      'e',
      snap,
      {
        rank: async () => {
          calls++;
          return {};
        },
      },
      () => snap.contextHash,
    );
  assert.equal(calls, 0);
  assert.equal(repo.latest().length, 20);
  assert.ok(repo.latest().every((r) => r.status === 'skipped'));
});
test('historial HTTP requiere sesión interna y publica ejecución del mismo análisis', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const server = makeServer(store, undefined, {
    model: 'http-double',
    rank: async (input) => ({ ids: input.opportunities.slice(0, 2).map((o) => o.id) }),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const base = 'http://127.0.0.1:' + addr.port,
    headers = sessions(store, base);
  assert.equal((await fetch(base + '/api/business-runs')).status, 401);
  const snap = await (
    await fetch(base + '/api/business-context', { headers: headers('elena') })
  ).json();
  const response = await fetch(base + '/api/business-priorities', {
    method: 'POST',
    headers: headers('elena'),
    body: JSON.stringify({ contextHash: snap.contextHash }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  const history = await (
    await fetch(base + '/api/business-runs', { headers: headers('lucia') })
  ).json();
  assert.equal(history.runs[0].id, result.runId);
  assert.equal(history.runs[0].status, 'accepted');
});
