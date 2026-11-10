import type { DatabaseSync, SQLOutputValue } from 'node:sqlite';
import { LOGIN_WINDOW_MS } from '../application/auth.ts';
import type { Account, AuthRepository, Session } from '../application/auth.ts';
import type { Actor } from '../application/proposals.ts';
type Row = Record<string, SQLOutputValue>;
function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error('Invalid account row');
  return value;
}
function actor(row: Row): Actor {
  const role = text(row, 'role');
  if (role !== 'editor' && role !== 'reviewer' && role !== 'viewer')
    throw new Error('Invalid stored role');
  return { id: text(row, 'id'), name: text(row, 'name'), role, initials: text(row, 'initials') };
}
export class AuthStore implements AuthRepository {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    const initialized = !!db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='user_order_permissions'",
      )
      .get();
    db.exec(`CREATE TABLE IF NOT EXISTS users(
      id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('editor','reviewer','viewer')),initials TEXT NOT NULL,
      passwordHash TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)));
      CREATE TABLE IF NOT EXISTS sessions(
      tokenHash TEXT PRIMARY KEY,userId TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expiresAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY,startedAt INTEGER NOT NULL,count INTEGER NOT NULL);`);
    const warehouseInitialized = !!db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='user_warehouse_permissions'",
      )
      .get();
    db.exec(`CREATE TABLE IF NOT EXISTS user_operational_profiles(userId TEXT PRIMARY KEY REFERENCES users(id),profile TEXT NOT NULL CHECK(profile='warehouse'));
      CREATE TABLE IF NOT EXISTS user_warehouse_permissions(userId TEXT NOT NULL REFERENCES users(id),permission TEXT NOT NULL CHECK(permission IN ('warehouse.receive','warehouse.damage','warehouse.handover')),PRIMARY KEY(userId,permission));`);
    if (!warehouseInitialized)
      db.exec(
        "INSERT INTO user_warehouse_permissions SELECT id,'warehouse.handover' FROM users WHERE role='editor'",
      );
    db.exec(
      "CREATE TABLE IF NOT EXISTS user_business_roles(userId TEXT PRIMARY KEY REFERENCES users(id),businessRole TEXT NOT NULL CHECK(businessRole IN ('owner','office')))",
    );
    db.exec('SAVEPOINT initialize_order_permissions');
    try {
      db.exec(
        "CREATE TABLE IF NOT EXISTS user_order_permissions(userId TEXT NOT NULL REFERENCES users(id),permission TEXT NOT NULL CHECK(permission IN ('warehouse.prepare','orders.ship')),PRIMARY KEY(userId,permission))",
      );
      if (!initialized)
        db.exec(
          "INSERT INTO user_order_permissions SELECT id,'warehouse.prepare' FROM users WHERE role='editor'; INSERT INTO user_order_permissions SELECT id,'orders.ship' FROM users WHERE role='editor';",
        );
      db.exec('RELEASE SAVEPOINT initialize_order_permissions');
    } catch (error) {
      db.exec(
        'ROLLBACK TO SAVEPOINT initialize_order_permissions; RELEASE SAVEPOINT initialize_order_permissions',
      );
      throw error;
    }
  }
  private withPermissions(row: Row): Actor {
    const value = actor(row);
    // Suspending direction must not restore legacy commercial approval privileges.
    value.ownerApprovalRequired = !!this.db
      .prepare("SELECT 1 FROM user_business_roles WHERE businessRole='owner' LIMIT 1")
      .get();
    const business = this.db
      .prepare('SELECT businessRole FROM user_business_roles WHERE userId=?')
      .get(value.id);
    if (business?.businessRole === 'owner' || business?.businessRole === 'office')
      value.businessRole = business.businessRole;
    return {
      ...value,
      ...(this.db
        .prepare('SELECT profile FROM user_operational_profiles WHERE userId=?')
        .get(value.id)
        ? { profile: 'warehouse' as const }
        : {}),
      permissions: this.db
        .prepare(
          'SELECT permission FROM user_order_permissions WHERE userId=? UNION SELECT permission FROM user_warehouse_permissions WHERE userId=? ORDER BY permission',
        )
        .all(value.id, value.id)
        .map((r) => String(r.permission)),
    };
  }
  count() {
    return Number(this.db.prepare('SELECT COUNT(*) n FROM users').get()?.n ?? 0);
  }
  account(username: string): Account | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE username=?').get(username);
    return row
      ? {
          actor: this.withPermissions(row),
          username: text(row, 'username'),
          passwordHash: text(row, 'passwordHash'),
          active: row.active === 1,
        }
      : undefined;
  }
  add(account: Account) {
    const a = account.actor;
    this.db.exec('SAVEPOINT add_staff_account');
    try {
      this.db
        .prepare(
          'INSERT INTO users(id,username,name,role,initials,passwordHash,active) VALUES(?,?,?,?,?,?,?)',
        )
        .run(
          a.id,
          account.username,
          a.name,
          a.role,
          a.initials,
          account.passwordHash,
          account.active ? 1 : 0,
        );
      if (a.role === 'editor')
        for (const permission of a.businessRole === 'office'
          ? ['orders.ship']
          : ['warehouse.prepare', 'orders.ship'])
          this.db.prepare('INSERT INTO user_order_permissions VALUES(?,?)').run(a.id, permission);
      if (a.role === 'editor' && a.businessRole !== 'office')
        this.db
          .prepare('INSERT INTO user_warehouse_permissions VALUES(?,?)')
          .run(a.id, 'warehouse.handover');
      if (a.businessRole)
        this.db.prepare('INSERT INTO user_business_roles VALUES(?,?)').run(a.id, a.businessRole);
      if (a.profile === 'warehouse') {
        this.db.prepare('INSERT INTO user_operational_profiles VALUES(?,?)').run(a.id, 'warehouse');
        this.db
          .prepare('INSERT INTO user_order_permissions VALUES(?,?)')
          .run(a.id, 'warehouse.prepare');
        for (const permission of ['warehouse.receive', 'warehouse.damage', 'warehouse.handover'])
          this.db
            .prepare('INSERT INTO user_warehouse_permissions VALUES(?,?)')
            .run(a.id, permission);
      }
      this.db.exec('RELEASE SAVEPOINT add_staff_account');
    } catch (error) {
      this.db.exec('ROLLBACK TO SAVEPOINT add_staff_account; RELEASE SAVEPOINT add_staff_account');
      throw error;
    }
  }
  session(hash: string): Session | undefined {
    const row = this.db
      .prepare(
        'SELECT u.id,u.name,u.role,u.initials,s.csrf,s.expiresAt FROM sessions s JOIN users u ON u.id=s.userId WHERE s.tokenHash=? AND u.active=1',
      )
      .get(hash);
    if (!row) return undefined;
    if (typeof row.expiresAt !== 'number') throw new Error('Invalid session expiry');
    return { actor: this.withPermissions(row), csrf: text(row, 'csrf'), expiresAt: row.expiresAt };
  }
  saveSession(hash: string, userId: string, csrf: string, expiresAt: number) {
    this.db.prepare('DELETE FROM sessions WHERE expiresAt<=?').run(expiresAt - 8 * 60 * 60 * 1000);
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash, userId, csrf, expiresAt);
  }
  removeSession(hash: string) {
    this.db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(hash);
  }
  hit(key: string, now: number) {
    this.db.prepare('DELETE FROM login_attempts WHERE startedAt<=?').run(now - LOGIN_WINDOW_MS);
    this.db
      .prepare(
        'INSERT INTO login_attempts VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=count+1',
      )
      .run(key, now);
    return Number(
      this.db.prepare('SELECT count FROM login_attempts WHERE key=?').get(key)?.count ?? 0,
    );
  }
}
