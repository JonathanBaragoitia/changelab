import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { Store, sha } from '../src/infrastructure/store.ts';
import { CommerceStore } from '../src/infrastructure/commerce-store.ts';
import { SupplierOfferStore } from '../src/infrastructure/supplier-offer-store.ts';
import { TariffStore } from '../src/infrastructure/tariff-store.ts';
import { ManageTariffs } from '../src/application/tariffs.ts';
import { extractTariffRows } from '../src/application/tariff-extraction.ts';
import { makeServer } from '../src/server.ts';
import { sessions } from './auth-fixture.ts';
test('tarifa de proveedor con origen conserva venta/catálogo y exige revisión independiente', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  new CommerceStore(store);
  const offers = new SupplierOfferStore(store),
    repo = new TariffStore(store),
    service = new ManageTariffs(repo, sha, randomUUID);
  const editor = { id: 'editor', role: 'editor' },
    reviewer = { id: 'reviewer', role: 'reviewer' },
    original = Buffer.from('sku;coste\nNA-001;52,50');
  const source = {
    id: randomUUID(),
    filename: 'correo.csv',
    format: 'text',
    origin: 'Adjunto ficticio',
    uploadedBy: editor.id,
    uploadedAt: new Date().toISOString(),
    sha256: createHash('sha256').update(original).digest('hex'),
    text: original.toString(),
    modelUsed: false,
  };
  repo.saveSource(source, original);
  const before = store.products();
  const batch = service.preview(editor, {
    supplierId: 'demo-lavado',
    reference: 'DOC-01',
    reason: 'Actualización comunicada por el proveedor',
    csv: original.toString(),
    target: 'supplier-offer',
    sourceId: source.id,
  });
  assert.equal(offers.get('demo-lavado', 'nc1')?.costCents, 4900);
  assert.throws(() =>
    service.apply({ ...editor, role: 'reviewer' }, batch.id, { digest: batch.digest }),
  );
  service.apply(reviewer, batch.id, { digest: batch.digest });
  assert.equal(offers.get('demo-lavado', 'nc1')?.costCents, 5250);
  assert.deepEqual(store.products(), before);
  assert.equal(repo.batch(batch.id)?.source?.sha256, source.sha256);
  assert.equal(repo.batch(batch.id)?.appliedBy, reviewer.id);
  assert.equal(repo.offerHistory()[0]?.reason, 'Actualización comunicada por el proveedor');
  service.apply(reviewer, batch.id, { digest: batch.digest });
  assert.equal(offers.get('demo-lavado', 'nc1')?.version, 2);
  store.db
    .prepare('UPDATE tariff_sources SET original=? WHERE id=?')
    .run(Buffer.from('tampered'), source.id);
  assert.throws(() => service.apply(reviewer, batch.id, { digest: batch.digest }));
});
test('extracción estricta: no omite filas erróneas ni admite importes inventados', async () => {
  assert.equal(
    (await extractTariffRows('Correo ficticio\nPrecios netos sin IVA\nsku;coste\nNA-001;52,50'))
      .rows[0]?.costCents,
    5250,
  );
  await assert.rejects(extractTariffRows('sku;coste\nNA-001;52,50\nNA-002;ERROR'));
  const evidence = 'NA-001;2;5,00;10,00';
  const source = 'SKU;Cantidad;Coste unitario neto;Total\n' + evidence;
  const model = (costCents: number) => async () => ({
    rows: [{ sku: 'NA-001', costCents, quantity: 2, evidence }],
  });
  assert.deepEqual(await extractTariffRows(source, model(500)), {
    rows: [{ sku: 'NA-001', costCents: 500 }],
    modelUsed: true,
  });
  await assert.rejects(extractTariffRows(source, model(1000)), { code: 'TARIFF_AMBIGUOUS' });
  await assert.rejects(
    extractTariffRows('Correo, precio desconocido', async () => ({
      rows: [{ sku: 'NA-001', costCents: 5250, quantity: null, evidence: 'NA-001 52,50' }],
    })),
  );
});
test('HTTP: documento PDF, sesión/CSRF, origen descargable y aplicación con revisor', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const offline = async () => {
    throw new Error('Ollama no disponible');
  };
  const server = makeServer(store, undefined, undefined, {
    select: offline,
    draft: offline,
    extract: offline,
    classify: offline,
    explainTariff: offline,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port,
    headers = sessions(store, base);
  const original = readFileSync(new URL('./fixtures/tariff-bruma.pdf', import.meta.url));
  const body = {
    supplierId: 'demo-lavado',
    reference: 'PDF-HTTP-01',
    format: 'pdf',
    source: original.toString('base64'),
    filename: 'proveedor.pdf',
    origin: 'Correo ficticio de proveedor',
    useAI: false,
  };
  const post = async (path: string, body: unknown, who = 'elena', status = 200) => {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: headers(who),
      body: JSON.stringify(body),
    });
    const value = await response.json();
    assert.equal(response.status, status, JSON.stringify(value));
    return value;
  };
  await post('/api/tariff-documents', body, 'lucia', 403);
  const batch = await post('/api/tariff-documents', body, 'elena', 201);
  assert.equal(batch.status, 'ready');
  assert.equal(batch.changes.length, 3);
  assert.equal((await post('/api/tariff-documents', body)).id, batch.id);
  assert.equal((await fetch(base + '/api/tariff-sources/' + batch.source.id)).status, 401);
  const download = await fetch(base + '/api/tariff-sources/' + batch.source.id, {
    headers: headers('marcos'),
  });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), original);
  const decisionPath = '/api/tariffs/' + batch.id + '/decision';
  const decision = await post(decisionPath, { digest: batch.digest }, 'elena', 201);
  assert.equal(decision.report.summary.modelUsed, false);
  assert.equal(decision.report.source.sourceId, batch.source.id);
  assert.equal(decision.report.source.sourceSha256, batch.source.sha256);
  const products = store.products();
  await post('/api/tariffs/' + batch.id + '/apply', { digest: batch.digest }, 'elena', 403);
  await post('/api/tariffs/' + batch.id + '/apply', { digest: batch.digest }, 'marcos');
  assert.deepEqual(store.products(), products);
  assert.equal(
    store.db
      .prepare('SELECT costCents FROM supplier_offers WHERE supplierId=? AND productId=?')
      .get('demo-lavado', 'nc1')?.costCents,
    5250,
  );
  const reviewed = { ...body, reference: 'PDF-COTEJADO', reviewedCsv: 'sku;coste\nNA-001;54,10' };
  await post('/api/tariff-documents', reviewed, 'elena', 400);
  const revised = await post(
    '/api/tariff-documents',
    { ...reviewed, confirmReviewed: true },
    'elena',
    201,
  );
  assert.equal(revised.source.reviewedManually, true);
  assert.equal(revised.source.sha256, batch.source.sha256);
  assert.equal(revised.changes[0].afterCostCents, 5410);
  await post(
    '/api/tariff-documents',
    { ...reviewed, confirmReviewed: true, reviewedCsv: 'sku;coste\nNA-001;59,10' },
    'elena',
    409,
  );
});
