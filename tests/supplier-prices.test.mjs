import test from 'node:test';
import assert from 'node:assert/strict';
import { supplierPriceRows } from '../public/supplier-prices.js';
test('precio vigente se compara con su versión aplicada, nunca con la tarifa pendiente', () => {
  const offers = [{ supplierId: 'a', productId: 'p', costCents: 5250, version: 2 }];
  const history = [
    {
      supplierId: 'a',
      productId: 'p',
      beforeCostCents: 4900,
      afterCostCents: 5250,
      version: 2,
      at: '2026-11-02T10:00:00Z',
    },
  ];
  const pending = [
    {
      target: 'supplier-offer',
      supplierId: 'a',
      status: 'ready',
      changes: [{ productId: 'p', afterCostCents: 6000 }],
    },
  ];
  const [row] = supplierPriceRows('a', offers, history, pending);
  assert.equal(row.offer.costCents, 5250);
  assert.equal(row.last.beforeCostCents, 4900);
  assert.equal(row.pending.length, 1);
});
test('un precio fuera del historial no se presenta con una fecha o diferencia anterior', () => {
  const offers = [{ supplierId: 'a', productId: 'p', costCents: 5300, version: 3 }];
  const history = [
    {
      supplierId: 'a',
      productId: 'p',
      beforeCostCents: 4900,
      afterCostCents: 5250,
      version: 2,
      at: '2026-11-02T10:00:00Z',
    },
  ];
  const [row] = supplierPriceRows('a', offers, history, []);
  assert.equal(row.last, null);
  assert.equal(row.changes.length, 1);
});
