import type { CatalogRecord, CatalogRepository } from '../application/catalog-management.ts';
import type { Store } from './store.ts';
import { fail } from '../domain/catalog.ts';
export class CatalogStore implements CatalogRepository {
  private store: Store;
  constructor(store: Store) {
    this.store = store;
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS product_details(productId TEXT PRIMARY KEY REFERENCES products(id),description TEXT NOT NULL)',
    );
  }
  transaction<T>(operation: () => T): T {
    return this.store.transaction(operation);
  }
  record(actor: string, action: string, detail: unknown) {
    this.store.record(actor, action, detail);
  }
  records(): CatalogRecord[] {
    return this.store.db
      .prepare(
        "SELECT p.*,COALESCE(d.description,'') description FROM products p LEFT JOIN product_details d ON d.productId=p.id ORDER BY p.sku",
      )
      .all() as CatalogRecord[];
  }
  createProduct(p: CatalogRecord) {
    this.store.db
      .prepare(
        'INSERT INTO products(id,sku,name,category,priceCents,costCents,version,active) VALUES(?,?,?,?,?,?,?,?)',
      )
      .run(p.id, p.sku, p.name, p.category, p.priceCents, p.costCents, p.version, p.active);
    this.store.db.prepare('INSERT INTO product_details VALUES(?,?)').run(p.id, p.description);
    this.store.db.prepare('INSERT INTO inventory VALUES(?,0)').run(p.id);
  }
  editProduct(p: CatalogRecord, expectedVersion: number) {
    if (
      this.store.db
        .prepare(
          'UPDATE products SET name=?,category=?,active=?,version=version+1 WHERE id=? AND version=?',
        )
        .run(p.name, p.category, p.active, p.id, expectedVersion).changes !== 1
    )
      fail(409, 'PRODUCT_CHANGED', 'El artículo ha cambiado.');
    this.store.db
      .prepare(
        'INSERT INTO product_details VALUES(?,?) ON CONFLICT(productId) DO UPDATE SET description=excluded.description',
      )
      .run(p.id, p.description);
  }
}
