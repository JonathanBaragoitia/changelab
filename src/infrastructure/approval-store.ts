import type { Approval, ApprovalRepository } from '../application/approvals.ts';
import type { Store } from './store.ts';
export class ApprovalStore implements ApprovalRepository {
  private store: Store;
  constructor(store: Store) {
    this.store = store;
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS approval_requests(id TEXT PRIMARY KEY, document TEXT NOT NULL); CREATE TABLE IF NOT EXISTS approval_outbox(id TEXT PRIMARY KEY, recipient TEXT NOT NULL, document TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS approval_inbox(id TEXT PRIMARY KEY, recipient TEXT NOT NULL, document TEXT NOT NULL)',
    );
  }
  transaction<T>(work: () => T) {
    return this.store.transaction(work);
  }
  get(id: string) {
    const row = this.store.db.prepare('SELECT document FROM approval_requests WHERE id=?').get(id);
    return row ? (JSON.parse(String(row.document)) as Approval) : undefined;
  }
  all() {
    return this.store.db
      .prepare('SELECT document FROM approval_requests ORDER BY rowid DESC LIMIT 200')
      .all()
      .map((r) => JSON.parse(String(r.document)) as Approval);
  }
  forPurchase(id: string) {
    const row = this.store.db
      .prepare("SELECT id FROM approval_requests WHERE json_extract(document, '$.purchaseId')=?")
      .get(id);
    return row ? String(row.id) : undefined;
  }
  save(value: Approval) {
    this.store.db
      .prepare(
        'INSERT INTO approval_requests VALUES(?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document',
      )
      .run(value.id, JSON.stringify(value));
  }
  record(actor: string, action: string, detail: unknown) {
    this.store.record(actor, action, detail);
  }
  notify(value: Approval) {
    this.store.db.prepare('INSERT INTO approval_outbox(id,recipient,document) VALUES(?,?,?)').run(
      value.id,
      value.author,
      JSON.stringify({
        requestId: value.id,
        status: value.status,
        reason: value.decision?.reason,
        at: value.decision?.at,
      }),
    );
  }
  deliver() {
    this.transaction(() => {
      this.store.db.exec(
        'INSERT OR IGNORE INTO approval_inbox SELECT id,recipient,document FROM approval_outbox WHERE delivered=0; UPDATE approval_outbox SET delivered=1 WHERE delivered=0',
      );
    });
  }
  inbox(actor: string) {
    return this.store.db
      .prepare(
        'SELECT document FROM approval_inbox WHERE recipient=? ORDER BY rowid DESC LIMIT 100',
      )
      .all(actor)
      .map((r) => JSON.parse(String(r.document)) as unknown);
  }
}
