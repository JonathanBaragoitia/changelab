import type { BusinessRun, BusinessRunRepository } from '../application/business-runs.ts';
import type { Store } from './store.ts';
export class BusinessRunStore implements BusinessRunRepository {
  store: Store;
  constructor(store: Store) {
    this.store = store;
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS business_runs(id TEXT PRIMARY KEY,createdAt TEXT NOT NULL,document TEXT NOT NULL)',
    );
  }
  start(run: BusinessRun) {
    this.store.db
      .prepare('INSERT INTO business_runs VALUES(?,?,?)')
      .run(run.id, run.createdAt, JSON.stringify(run));
  }
  finish(run: BusinessRun) {
    const changed = this.store.db
      .prepare('UPDATE business_runs SET document=? WHERE id=?')
      .run(JSON.stringify(run), run.id).changes;
    if (changed !== 1) throw new Error('Missing business run');
  }
  latest(): BusinessRun[] {
    return this.store.db
      .prepare('SELECT document FROM business_runs ORDER BY createdAt DESC,rowid DESC LIMIT 20')
      .all()
      .map((row) => {
        const value = JSON.parse(String(row.document)) as BusinessRun;
        if (
          !value ||
          typeof value.id !== 'string' ||
          !Array.isArray(value.ids) ||
          !Array.isArray(value.context?.opportunities)
        )
          throw new Error('Invalid stored business run');
        return value;
      });
  }
}
