import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Store, sha } from '../src/infrastructure/store.ts';
import { SupplierStore } from '../src/infrastructure/supplier-store.ts';
import { TariffStore } from '../src/infrastructure/tariff-store.ts';
import { ManageTariffs } from '../src/application/tariffs.ts';
import { parseTariffCsv } from '../src/domain/tariff-csv.ts';
import { compareCampaigns } from '../src/application/campaigns.ts';
import { ProposalService, actorFor } from '../src/application/proposals.ts';
import { makeServer } from '../src/server.ts';
import { sessions } from './auth-fixture.ts';
const editor = actorFor('elena'),
  reviewer = actorFor('marcos');
function fixture(t: { after: (fn: () => void) => void }) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const suppliers = new SupplierStore(store);
  suppliers.saveSupplier({
    id: 'supplier',
    name: 'Proveedor Demo',
    email: 'demo@example.com',
    phone: '',
    active: 1,
    version: 1,
  });
  const repo = new TariffStore(store),
    service = new ManageTariffs(repo, sha, randomUUID);
  return { store, repo, service };
}
const tariff = {
  supplierId: 'supplier',
  reference: 'TARIFA-TEST',
  csv: 'sku;coste\nNA-001;55,00\nNA-002;27,00',
};
test('CSV admite BOM, comillas y separadores; rechaza duplicados, fórmulas e importes ambiguos', () => {
  assert.deepEqual(parseTariffCsv('\uFEFFsku;coste\r\nNA-001;55,10'), [
    { sku: 'NA-001', costCents: 5510 },
  ]);
  assert.deepEqual(parseTariffCsv('sku,coste\n"NA-001","55,10"'), [
    { sku: 'NA-001', costCents: 5510 },
  ]);
  for (const input of [
    'sku;coste\nNA-001;0',
    'sku;coste\nNA-001;1.000,00',
    'sku;coste\nNA-001;1e2',
    'sku;coste\nNA-001;2\nna-001;3',
    'sku;coste\n=SUM;2',
    'sku;coste\n"NA-001;2',
    'sku;coste\nNA-001;2;extra',
    'sku;coste\nNA-001;-1',
    'otro;coste\nNA-001;1',
  ])
    assert.throws(() => parseTariffCsv(input));
});
test('tarifa prepara sin tocar catálogo, publica costes/versiones con otra cuenta y no cambia pedidos/precios', (t) => {
  const { store, service } = fixture(t),
    before = store.products(),
    orders = store.orders();
  const batch = service.preview(editor, tariff);
  assert.equal(batch.status, 'ready');
  assert.deepEqual(store.products(), before);
  assert.deepEqual(service.preview(editor, tariff), batch);
  assert.throws(() => service.apply(editor, batch.id, { digest: batch.digest }));
  assert.throws(() =>
    service.apply({ ...editor, role: 'reviewer' }, batch.id, { digest: batch.digest }),
  );
  const applied = service.apply(reviewer, batch.id, { digest: batch.digest }),
    audit = store.audit();
  assert.equal(applied.status, 'applied');
  assert.deepEqual(service.apply(reviewer, batch.id, { digest: batch.digest }), applied);
  assert.deepEqual(store.audit(), audit);
  assert.equal(store.products()[0]!.costCents, 5500);
  assert.equal(store.products()[0]!.version, before[0]!.version + 1);
  assert.deepEqual(
    store.products().map((p) => p.priceCents),
    before.map((p) => p.priceCents),
  );
  assert.deepEqual(store.orders(), orders);
});
test('tarifa bloquea SKU desconocido, detecta versiones/digest alterados y revierte cambios parciales', (t) => {
  const { store, repo, service } = fixture(t);
  const blocked = service.preview(editor, {
    ...tariff,
    reference: 'NEW',
    csv: 'sku;coste\nNA-001;55\nNEW-001;10',
  });
  assert.equal(blocked.status, 'blocked');
  assert.throws(() => service.apply(reviewer, blocked.id, { digest: blocked.digest }));
  const batch = service.preview(editor, tariff),
    before = store.products();
  store.db.prepare('UPDATE products SET version=version+1 WHERE sku=?').run('NA-002');
  assert.throws(() => service.apply(reviewer, batch.id, { digest: batch.digest }));
  assert.equal(store.products()[0]!.costCents, before[0]!.costCents);
  const fresh = service.preview(editor, { ...tariff, reference: 'FRESH' });
  repo.record = () => {
    throw Error('disk');
  };
  assert.throws(() => service.apply(reviewer, fresh.id, { digest: fresh.digest }));
  assert.equal(store.products()[0]!.costCents, before[0]!.costCents);
  const altered = { ...fresh, changes: fresh.changes.map((c) => ({ ...c, afterCostCents: 1 })) };
  repo.save(altered);
  assert.throws(() => service.apply(reviewer, fresh.id, { digest: fresh.digest }));
});
test('coste actualizado invalida propuesta de precio anterior', (t) => {
  const { store, service } = fixture(t),
    proposals = new ProposalService(
      store,
      { hash: sha },
      { now: () => new Date().toISOString() },
      { next: randomUUID },
    );
  const p = proposals.create(editor, {
    instruction: 'Subida de prueba antes de importar',
    plan: { category: 'Lavado exterior', basisPoints: 500 },
  });
  const batch = service.preview(editor, tariff);
  service.apply(reviewer, batch.id, { digest: batch.digest });
  assert.throws(() => proposals.publish(reviewer, p.id, p.digest));
});
const products = [
  {
    id: 'p',
    sku: 'P1',
    name: 'Producto',
    category: 'Interior',
    priceCents: 1000,
    costCents: 500,
    version: 1,
  },
];
const campaign = {
  title: 'Campaña de prueba',
  category: 'Interior',
  from: '2026-11-01',
  to: '2026-11-07',
  alternatives: [-1000, -5000],
  quantities: [{ productId: 'p', quantity: 10 }],
};
test('campaña compara contribución y unidades enteras, mantiene alternativas bloqueadas y no altera datos', () => {
  const before = JSON.stringify(products),
    r = compareCampaigns(products, campaign, sha);
  assert.equal(r.alternatives[0]!.totals.beforeContributionCents, 5000);
  assert.equal(r.alternatives[0]!.totals.afterContributionCents, 4000);
  assert.equal(r.alternatives[0]!.rows[0]!.unitsToMaintainGross, 13);
  assert.ok(r.alternatives[1]!.findings.length);
  assert.equal(r.alternatives[1]!.rows[0]!.unitsToMaintainGross, null);
  assert.equal(JSON.stringify(products), before);
});
test('campaña rechaza cantidades/precios/fechas ambiguos y alternativas repetidas', () => {
  for (const patch of [
    { from: '2026-02-30' },
    { to: '2026-01-01' },
    { alternatives: [0] },
    { alternatives: [6000] },
    { alternatives: [100, 100] },
    { quantities: [{ productId: 'p', quantity: -1 }] },
    { quantities: [{ productId: 'inventado', quantity: 10 }] },
  ])
    assert.throws(() => compareCampaigns(products, { ...campaign, ...patch }, sha));
});
test('HTTP aplica roles, revisión de tarifa y contexto de campaña vigente', async (t) => {
  const { store } = fixture(t),
    server = makeServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const a = server.address();
  assert.ok(a && typeof a !== 'string');
  const base = 'http://127.0.0.1:' + a.port,
    headers = sessions(store, base);
  const send = (path: string, body: unknown, actor = 'elena') =>
    fetch(base + path, { method: 'POST', headers: headers(actor), body: JSON.stringify(body) });
  assert.equal((await send('/api/tariffs', tariff, 'lucia')).status, 403);
  const response = await send('/api/tariffs', tariff);
  assert.equal(response.status, 201);
  const batch = await response.json();
  assert.equal(
    (await send('/api/tariffs/' + batch.id + '/apply', { digest: batch.digest })).status,
    403,
  );
  assert.equal(
    (await send('/api/tariffs/' + batch.id + '/apply', { digest: batch.digest }, 'marcos')).status,
    200,
  );
  const selected = store.products().filter((p) => p.category === 'Interior');
  const input = {
    ...campaign,
    alternatives: [500],
    quantities: selected.map((p) => ({ productId: p.id, quantity: 10 })),
  };
  const comparison = await send('/api/campaigns/compare', input, 'lucia');
  assert.equal(comparison.status, 200);
  const result = await comparison.json();
  const proposal = {
    campaign: input,
    index: 0,
    contextHash: result.contextHash,
    reason: 'Revisar alternativa de campaña',
  };
  assert.equal((await send('/api/campaigns/proposal', proposal, 'lucia')).status, 403);
  assert.equal((await send('/api/campaigns/proposal', proposal)).status, 201);
  store.db.prepare('UPDATE products SET version=version+1 WHERE id=?').run(selected[0]!.id);
  assert.equal((await send('/api/campaigns/proposal', proposal)).status, 409);
});
test('tarifa revalida filas sin cambio y proveedor activo antes de aplicar', (t) => {
  const { store, service } = fixture(t);
  const batch = service.preview(editor, { ...tariff, csv: 'sku;coste\nNA-001;55\nNA-002;25' });
  store.db
    .prepare('UPDATE products SET costCents=2600,version=version+1 WHERE sku=?')
    .run('NA-002');
  assert.throws(() => service.apply(reviewer, batch.id, { digest: batch.digest }));
  assert.equal(store.products()[0]!.costCents, 4900);
  const fresh = service.preview(editor, { ...tariff, reference: 'INACTIVE' });
  store.db.prepare('UPDATE suppliers SET active=0 WHERE id=?').run('supplier');
  assert.throws(() => service.apply(reviewer, fresh.id, { digest: fresh.digest }));
  assert.equal(store.products()[0]!.costCents, 4900);
});
test('coste real bajo margen se informa, no se inventa precio para ocultarlo', (t) => {
  const { store, service } = fixture(t);
  const batch = service.preview(editor, { ...tariff, csv: 'sku;coste\nNA-001;100' });
  service.apply(reviewer, batch.id, { digest: batch.digest });
  assert.equal(store.products()[0]!.priceCents, 7990);
  assert.equal(store.products()[0]!.costCents, 10000);
  const result = compareCampaigns(
    store.products(),
    {
      ...campaign,
      category: 'Lavado exterior',
      alternatives: [500],
      quantities: store
        .products()
        .filter((p) => p.category === 'Lavado exterior')
        .map((p) => ({ productId: p.id, quantity: 10 })),
    },
    sha,
  );
  assert.ok(result.alternatives[0]!.findings.some((f) => f.productId === 'nc1'));
});
