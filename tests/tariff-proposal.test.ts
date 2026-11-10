import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareTariffProposal } from '../src/application/tariff-proposal.ts';
import type { Product } from '../src/domain/catalog.ts';
import type { TariffBatch } from '../src/application/tariffs.ts';

const product: Product = {
  id: 'p1',
  sku: 'SKU-001',
  name: 'Producto',
  category: 'Categoría',
  priceCents: 1001,
  costCents: 400,
  version: 7,
};
const batch: TariffBatch = {
  id: 'tariff-1',
  digest: 'digest',
  supplierId: 'supplier-1',
  supplierName: 'Proveedor',
  reference: 'TAR-001',
  createdBy: 'office',
  createdAt: '2026-11-10T10:00:00Z',
  status: 'ready',
  target: 'supplier-offer',
  rows: [],
  changes: [
    {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      baseVersion: 3,
      priceCents: 950,
      beforeCostCents: 600,
      afterCostCents: 850,
    },
  ],
};

test('proyecta coste de oferta con precio actual, conserva margen al redondear y reutiliza el mínimo', async () => {
  const report = await prepareTariffProposal(batch, [product]);
  const row = report.rows[0]!;
  assert.equal(report.source.tariffId, batch.id);
  assert.equal(report.source.digest, batch.digest);
  assert.equal(row.baseVersion, 3);
  assert.equal(row.productVersion, 7);
  assert.equal(row.referencePriceCents, 1001);
  assert.equal(row.previousMarginBps, 4005);
  assert.equal(row.absorb.marginBps, 1508);
  assert.deepEqual(
    row.absorb.findings.map((finding) => finding.code),
    ['MIN_MARGIN'],
  );
  assert.equal(row.preserve.priceCents, 1419);
  assert.ok(row.preserve.marginBps! >= row.previousMarginBps);
  assert.deepEqual(row.preserve.findings, []);
  assert.equal(report.summary.code, 'ABSORB_BELOW_MINIMUM');
  assert.equal(report.summary.modelUsed, false);
  assert.equal(product.costCents, 400);
});

test('señala tarifa bloqueada, productos ausentes y precio proyectado fuera de rango', async () => {
  const change = batch.changes[0]!;
  const missing = await prepareTariffProposal({ ...batch, status: 'blocked' }, []);
  assert.deepEqual(missing.rows, []);
  assert.deepEqual(
    missing.findings.map((finding) => finding.code),
    ['TARIFF_BLOCKED', 'MISSING_PRODUCT'],
  );
  const extreme = await prepareTariffProposal(
    { ...batch, changes: [{ ...change, beforeCostCents: 1, afterCostCents: 100_000_000 }] },
    [product],
  );
  assert.equal(extreme.rows[0]!.preserve.priceCents, null);
  assert.equal(extreme.rows[0]!.preserve.marginBps, null);
  assert.equal(extreme.rows[0]!.preserve.findings[0]!.code, 'INVALID_PRICE');
});

test('IA selecciona solo un énfasis disponible y nunca controla hechos o cifras', async () => {
  const fallback = await prepareTariffProposal(batch, [product]);
  const valid = await prepareTariffProposal(batch, [product], async (options) => {
    assert.ok(!JSON.stringify(options).includes('Proveedor'));
    return { code: 'COMPARE_SCENARIOS' };
  });
  assert.equal(valid.summary.modelUsed, true);
  assert.equal(valid.summary.code, 'COMPARE_SCENARIOS');
  assert.match(valid.summary.text, /SKU-001.*10,01.*40,05.*14,19/);
  assert.ok(
    valid.findings.some(
      (finding) =>
        finding.code === 'ABSORB_BELOW_MINIMUM' && /SKU-001.*15,08/.test(finding.message),
    ),
  );
  assert.deepEqual(valid.rows, fallback.rows);
  for (const choice of [
    { code: 'REVIEW_REQUIRED' },
    { code: 'COMPARE_SCENARIOS', text: 'aplica ya' },
    'COMPARE_SCENARIOS',
  ]) {
    const invalid = await prepareTariffProposal(batch, [product], async () => choice);
    assert.deepEqual(invalid.summary, fallback.summary);
  }
  const offline = await prepareTariffProposal(batch, [product], async () => {
    throw new Error('offline');
  });
  assert.deepEqual(offline, fallback);
});
