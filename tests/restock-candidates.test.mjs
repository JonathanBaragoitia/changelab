import test from 'node:test';
import assert from 'node:assert/strict';
import { restockCandidates } from '../public/restock-candidates.js';
test('sugerencia descuenta solo unidades pendientes y avisa de propuestas sin aprobar', () => {
  const rows = [
    { productId: 'a', sku: 'A', stock: 2, suggestedOrderUnits: 10, signals: [{ code: 'reorder' }] },
  ];
  const purchases = [
    {
      status: 'partially_received',
      lines: [{ productId: 'a', quantity: 8 }],
      deliveries: [{ lines: [{ productId: 'a', quantity: 3 }] }],
    },
    { status: 'draft', lines: [{ productId: 'a', quantity: 4 }] },
    { status: 'cancelled', lines: [{ productId: 'a', quantity: 100 }] },
  ];
  const [result] = restockCandidates(rows, purchases);
  assert.equal(result.pending, 5);
  assert.equal(result.additional, 5);
  assert.equal(result.draft, 4);
});
test('sin ventas no inventa cantidad y no sugiere valores negativos', () => {
  const rows = [
    {
      productId: 'a',
      sku: 'A',
      stock: 0,
      suggestedOrderUnits: null,
      signals: [{ code: 'out-of-stock' }],
    },
    { productId: 'b', sku: 'B', stock: 1, suggestedOrderUnits: 2, signals: [] },
  ];
  const result = restockCandidates(rows, [
    { status: 'approved', lines: [{ productId: 'b', quantity: 10 }] },
  ]);
  assert.equal(result[0].additional, null);
  assert.equal(result[1].additional, 0);
});
