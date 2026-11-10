import { randomBytes, createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { fail } from '../domain/catalog.ts';
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
export class CustomerSessions {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(
      'CREATE TABLE IF NOT EXISTS customer_sessions(hash TEXT PRIMARY KEY, customerId TEXT NOT NULL, csrf TEXT NOT NULL, expiresAt INTEGER NOT NULL)',
    );
  }
  current(token: string | undefined) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return undefined;
    const row = this.db
      .prepare('SELECT customerId,csrf FROM customer_sessions WHERE hash=? AND expiresAt>?')
      .get(hash(token), Date.now());
    return row ? { id: row.customerId as string, csrf: row.csrf as string } : undefined;
  }
  create(customerId?: string) {
    this.db.prepare('DELETE FROM customer_sessions WHERE expiresAt<=?').run(Date.now());
    const token = randomBytes(32).toString('hex'),
      csrf = randomBytes(32).toString('hex');
    const id = customerId ?? 'guest-' + randomUUID();
    this.db
      .prepare('INSERT INTO customer_sessions VALUES(?,?,?,?)')
      .run(hash(token), id, csrf, Date.now() + 7 * 86400000);
    return { token, id, csrf };
  }
  revoke(token: string | undefined) {
    if (token) this.db.prepare('DELETE FROM customer_sessions WHERE hash=?').run(hash(token));
  }
  require(token: string | undefined) {
    const session = this.current(token);
    if (!session)
      fail(401, 'CUSTOMER_SESSION', 'Vuelve a abrir la tienda para iniciar una sesión de compra.');
    return session;
  }
}
