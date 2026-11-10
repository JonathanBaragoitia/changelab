import type { Store } from './store.ts';
import { createHash } from 'node:crypto';
import { fail } from '../domain/catalog.ts';
import type { prepareTariffProposal } from '../application/tariff-proposal.ts';
import type {
  TariffBatch,
  TariffChange,
  TariffRepository,
  TariffSource,
} from '../application/tariffs.ts';
export type TariffDecision = {
  tariffId: string;
  fingerprint: string;
  createdBy: string;
  createdAt: string;
  report: Awaited<ReturnType<typeof prepareTariffProposal>>;
};
export class TariffStore implements TariffRepository {
  store: Store;
  constructor(store: Store) {
    this.store = store;
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS tariff_batches(id TEXT PRIMARY KEY,supplierId TEXT NOT NULL,reference TEXT NOT NULL,document TEXT NOT NULL,UNIQUE(supplierId,reference))',
    );
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS tariff_sources(id TEXT PRIMARY KEY,document TEXT NOT NULL,original BLOB NOT NULL)',
    );
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS tariff_decisions(tariffId TEXT PRIMARY KEY REFERENCES tariff_batches(id),document TEXT NOT NULL)',
    );
  }
  decisions(): TariffDecision[] {
    return this.store.db
      .prepare('SELECT document FROM tariff_decisions ORDER BY rowid DESC LIMIT 200')
      .all()
      .map((row) => JSON.parse(String(row.document)) as TariffDecision);
  }
  decision(id: string): TariffDecision | undefined {
    const row = this.store.db
      .prepare('SELECT document FROM tariff_decisions WHERE tariffId=?')
      .get(id);
    return row ? (JSON.parse(String(row.document)) as TariffDecision) : undefined;
  }
  saveDecision(value: TariffDecision) {
    this.store.db
      .prepare(
        'INSERT INTO tariff_decisions VALUES(?,?) ON CONFLICT(tariffId) DO UPDATE SET document=excluded.document',
      )
      .run(value.tariffId, JSON.stringify(value));
  }
  source(id: string) {
    const row = this.store.db
      .prepare('SELECT document,original FROM tariff_sources WHERE id=?')
      .get(id);
    if (!row) return;
    const source = JSON.parse(String(row.document)) as TariffSource;
    if (
      !(row.original instanceof Uint8Array) ||
      createHash('sha256').update(row.original).digest('hex') !== source.sha256
    )
      fail(
        409,
        'SOURCE_INTEGRITY',
        'El documento original no coincide con su huella guardada. No se puede aplicar.',
      );
    return source;
  }
  saveSource(source: TariffSource, original: Buffer) {
    this.store.db
      .prepare('INSERT INTO tariff_sources VALUES(?,?,?)')
      .run(source.id, JSON.stringify(source), original);
  }
  original(id: string) {
    return this.store.db.prepare('SELECT original FROM tariff_sources WHERE id=?').get(id)
      ?.original;
  }
  offer(supplierId: string, productId: string) {
    return this.store.db
      .prepare('SELECT costCents,version FROM supplier_offers WHERE supplierId=? AND productId=?')
      .get(supplierId, productId) as { costCents: number; version: number } | undefined;
  }
  updateOffer(supplierId: string, c: TariffChange) {
    return (
      this.store.db
        .prepare(
          'UPDATE supplier_offers SET costCents=?,version=version+1 WHERE supplierId=? AND productId=? AND version=? AND costCents=?',
        )
        .run(c.afterCostCents, supplierId, c.productId, c.baseVersion, c.beforeCostCents)
        .changes === 1
    );
  }
  products() {
    return this.store.products();
  }
  supplier(id: string) {
    return this.store.db.prepare('SELECT name,active FROM suppliers WHERE id=?').get(id) as
      { name: string; active: number } | undefined;
  }
  batch(id: string) {
    const row = this.store.db.prepare('SELECT document FROM tariff_batches WHERE id=?').get(id);
    return row ? (JSON.parse(String(row.document)) as TariffBatch) : undefined;
  }
  existing(supplierId: string, reference: string) {
    const row = this.store.db
      .prepare('SELECT document FROM tariff_batches WHERE supplierId=? AND reference=?')
      .get(supplierId, reference.toLowerCase());
    return row ? (JSON.parse(String(row.document)) as TariffBatch) : undefined;
  }
  latest(): TariffBatch[] {
    return this.store.db
      .prepare('SELECT document FROM tariff_batches ORDER BY rowid DESC LIMIT 200')
      .all()
      .map((r) => JSON.parse(String(r.document)) as TariffBatch);
  }
  offerHistory() {
    const imported = this.store.db
      .prepare(
        "SELECT document FROM tariff_batches WHERE json_extract(document,'$.status')='applied' AND json_extract(document,'$.target')='supplier-offer' ORDER BY rowid DESC LIMIT 1000",
      )
      .all()
      .flatMap((row) => {
        const batch = JSON.parse(String(row.document)) as TariffBatch;
        return batch.changes.map((change) => ({
          supplierId: batch.supplierId,
          productId: change.productId,
          beforeCostCents: change.beforeCostCents,
          afterCostCents: change.afterCostCents,
          version: change.baseVersion + 1,
          at: batch.appliedAt!,
          actor: batch.appliedBy!,
          createdBy: batch.createdBy,
          reason: batch.reason ?? null,
          origin: batch.source?.filename ?? 'CSV manual',
          reference: batch.reference,
          sourceId: batch.source?.id ?? null,
        }));
      });
    const manual = this.store.db
      .prepare(
        "SELECT actor,at,detail FROM audit WHERE action='supplier.offer-saved' ORDER BY seq DESC LIMIT 1000",
      )
      .all()
      .map((row) => {
        const detail = JSON.parse(String(row.detail)) as {
          supplierId: string;
          productId: string;
          costCents: number;
          expectedVersion: number;
          beforeCostCents?: number | null;
          reason?: string;
        };
        return {
          supplierId: detail.supplierId,
          productId: detail.productId,
          beforeCostCents: detail.beforeCostCents ?? null,
          afterCostCents: detail.costCents,
          version: detail.expectedVersion + 1,
          at: String(row.at),
          actor: String(row.actor),
          createdBy: String(row.actor),
          reason: detail.reason ?? null,
          origin: 'Edición manual en Proveedores',
          reference: 'Ficha de oferta',
          sourceId: null,
        };
      });
    return [...imported, ...manual].sort(
      (a, b) => b.at.localeCompare(a.at) || b.version - a.version,
    );
  }
  save(value: TariffBatch) {
    this.store.db
      .prepare(
        'INSERT INTO tariff_batches VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document',
      )
      .run(value.id, value.supplierId, value.reference.toLowerCase(), JSON.stringify(value));
  }
  updateCost(c: TariffChange) {
    return (
      this.store.db
        .prepare(
          'UPDATE products SET costCents=?,version=version+1 WHERE id=? AND active=1 AND version=? AND priceCents=? AND costCents=?',
        )
        .run(c.afterCostCents, c.productId, c.baseVersion, c.priceCents, c.beforeCostCents)
        .changes === 1
    );
  }
  transaction<T>(op: () => T) {
    return this.store.transaction(op);
  }
  record(actor: string, action: string, detail: unknown) {
    this.store.record(actor, action, detail);
  }
}
