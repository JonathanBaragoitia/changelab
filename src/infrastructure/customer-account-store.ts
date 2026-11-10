import type {
  CustomerAccount,
  CustomerAccountRepository,
} from '../application/customer-accounts.ts';
import { fail } from '../domain/catalog.ts';
import type { DatabaseSync } from 'node:sqlite';
import { CustomerSessions } from './customer-sessions.ts';
export class CustomerAccountStore implements CustomerAccountRepository {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    new CustomerSessions(db);
    db.exec(
      'CREATE TABLE IF NOT EXISTS customer_accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,passwordHash TEXT NOT NULL);CREATE TABLE IF NOT EXISTS customer_addresses(customerId TEXT PRIMARY KEY REFERENCES customer_accounts(id),address TEXT NOT NULL);CREATE TABLE IF NOT EXISTS customer_attempts(key TEXT PRIMARY KEY,started INTEGER NOT NULL,count INTEGER NOT NULL)',
    );
  }
  byEmail(email: string) {
    return this.db.prepare('SELECT * FROM customer_accounts WHERE email=?').get(email) as
      CustomerAccount | undefined;
  }
  byId(id: string) {
    return this.db.prepare('SELECT * FROM customer_accounts WHERE id=?').get(id) as
      CustomerAccount | undefined;
  }
  add(a: CustomerAccount) {
    if (this.byEmail(a.email) || this.byId(a.id))
      fail(409, 'CUSTOMER_EXISTS', 'Ya existe una cuenta. Usa Iniciar sesión.');
    this.db
      .prepare('INSERT INTO customer_accounts VALUES(?,?,?,?)')
      .run(a.id, a.email, a.name, a.passwordHash);
  }
  update(account: CustomerAccount, expected: CustomerAccount) {
    // Commit the profile and session revocation together; stale requests cannot overwrite it.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const other = this.byEmail(account.email);
      if (other && other.id !== account.id)
        fail(409, 'CUSTOMER_EXISTS', 'Ese correo ya está en uso.');
      const result = this.db
        .prepare(
          'UPDATE customer_accounts SET name=?,email=?,passwordHash=? WHERE id=? AND name=? AND email=? AND passwordHash=?',
        )
        .run(
          account.name,
          account.email,
          account.passwordHash,
          account.id,
          expected.name,
          expected.email,
          expected.passwordHash,
        );
      if (result.changes !== 1)
        fail(
          409,
          'CUSTOMER_CHANGED',
          'La cuenta ha cambiado. Vuelve a iniciar sesión antes de guardar.',
        );
      this.db.prepare('DELETE FROM customer_sessions WHERE customerId=?').run(account.id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  address(id: string) {
    return (
      (this.db.prepare('SELECT address FROM customer_addresses WHERE customerId=?').get(id)
        ?.address as string) ?? ''
    );
  }
  saveAddress(id: string, address: string) {
    this.db
      .prepare(
        'INSERT INTO customer_addresses VALUES(?,?) ON CONFLICT(customerId) DO UPDATE SET address=excluded.address',
      )
      .run(id, address);
  }
  attempt(key: string) {
    const now = Date.now();
    this.db.prepare('DELETE FROM customer_attempts WHERE started<=?').run(now - 60000);
    this.db
      .prepare(
        'INSERT INTO customer_attempts VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=count+1',
      )
      .run(key, now);
    return (
      (this.db.prepare('SELECT count FROM customer_attempts WHERE key=?').get(key)!
        .count as number) <= 10
    );
  }
}
