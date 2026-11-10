import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { deliveryBusinessDate } from '../src/application/business-calendar.ts';
import { Store } from '../src/infrastructure/store.ts';
import { CommerceStore } from '../src/infrastructure/commerce-store.ts';
import { ReceiveStock } from '../src/application/receiving.ts';
import type { Purchase } from '../src/application/operations.ts';

test('delivery dates follow Madrid civil day at midnight, weekends and DST', () => {
  assert.equal(deliveryBusinessDate('2026-11-09T00:30:00+01:00', 1), '2026-11-10');
  assert.equal(deliveryBusinessDate('2026-03-30T00:30:00+02:00', 1), '2026-03-31');
  assert.equal(deliveryBusinessDate('2026-10-26T00:30:00+01:00', 1), '2026-10-27');
  assert.equal(deliveryBusinessDate('2026-11-06T12:00:00+01:00', 1), '2026-11-09');
});

test('authorized purchase receives archived references without enabling free receipts or double stock', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store);
  const service = new ReceiveStock(commerce, randomUUID, () => '2026-11-05T12:00:00Z');
  store.db
    .prepare('INSERT INTO suppliers VALUES(?,?,?,?,?,?)')
    .run('supplier', 'Archivado', '', '', 0, 1);
  store.db.prepare('UPDATE products SET active=0 WHERE id=?').run('nc1');
  const stock = () =>
    Number(
      store.db.prepare('SELECT quantity FROM inventory WHERE productId=?').get('nc1')!.quantity,
    );
  const before = stock();
  const input = {
    requestId: randomUUID(),
    productId: 'nc1',
    quantity: 2,
    supplierId: 'supplier',
    supplier: 'Archivado',
    reference: 'ALB-ARCH-001',
  };
  const mario = {
    id: 'mario',
    role: 'viewer',
    profile: 'warehouse' as const,
    permissions: ['warehouse.receive'],
  };
  const purchase: Purchase = {
    id: randomUUID(),
    version: 3,
    createdBy: 'ana',
    createdAt: '2026-11-01T12:00:00Z',
    supplierId: 'supplier',
    supplierName: 'Archivado',
    reason: 'Reposicion autorizada',
    status: 'sent',
    approvedBy: 'antonio',
    totalCents: 200,
    lines: [
      {
        productId: 'nc1',
        sku: 'NC-001',
        name: 'Champu',
        quantity: 2,
        costCents: 100,
        baseVersion: 1,
      },
    ],
  };
  assert.throws(() => service.execute(mario, input), { code: 'SUPPLIER_UNAVAILABLE' });
  assert.throws(() => service.execute(mario, { ...input, allowArchivedProduct: true }), {
    code: 'INVALID_RECEIPT',
  });
  assert.throws(() => service.receivePurchase(mario, { ...purchase, status: 'draft' }, input), {
    code: 'INVALID_PURCHASE_RECEIPT',
  });
  assert.throws(() => service.receivePurchase(mario, purchase, { ...input, quantity: 3 }), {
    code: 'INVALID_PURCHASE_RECEIPT',
  });
  service.receivePurchase(mario, purchase, input);
  service.receivePurchase(mario, purchase, input);
  assert.equal(stock(), before + 2);
  store.db.prepare('UPDATE suppliers SET active=1 WHERE id=?').run('supplier');
  assert.throws(
    () => service.execute(mario, { ...input, requestId: randomUUID(), reference: 'ALB-FREE-002' }),
    { code: 'PRODUCT_UNAVAILABLE' },
  );
  assert.equal(stock(), before + 2);
});
