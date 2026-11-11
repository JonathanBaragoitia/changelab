import { AUTOCARE_PRODUCTS, CATALOG_VERSION } from './catalog-data.ts';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Product, Proposal, Change } from '../domain/catalog.ts';
import type { ChangeRepository } from '../application/ports.ts';
export const sha = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class Store implements ChangeRepository {
  private transactionDepth = 0;
  private clock: () => string;
  db: DatabaseSync;
  constructor(path: string, clock: () => string = () => new Date().toISOString()) {
    this.clock = clock;
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      closeSync(openSync(path, 'a', 0o600));
    }
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,sku TEXT NOT NULL UNIQUE,name TEXT NOT NULL,category TEXT NOT NULL,priceCents INTEGER NOT NULL CHECK(priceCents>0),costCents INTEGER NOT NULL CHECK(costCents>0),version INTEGER NOT NULL DEFAULT 1); CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,status TEXT NOT NULL,lines TEXT NOT NULL); CREATE TABLE IF NOT EXISTS proposals(id TEXT PRIMARY KEY,document TEXT NOT NULL); CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,previousHash TEXT NOT NULL,hash TEXT NOT NULL);',
    );
    if (
      !this.db
        .prepare('PRAGMA table_info(products)')
        .all()
        .some((row) => row.name === 'active')
    )
      this.db.exec('ALTER TABLE products ADD COLUMN active INTEGER NOT NULL DEFAULT 1');
    this.db.exec('CREATE TABLE IF NOT EXISTS catalog_versions(version TEXT PRIMARY KEY)');
    if (!(this.db.prepare('SELECT COUNT(*) n FROM products').get() as { n: number }).n) this.seed();
    else this.adoptAutoCareCatalog();
  }
  seed() {
    this.transaction(() => {
      const insert = this.db.prepare(
        'INSERT INTO products(id,sku,name,category,priceCents,costCents,version) VALUES(?,?,?,?,?,?,1)',
      );
      for (const row of AUTOCARE_PRODUCTS) insert.run(...row);
      this.db.prepare('INSERT INTO orders VALUES(?,?,?)').run(
        'PED-1042',
        'confirmed',
        JSON.stringify([
          { productId: 'nc1', quantity: 1, unitPriceCents: 7990 },
          { productId: 'nc2', quantity: 2, unitPriceCents: 3490 },
        ]),
      );
      this.db.prepare('INSERT INTO catalog_versions VALUES(?)').run(CATALOG_VERSION);
      this.record('system', 'catalog.seeded', {
        products: AUTOCARE_PRODUCTS.length,
        business: 'Limpieza y cuidado del automóvil',
      });
    });
  }
  adoptAutoCareCatalog() {
    if (
      this.db.prepare('SELECT version FROM catalog_versions WHERE version=?').get(CATALOG_VERSION)
    )
      return;
    this.transaction(() => {
      const retired = this.db
        .prepare(
          "UPDATE products SET active=0 WHERE id IN ('p1','p2','p3','p4','p5','p6','p7','p8') AND sku LIKE 'CL-%'",
        )
        .run().changes;
      const insert = this.db.prepare(
        'INSERT INTO products(id,sku,name,category,priceCents,costCents,version) VALUES(?,?,?,?,?,?,1) ON CONFLICT(id) DO NOTHING',
      );
      let added = 0;
      for (const row of AUTOCARE_PRODUCTS) added += Number(insert.run(...row).changes);
      this.db.prepare('INSERT INTO catalog_versions VALUES(?)').run(CATALOG_VERSION);
      this.record('system', 'catalog.updated', {
        business: 'Limpieza y cuidado del automóvil',
        added,
        retired: Number(retired),
      });
    });
  }
  products(): Product[] {
    return this.db
      .prepare(
        'SELECT id,sku,name,category,priceCents,costCents,version FROM products WHERE active=1 ORDER BY sku',
      )
      .all() as Product[];
  }
  orders() {
    return this.db
      .prepare('SELECT * FROM orders ORDER BY id')
      .all()
      .map((r) => {
        const parsed: unknown = JSON.parse(r.lines as string);
        if (!Array.isArray(parsed)) throw new Error('Invalid stored order lines');
        const lines = parsed.map((value: unknown) => {
          if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error('Invalid stored order line');
          const line = value as Record<string, unknown>;
          const product =
            typeof line.productId === 'string'
              ? this.db.prepare('SELECT name,active FROM products WHERE id=?').get(line.productId)
              : undefined;
          return {
            ...line,
            productName: typeof product?.name === 'string' ? product.name : 'Artículo histórico',
            archived: product?.active === 0,
          };
        });
        return { ...r, lines };
      });
  }
  proposals(): Proposal[] {
    return this.db
      .prepare('SELECT document FROM proposals ORDER BY rowid DESC')
      .all()
      .map((r) => JSON.parse(r.document as string));
  }
  proposal(id: string): Proposal | undefined {
    const row = this.db.prepare('SELECT document FROM proposals WHERE id=?').get(id);
    return row ? JSON.parse(row.document as string) : undefined;
  }
  save(p: Proposal) {
    this.db
      .prepare(
        'INSERT INTO proposals VALUES(?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document',
      )
      .run(p.id, JSON.stringify(p));
  }
  updatePrice(c: Change) {
    return (
      this.db
        .prepare(
          'UPDATE products SET priceCents=?,version=version+1 WHERE id=? AND version=? AND active=1',
        )
        .run(c.afterCents, c.productId, c.baseVersion).changes === 1
    );
  }
  record(actor: string, action: string, data: unknown) {
    const previousHash =
      (this.db.prepare('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1').get()?.hash as string) ??
      'GENESIS';
    const entry = {
      id: randomUUID(),
      at: this.timestamp(),
      actor,
      action,
      detail: JSON.stringify(data),
      previousHash,
    };
    this.db
      .prepare(
        'INSERT INTO audit(id,at,actor,action,detail,previousHash,hash) VALUES(?,?,?,?,?,?,?)',
      )
      .run(entry.id, entry.at, actor, action, entry.detail, previousHash, sha(entry));
  }
  identityNames(): Record<string, string> {
    const names: Record<string, string> = {};
    for (const row of this.db.prepare('SELECT id,name FROM users').all()) {
      if (typeof row.id === 'string' && typeof row.name === 'string') names[row.id] = row.name;
    }
    return names;
  }
  timestamp() {
    return this.clock();
  }
  audit() {
    return this.db.prepare('SELECT * FROM audit ORDER BY seq DESC LIMIT 1000').all();
  }
  verifyAudit() {
    let previous = 'GENESIS';
    for (const row of this.db.prepare('SELECT * FROM audit ORDER BY seq').all()) {
      const { seq, hash, ...entry } = row;
      if (entry.previousHash !== previous || sha(entry) !== hash) return false;
      previous = hash as string;
    }
    return true;
  }
  transaction<T>(operation: () => T): T {
    const depth = this.transactionDepth,
      point = 'nested_' + depth;
    this.db.exec(depth ? 'SAVEPOINT ' + point : 'BEGIN IMMEDIATE');
    this.transactionDepth++;
    try {
      const value = operation();
      this.db.exec(depth ? 'RELEASE SAVEPOINT ' + point : 'COMMIT');
      return value;
    } catch (error) {
      if (depth) {
        this.db.exec('ROLLBACK TO SAVEPOINT ' + point);
        this.db.exec('RELEASE SAVEPOINT ' + point);
      } else this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }
  close() {
    this.db.close();
  }
}
