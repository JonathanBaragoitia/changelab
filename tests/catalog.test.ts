import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, sha } from '../src/infrastructure/store.ts';
import { ProposalService, actorFor } from '../src/application/proposals.ts';
import { AppError } from '../src/domain/catalog.ts';

test('catálogo de AutoCare tiene 18 referencias coherentes, formatos y seis categorías', () => {
  const store = new Store(':memory:');
  try {
    const products = store.products();
    assert.equal(products.length, 18);
    assert.equal(new Set(products.map((product) => product.sku)).size, 18);
    assert.equal(new Set(products.map((product) => product.category)).size, 6);
    assert.ok(
      products.every(
        (product) => product.costCents > 0 && product.priceCents * 80 >= product.costCents * 100,
      ),
    );
    assert.ok(!products.some((product) => /casco|cámara|teléfono|chaqueta/iu.test(product.name)));
    assert.ok(products.some((product) => product.name.includes('20 L')));
    const order = store.orders()[0];
    assert.ok(order);
    assert.equal(order.lines[0]?.productName, 'Champú concentrado de lavado · garrafa 20 L');
  } finally {
    store.close();
  }
});

test('actualización archiva la demo anterior sin reescribir pedidos, propuestas ni eventos', () => {
  const store = new Store(':memory:');
  try {
    store.db.exec('DELETE FROM products; DELETE FROM catalog_versions;');
    store.db
      .prepare(
        'INSERT INTO products(id,sku,name,category,priceCents,costCents,version) VALUES(?,?,?,?,?,?,1)',
      )
      .run('p1', 'CL-001', 'Casco urbano', 'Protección', 7990, 4900);
    const lines = JSON.stringify([{ productId: 'p1', quantity: 1, unitPriceCents: 7990 }]);
    store.db.prepare('UPDATE orders SET lines=? WHERE id=?').run(lines, 'PED-1042');
    const service = new ProposalService(
      store,
      { hash: sha },
      { now: () => new Date().toISOString() },
      { next: () => 'legacy-proposal' },
    );
    const proposal = service.create(actorFor('elena'), {
      instruction: 'Propuesta antigua',
      plan: { category: 'Protección', basisPoints: 500 },
    });
    const document = store.db
      .prepare('SELECT document FROM proposals WHERE id=?')
      .get(proposal.id)?.document;
    const events = store.audit();
    store.adoptAutoCareCatalog();
    assert.equal(store.products().length, 18);
    assert.equal(store.db.prepare("SELECT active FROM products WHERE id='p1'").get()?.active, 0);
    assert.equal(
      store.db.prepare('SELECT lines FROM orders WHERE id=?').get('PED-1042')?.lines,
      lines,
    );
    assert.equal(store.orders()[0]?.lines[0]?.productName, 'Casco urbano');
    assert.equal(store.orders()[0]?.lines[0]?.archived, true);
    assert.equal(
      store.db.prepare('SELECT document FROM proposals WHERE id=?').get(proposal.id)?.document,
      document,
    );
    assert.deepEqual(
      store.audit().filter((event) => events.some((previous) => previous.id === event.id)),
      events,
    );
    assert.equal(store.verifyAudit(), true);
    assert.throws(
      () => service.publish(actorFor('marcos'), proposal.id, proposal.digest),
      (error) => error instanceof AppError && error.code === 'MISSING_PRODUCT',
    );
    const after = store.audit();
    store.adoptAutoCareCatalog();
    assert.deepEqual(store.audit(), after);
    assert.equal(store.products().length, 18);
  } finally {
    store.close();
  }
});
