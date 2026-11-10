import test from 'node:test';
import assert from 'node:assert/strict';
import { groupWarehouseMovements } from '../public/warehouse-movements.js';
test('agrupa pedido con sus líneas, separa cancelación y ordena por fecha', () => {
  const rows = [
    {
      id: 1,
      kind: 'sale',
      orderId: 'p1',
      at: '2026-11-01T10:00:00Z',
      productId: 'a',
      quantity: -2,
    },
    {
      id: 2,
      kind: 'sale',
      orderId: 'p1',
      at: '2026-11-01T10:00:01Z',
      productId: 'b',
      quantity: -3,
    },
    {
      id: 3,
      kind: 'cancellation',
      orderId: 'p1',
      at: '2026-11-02T10:00:00Z',
      productId: 'a',
      quantity: 2,
    },
  ];
  const groups = groupWarehouseMovements(rows);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].kind, 'cancellation');
  assert.equal(groups[1].rows.length, 2);
  assert.equal(rows.length, 3);
});
test('recepciones del mismo albarán se agrupan sin mezclar proveedores', () => {
  const rows = [
    { id: 1, kind: 'receipt', orderId: 'r1', at: '2026-11-01', quantity: 2 },
    { id: 2, kind: 'receipt', orderId: 'r2', at: '2026-11-01', quantity: 3 },
    { id: 3, kind: 'receipt', orderId: 'r3', at: '2026-11-01', quantity: 4 },
  ];
  const receipts = [
    { id: 'r1', supplier: 'Uno', reference: 'ALB1' },
    { id: 'r2', supplier: 'Uno', reference: 'ALB1' },
    { id: 'r3', supplier: 'Otro', reference: 'ALB1' },
  ];
  const groups = groupWarehouseMovements(rows, receipts);
  assert.equal(groups.length, 2);
  assert.equal(groups.find((g) => g.supplier === 'Uno').rows.length, 2);
});
