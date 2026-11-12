import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store, sha } from '../src/infrastructure/store.ts';
import { CommerceStore } from '../src/infrastructure/commerce-store.ts';
import { OperationStore } from '../src/infrastructure/operation-store.ts';
import { Purchases, deliveryBusinessDate, type Purchase } from '../src/application/operations.ts';
import { ReceiveStock } from '../src/application/receiving.ts';
test('envío y recepciones parciales: stock exacto, reintento y exceso bloqueado', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store),
    repo = new OperationStore<Purchase>(store, 'purchase');
  store.db
    .prepare('INSERT INTO suppliers VALUES(?,?,?,?,?,?)')
    .run('supplier', 'Proveedor', '', '', 1, 1);
  const now = () => '2026-11-06T12:00:00Z';
  const receiving = new ReceiveStock(commerce, randomUUID, now);
  const purchases = new Purchases(
    repo,
    () => store.products(),
    (id) => commerce.receiptSupplier(id),
    (actor, p, reference, deliveryId) => {
      for (const line of p.lines)
        receiving.execute(actor, {
          requestId: sha({ purchaseId: p.id, productId: line.productId, deliveryId }),
          supplierId: p.supplierId,
          supplier: p.supplierName,
          reference,
          productId: line.productId,
          quantity: line.quantity,
        });
    },
    randomUUID,
    now,
  );
  const editor = { id: 'editor', role: 'editor' },
    reviewer = { id: 'reviewer', role: 'reviewer' };
  const request = {
    requestId: randomUUID(),
    supplierId: 'supplier',
    reason: 'Reponer champú',
    lines: [{ productId: 'nc1', quantity: 20 }],
  };
  const p = purchases.create(editor, request);
  assert.deepEqual(
    purchases.create(editor, { ...request, lines: [{ quantity: 20, productId: 'nc1' }] }),
    p,
  );
  assert.equal(repo.all().length, 1);
  assert.throws(
    () => purchases.create(editor, { ...request, lines: [{ quantity: 21, productId: 'nc1' }] }),
    { code: 'PURCHASE_REUSED' },
  );
  purchases.transition(reviewer, p.id, { action: 'approve', expectedVersion: 1 });
  const delivery = {
    action: 'receive-partial',
    expectedVersion: 3,
    requestId: randomUUID(),
    reference: 'ALB-1',
    confirmReceived: true,
    lines: [{ productId: 'nc1', quantity: 12 }],
  };
  assert.throws(() => purchases.transition(editor, p.id, delivery));
  const sent = purchases.transition(editor, p.id, { action: 'send', expectedVersion: 2 });
  assert.equal(sent.expectedDate, '2026-11-11');
  const partial = purchases.transition(editor, p.id, delivery);
  assert.equal(partial.status, 'partially_received');
  assert.equal(
    store.db.prepare('SELECT quantity FROM inventory WHERE productId=?').get('nc1')?.quantity,
    32,
  );
  purchases.transition(editor, p.id, delivery);
  assert.equal(repo.get(p.id)?.version, 4);
  assert.throws(() =>
    purchases.transition(editor, p.id, {
      ...delivery,
      expectedVersion: 4,
      requestId: randomUUID(),
      reference: 'ALB-2',
      lines: [{ productId: 'nc1', quantity: 9 }],
    }),
  );
  assert.equal(
    store.db.prepare('SELECT quantity FROM inventory WHERE productId=?').get('nc1')?.quantity,
    32,
  );
  const complete = purchases.transition(editor, p.id, {
    ...delivery,
    expectedVersion: 4,
    requestId: randomUUID(),
    reference: 'ALB-2',
    lines: [{ productId: 'nc1', quantity: 8 }],
  });
  assert.equal(complete.status, 'received');
  assert.equal(
    store.db.prepare('SELECT quantity FROM inventory WHERE productId=?').get('nc1')?.quantity,
    40,
  );
  assert.equal(repo.get(p.id)?.deliveries?.length, 2);
  assert.throws(() =>
    purchases.transition(editor, p.id, {
      action: 'receive-partial',
      expectedVersion: 5,
      requestId: randomUUID(),
      reference: 'ALB-3',
      confirmReceived: true,
      lines: [{ productId: 'nc1', quantity: 1 }],
    }),
  );
});
test('fecha orientativa excluye fines de semana', () => {
  assert.equal(deliveryBusinessDate('2026-11-06T12:00:00Z', 1), '2026-11-09');
});
