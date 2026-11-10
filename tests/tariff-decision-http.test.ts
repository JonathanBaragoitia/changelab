import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { CommercialAI } from '../src/application/shopping-assistance.ts';
import { Store } from '../src/infrastructure/store.ts';
import { SupplierOfferStore } from '../src/infrastructure/supplier-offer-store.ts';
import { TariffStore } from '../src/infrastructure/tariff-store.ts';
import { makeServer } from '../src/server.ts';
import { sessions } from './auth-fixture.ts';

test('HTTP: decisión de tarifa autorizada, vinculada al digest y sin aplicar precios', async (t) => {
  const store = new Store(':memory:');
  let modelCalls = 0;
  let pauseModel: (() => Promise<void>) | undefined;
  const unexpected = async () => {
    throw new Error('Unexpected model operation');
  };
  const ai: CommercialAI = {
    select: unexpected,
    draft: unexpected,
    extract: unexpected,
    classify: unexpected,
    async explainTariff(options) {
      modelCalls++;
      await pauseModel?.();
      return { code: options[0]?.code };
    },
  };
  const server = makeServer(store, undefined, undefined, ai);
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
  const businessRole = store.db.prepare('INSERT INTO user_business_roles VALUES(?,?)');
  businessRole.run('elena', 'office');
  businessRole.run('marcos', 'owner');
  const request = async (
    path: string,
    status: number,
    headers?: Record<string, string>,
    body?: unknown,
  ) => {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      ...(headers ? { headers } : {}),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    assert.equal(response.status, status, JSON.stringify(value));
    return value;
  };
  const batch = await request('/api/tariffs', 201, staff('elena'), {
    supplierId: 'demo-lavado',
    reference: 'DECISION-HTTP',
    reason: 'Tarifa de prueba del proveedor',
    csv: 'sku;coste\nNA-001;52,50',
    target: 'supplier-offer',
  });
  const path = `/api/tariffs/${batch.id}/decision`;
  const body = { digest: batch.digest };
  const products = store.products();
  const offerStore = new SupplierOfferStore(store);
  const offers = offerStore.all();
  const tariffStore = new TariffStore(store);
  await request(path, 401, { Origin: base, 'Content-Type': 'application/json' }, body);
  await request(path, 403, { ...staff('elena'), 'X-CSRF-Token': '0'.repeat(64) }, body);
  await request(path, 403, staff('lucia'), body);
  store.db.prepare('INSERT INTO user_operational_profiles VALUES(?,?)').run('lucia', 'warehouse');
  await request(path, 403, staff('lucia'), body);
  await request('/api/tariffs', 403, staff('lucia'));
  assert.equal(
    (await request(path, 409, staff('elena'), { digest: 'wrong' })).error,
    'TARIFF_DIGEST',
  );
  await request(path, 409, staff('elena'), { ...body, priceCents: 100 });
  assert.equal(tariffStore.decision(batch.id), undefined);
  assert.equal(modelCalls, 0);

  const decision = await request(path, 201, staff('elena'), body);
  assert.equal(decision.tariffId, batch.id);
  assert.equal(decision.createdBy, 'elena');
  assert.deepEqual(tariffStore.decision(batch.id), decision);
  assert.deepEqual(await request(path, 200, staff('marcos'), body), decision);
  assert.deepEqual((await request('/api/tariffs', 200, staff('marcos'))).decisions, [
    { ...decision, stale: false },
  ]);
  assert.equal(modelCalls, 1);
  assert.equal(
    store.audit().filter((event) => event.action === 'tariff.decision-prepared').length,
    1,
  );
  assert.deepEqual(store.products(), products);
  assert.deepEqual(offerStore.all(), offers);
  assert.deepEqual(tariffStore.batch(batch.id), batch);

  store.db
    .prepare('UPDATE products SET priceCents=priceCents+100, version=version+1 WHERE id=?')
    .run('nc1');
  assert.deepEqual((await request('/api/tariffs', 200, staff('elena'))).decisions, [
    { ...decision, stale: true },
  ]);
  let markStarted!: () => void;
  let resumeModel!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const resumed = new Promise<void>((resolve) => {
    resumeModel = resolve;
  });
  pauseModel = () => {
    markStarted();
    return resumed;
  };
  const pending = request(path, 409, staff('elena'), body);
  try {
    await Promise.race([started, pending]);
    assert.equal(
      (await request(path, 409, staff('marcos'), body)).error,
      'TARIFF_DECISION_PENDING',
    );
    store.db
      .prepare('UPDATE products SET priceCents=priceCents+100, version=version+1 WHERE id=?')
      .run('nc1');
  } finally {
    pauseModel = undefined;
    resumeModel();
  }
  assert.equal((await pending).error, 'TARIFF_CHANGED');
  assert.deepEqual(tariffStore.decision(batch.id), decision);
  assert.equal(
    store.audit().filter((event) => event.action === 'tariff.decision-prepared').length,
    1,
  );
  const changedProducts = store.products();
  const refreshed = await request(path, 201, staff('marcos'), body);
  assert.notEqual(refreshed.fingerprint, decision.fingerprint);
  assert.equal(refreshed.createdBy, 'marcos');
  assert.deepEqual((await request('/api/tariffs', 200, staff('elena'))).decisions, [
    { ...refreshed, stale: false },
  ]);
  assert.deepEqual(store.products(), changedProducts);
  assert.deepEqual(offerStore.all(), offers);
});
