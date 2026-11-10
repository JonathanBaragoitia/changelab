import { fail } from '../domain/catalog.ts';
import type { Supplier, SupplierRepository } from '../application/suppliers.ts';
import type { Store } from './store.ts';
export class SupplierStore implements SupplierRepository {
  private store: Store;
  constructor(store: Store) {
    this.store = store;
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS suppliers(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,phone TEXT NOT NULL,active INTEGER NOT NULL,version INTEGER NOT NULL)',
    );
  }
  transaction<T>(operation: () => T): T {
    return this.store.transaction(operation);
  }
  record(actor: string, action: string, detail: unknown) {
    this.store.record(actor, action, detail);
  }
  suppliers(): Supplier[] {
    return this.store.db.prepare('SELECT * FROM suppliers ORDER BY name').all() as Supplier[];
  }
  saveSupplier(s: Supplier, expectedVersion?: number) {
    if (expectedVersion === undefined)
      this.store.db
        .prepare('INSERT INTO suppliers VALUES(?,?,?,?,?,?)')
        .run(s.id, s.name, s.email, s.phone, s.active, s.version);
    else if (
      this.store.db
        .prepare(
          'UPDATE suppliers SET name=?,email=?,phone=?,active=?,version=? WHERE id=? AND version=?',
        )
        .run(s.name, s.email, s.phone, s.active, s.version, s.id, expectedVersion).changes !== 1
    )
      fail(409, 'SUPPLIER_CHANGED', 'La ficha ha cambiado.');
  }
}
