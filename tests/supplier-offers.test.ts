import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/infrastructure/store.ts';
import { CommerceStore } from '../src/infrastructure/commerce-store.ts';
import { SupplierOfferStore } from '../src/infrastructure/supplier-offer-store.ts';
import { OperationStore } from '../src/infrastructure/operation-store.ts';
import { Purchases, type Purchase } from '../src/application/operations.ts';

test('precio de venta independiente de compra; cambio de oferta sí obliga a revisar', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store),
    offers = new SupplierOfferStore(store),
    repo = new OperationStore<Purchase>(store, 'purchase');
  const purchases = new Purchases(
    repo,
    () => store.products(),
    (id) => commerce.receiptSupplier(id),
    () => {},
    randomUUID,
    () => new Date().toISOString(),
    (s, p) => offers.get(s, p),
  );
  const actor = { id: 'editor', role: 'editor' },
    reviewer = { id: 'reviewer', role: 'reviewer' };
  const input = {
    supplierId: 'demo-lavado',
    reason: 'Reponer champú para ventas',
    lines: [{ productId: 'nc1', quantity: 2 }],
  };
  const first = purchases.create(actor, input);
  store.db
    .prepare("UPDATE products SET priceCents=priceCents+100,version=version+1 WHERE id='nc1'")
    .run();
  purchases.transition(reviewer, first.id, { action: 'approve', expectedVersion: 1 });
  assert.equal(repo.get(first.id)?.status, 'approved');
  const second = purchases.create(actor, input);
  store.db
    .prepare(
      "UPDATE supplier_offers SET costCents=costCents+100,version=version+1 WHERE supplierId='demo-lavado' AND productId='nc1'",
    )
    .run();
  assert.throws(
    () => purchases.transition(reviewer, second.id, { action: 'approve', expectedVersion: 1 }),
    { code: 'PURCHASE_STALE' },
  );
});
test('proveedores ficticios idempotentes, costes por proveedor y lotes verificados', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store),
    offers = new SupplierOfferStore(store);
  const count = offers.all().length;
  new SupplierOfferStore(store);
  assert.equal(offers.all().length, count);
  assert.ok(offers.get('demo-accesorios', 'nc16'));
  assert.equal(offers.get('demo-accesorios', 'nc1'), undefined);
  const repo = new OperationStore<Purchase>(store, 'purchase');
  const purchases = new Purchases(
    repo,
    () => store.products(),
    (id) => commerce.receiptSupplier(id),
    () => {},
    randomUUID,
    () => new Date().toISOString(),
    (s, p) => offers.get(s, p),
  );
  const actor = { id: 'one', role: 'editor' },
    reviewer = { id: 'two', role: 'reviewer' };
  const input = {
    supplierId: 'demo-lavado',
    productId: 'nc1',
    costCents: 4800,
    packUnits: 1,
    leadDays: 3,
    expectedVersion: 1,
  };
  assert.throws(() => offers.save(input, reviewer));
  assert.throws(() => offers.save({ ...input, packUnits: 0 }, actor));
  offers.save(input, actor);
  assert.equal(offers.get('demo-lavado', 'nc1')?.version, 2);
  assert.throws(() => offers.save(input, actor));
  assert.throws(() =>
    purchases.create(actor, {
      supplierId: 'demo-accesorios',
      reason: 'Reponer producto',
      lines: [{ productId: 'nc1', quantity: 1 }],
    }),
  );
  assert.throws(() =>
    purchases.create(actor, {
      supplierId: 'demo-accesorios',
      reason: 'Reponer producto',
      lines: [{ productId: 'nc16', quantity: 1 }],
    }),
  );
  const p = purchases.create(actor, {
    supplierId: 'demo-accesorios',
    reason: 'Reponer producto',
    lines: [{ productId: 'nc16', quantity: 6 }],
  });
  assert.equal(p.totalCents, offers.get('demo-accesorios', 'nc16')!.costCents * 6);
  assert.equal(p.lines[0]!.packUnits, 6);
  store.db
    .prepare(
      'UPDATE supplier_offers SET version=version+1,costCents=costCents+1 WHERE supplierId=? AND productId=?',
    )
    .run('demo-accesorios', 'nc16');
  assert.throws(() =>
    purchases.transition(reviewer, p.id, { action: 'approve', expectedVersion: 1 }),
  );
  assert.equal(repo.get(p.id)?.status, 'draft');
});

test('reposición conjunta: división, reintento, permisos y rollback completo', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store),
    offers = new SupplierOfferStore(store),
    repo = new OperationStore<Purchase>(store, 'purchase');
  const purchases = new Purchases(
    repo,
    () => store.products(),
    (id) => commerce.receiptSupplier(id),
    () => {},
    randomUUID,
    () => new Date().toISOString(),
    (s, p) => offers.get(s, p),
  );
  const actor = { id: 'one', role: 'editor' },
    reviewer = { id: 'two', role: 'reviewer' };
  const body = {
    requestId: 'replenishment-test-0001',
    reason: 'Reposición de varios proveedores',
    lines: [
      { supplierId: 'demo-lavado', productId: 'nc1', quantity: 2 },
      { supplierId: 'demo-accesorios', productId: 'nc16', quantity: 6 },
    ],
  };
  assert.throws(() => purchases.createReplenishment(reviewer, body));
  const created = purchases.createReplenishment(actor, body);
  assert.equal(created.length, 2);
  assert.ok(created.every((p) => p.status === 'draft' && p.replenishmentId === body.requestId));
  assert.deepEqual(
    purchases
      .createReplenishment(actor, { ...body, lines: [...body.lines].reverse() })
      .map((p) => p.id)
      .sort(),
    created.map((p) => p.id).sort(),
  );
  assert.equal(repo.all().length, 2);
  assert.throws(() =>
    purchases.createReplenishment(actor, { ...body, reason: 'Otra razón diferente' }),
  );
  const bad = {
    ...body,
    requestId: 'replenishment-test-0002',
    lines: [
      { supplierId: 'demo-accesorios', productId: 'nc16', quantity: 6 },
      { supplierId: 'demo-lavado', productId: 'nc18', quantity: 1 },
    ],
  };
  assert.throws(() => purchases.createReplenishment(actor, bad));
  assert.equal(repo.all().length, 2);
  purchases.transition(reviewer, created[0]!.id, {
    action: 'approve',
    expectedVersion: created[0]!.version,
  });
  assert.equal(repo.get(created[1]!.id)?.status, 'draft');
  assert.equal(
    store.db.prepare('SELECT quantity FROM inventory WHERE productId=?').get('nc1')?.quantity,
    20,
  );
});
