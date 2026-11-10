import type { Store } from './store.ts';
import type { StockPolicy, StockPolicyRepository } from '../application/stock-analysis.ts';
export class StockPolicyStore implements StockPolicyRepository {
  store: Store;
  constructor(store: Store) {
    this.store = store;
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS stock_policies(productId TEXT PRIMARY KEY,leadDays INTEGER NOT NULL,safetyDays INTEGER NOT NULL,targetDays INTEGER NOT NULL,minimumUnits INTEGER NOT NULL,version INTEGER NOT NULL)',
    );
  }
  products() {
    return this.store.products();
  }
  all() {
    return this.store.db
      .prepare('SELECT * FROM stock_policies ORDER BY productId')
      .all() as StockPolicy[];
  }
  put(p: StockPolicy, expectedVersion: number) {
    if (expectedVersion === 0)
      return (
        this.store.db
          .prepare('INSERT INTO stock_policies VALUES(?,?,?,?,?,?)')
          .run(p.productId, p.leadDays, p.safetyDays, p.targetDays, p.minimumUnits, p.version)
          .changes === 1
      );
    return (
      this.store.db
        .prepare(
          'UPDATE stock_policies SET leadDays=?,safetyDays=?,targetDays=?,minimumUnits=?,version=? WHERE productId=? AND version=?',
        )
        .run(
          p.leadDays,
          p.safetyDays,
          p.targetDays,
          p.minimumUnits,
          p.version,
          p.productId,
          expectedVersion,
        ).changes === 1
    );
  }
  transaction<T>(op: () => T) {
    return this.store.transaction(op);
  }
  record(actor: string, action: string, detail: unknown) {
    this.store.record(actor, action, detail);
  }
}
