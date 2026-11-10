import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/infrastructure/store.ts';
import { CommerceStore } from '../src/infrastructure/commerce-store.ts';
import { CatalogStore } from '../src/infrastructure/catalog-store.ts';
import { ManageCatalog } from '../src/application/catalog-management.ts';
const actor = { id: 'editor', role: 'editor' };
function fixture(t: test.TestContext) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store),
    repo = new CatalogStore(store);
  return { store, commerce, repo, service: new ManageCatalog(repo, randomUUID) };
}
const input = () => ({
  sku: 'NA-099',
  name: 'Aplicador de espuma de prueba',
  category: 'Accesorios de limpieza',
  description: 'Aplicador del catálogo ficticio para extender productos de acabado.',
  priceCents: 1000,
  costCents: 500,
});
test('crear artículo válido empieza sin stock; edición conserva precios y permite archivo/reactivación', (t) => {
  const { commerce, repo, service } = fixture(t),
    product = service.execute(actor, undefined, input());
  assert.equal(commerce.publicCatalog().find((p) => p.id === product.id)?.quantity, 0);
  assert.equal(
    commerce.publicCatalog().find((p) => p.id === product.id)?.description,
    input().description,
  );
  const edit = {
    name: product.name,
    category: product.category,
    description: 'Descripción de producto actualizada de prueba',
    active: false,
    expectedVersion: 1,
  };
  service.execute(actor, product.id, edit);
  assert.ok(!commerce.products().some((p) => p.id === product.id));
  assert.equal(repo.records().find((p) => p.id === product.id)?.priceCents, 1000);
  assert.throws(() => service.execute(actor, product.id, edit));
  service.execute(actor, product.id, { ...edit, active: true, expectedVersion: 2 });
  assert.ok(commerce.products().some((p) => p.id === product.id));
  assert.throws(() =>
    service.execute(actor, product.id, { ...edit, expectedVersion: 3, priceCents: 1 }),
  );
});
test('margen, SKU duplicado, permisos y rollback de alta', (t) => {
  const { store, repo, service } = fixture(t);
  assert.throws(() => service.execute({ id: 'v', role: 'viewer' }, undefined, input()));
  assert.throws(() => service.execute(actor, undefined, { ...input(), costCents: 900 }));
  service.execute(actor, undefined, input());
  assert.throws(() => service.execute(actor, undefined, input()));
  const before = repo.records().length;
  store.db.exec(
    "CREATE TRIGGER fail_product BEFORE INSERT ON audit WHEN NEW.action='catalog.product-created' BEGIN SELECT RAISE(ABORT,'failure'); END",
  );
  assert.throws(() => service.execute(actor, undefined, { ...input(), sku: 'NA-100' }));
  assert.equal(repo.records().length, before);
  assert.ok(!store.db.prepare("SELECT id FROM products WHERE sku='NA-100'").get());
});
