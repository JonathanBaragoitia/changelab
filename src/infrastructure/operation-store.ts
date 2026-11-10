import { readOperation } from './operation-records.ts';
import { fail } from '../domain/catalog.ts';
import type { DocumentRepository } from '../application/operations.ts';
import type { Store } from './store.ts';
export class OperationStore<
  T extends { id: string; version: number },
> implements DocumentRepository<T> {
  private store: Store;
  private kind: string;
  constructor(store: Store, kind: string) {
    this.store = store;
    this.kind = kind;
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS operation_documents(kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,document TEXT NOT NULL,PRIMARY KEY(kind,id))',
    );
  }
  get(id: string): T | undefined {
    const r = this.store.db
      .prepare('SELECT id,version,document FROM operation_documents WHERE kind=? AND id=?')
      .get(this.kind, id);
    return r ? readOperation<T>(this.kind, r.document, String(r.id), Number(r.version)) : undefined;
  }
  all(): T[] {
    return this.store.db
      .prepare(
        'SELECT id,version,document FROM operation_documents WHERE kind=? ORDER BY rowid DESC',
      )
      .all(this.kind)
      .map((r) => readOperation<T>(this.kind, r.document, String(r.id), Number(r.version)));
  }
  save(value: T, expected: number) {
    if (expected === 0)
      this.store.db
        .prepare('INSERT INTO operation_documents VALUES(?,?,?,?)')
        .run(this.kind, value.id, value.version, JSON.stringify(value));
    else if (
      this.store.db
        .prepare(
          'UPDATE operation_documents SET version=?,document=? WHERE kind=? AND id=? AND version=?',
        )
        .run(value.version, JSON.stringify(value), this.kind, value.id, expected).changes !== 1
    )
      fail(409, 'DOCUMENT_CHANGED', 'Los datos han cambiado.');
  }
  transaction<R>(op: () => R): R {
    return this.store.transaction(op);
  }
  record(actor: string, action: string, detail: unknown) {
    this.store.record(actor, action, detail);
  }
}
