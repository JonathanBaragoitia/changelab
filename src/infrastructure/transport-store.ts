import type { TransportDamage, TransportRepository } from '../application/transport-damage.ts';
import type { Purchase } from '../application/operations.ts';
import type { Store } from './store.ts';
import { sha } from './store.ts';
import type { Receipt } from '../application/receiving.ts';
import { fail } from '../domain/catalog.ts';
function readDamage(raw: unknown, id: string): TransportDamage {
  const invalid = () =>
    fail(
      500,
      'CORRUPT_TRANSPORT',
      'Registro de transporte incoherente. No se ha aplicado ninguna operación; revisa una copia verificada.',
    );
  let value: unknown;
  try {
    value = JSON.parse(String(raw));
  } catch {
    return invalid();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  const text = (key: string, max: number, min = 1) =>
    typeof row[key] === 'string' &&
    (row[key] as string).length >= min &&
    (row[key] as string).length <= max;
  if (
    row.id !== id ||
    !text('id', 80, 16) ||
    !text('purchaseId', 80) ||
    !text('productId', 80) ||
    !Number.isSafeInteger(row.quantity) ||
    Number(row.quantity) < 1 ||
    Number(row.quantity) > 10000 ||
    typeof row.inStock !== 'boolean' ||
    !text('reference', 100) ||
    !text('reason', 300, 5) ||
    !text('createdBy', 80) ||
    !text('createdAt', 40) ||
    !Number.isFinite(Date.parse(String(row.createdAt))) ||
    !['open', 'resolved'].includes(String(row.status))
  )
    return invalid();
  if (
    row.status === 'resolved' &&
    (!text('resolution', 300, 5) ||
      !text('resolvedBy', 80) ||
      !text('resolvedAt', 40) ||
      !Number.isFinite(Date.parse(String(row.resolvedAt))))
  )
    return invalid();
  if (row.outcome !== undefined) {
    const outcome = row.outcome as Record<string, unknown> | null;
    if (
      row.status !== 'resolved' ||
      !outcome ||
      typeof outcome.reference !== 'string' ||
      !outcome.reference.length ||
      outcome.reference.length > 100 ||
      (outcome.kind === 'credit'
        ? !Number.isSafeInteger(outcome.amountCents) ||
          Number(outcome.amountCents) < 1 ||
          Number(outcome.amountCents) > 100_000_000
        : outcome.kind !== 'replacement' ||
          typeof outcome.receiptId !== 'string' ||
          !outcome.receiptId.length ||
          outcome.receiptId.length > 80)
    )
      return invalid();
  }
  return value as TransportDamage;
}
export class TransportStore implements TransportRepository {
  private store: Store;
  private findPurchase: (id: string) => Purchase | undefined;
  constructor(store: Store, findPurchase: (id: string) => Purchase | undefined) {
    this.store = store;
    this.findPurchase = findPurchase;
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS transport_damages(id TEXT PRIMARY KEY,document TEXT NOT NULL)',
    );
  }
  all() {
    return this.store.db
      .prepare('SELECT id,document FROM transport_damages ORDER BY rowid DESC')
      .all()
      .map((r) => readDamage(r.document, String(r.id)))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  get(id: string) {
    const row = this.store.db.prepare('SELECT document FROM transport_damages WHERE id=?').get(id);
    return row ? readDamage(row.document, id) : undefined;
  }
  save(value: TransportDamage) {
    this.store.db
      .prepare(
        'INSERT INTO transport_damages VALUES(?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document',
      )
      .run(value.id, JSON.stringify(value));
  }
  purchase(id: string) {
    return this.findPurchase(id);
  }
  availableReceipt(id: string) {
    const row = this.store.db
      .prepare(
        'SELECT r.document FROM stock_receipts r WHERE r.id=? AND NOT EXISTS (SELECT 1 FROM receipt_cancellations c WHERE c.receiptId=r.id)',
      )
      .get(id);
    return row ? (JSON.parse(String(row.document)) as Receipt) : undefined;
  }
  replacementReceipts(damage: TransportDamage, supplierId: string) {
    return this.store.db
      .prepare(
        `SELECT r.document FROM stock_receipts r
      WHERE r.productId=? AND json_extract(r.document,'$.supplierId')=?
        AND json_extract(r.document,'$.quantity')=? AND json_extract(r.document,'$.at')>=?
        AND NOT EXISTS (SELECT 1 FROM receipt_cancellations c WHERE c.receiptId=r.id)
      ORDER BY r.rowid DESC`,
      )
      .all(damage.productId, supplierId, damage.quantity, damage.createdAt)
      .map((row) => JSON.parse(String(row.document)) as Receipt);
  }
  private receiptRequests(p: Purchase, productId: string, includeCancelled = true) {
    return p.deliveries
      ? p.deliveries
          .filter((d) =>
            d.lines.some(
              (l) => l.productId === productId && (includeCancelled || !l.cancelledReceiptId),
            ),
          )
          .map((d) =>
            d.legacy
              ? sha({ purchaseId: p.id, productId })
              : sha({ purchaseId: p.id, productId, deliveryId: d.id }),
          )
      : [sha({ purchaseId: p.id, productId })];
  }
  hasCancelledReceipt(purchaseId: string, productId: string) {
    const p = this.purchase(purchaseId);
    return (
      !!p &&
      this.receiptRequests(p, productId, false).some((request) =>
        this.store.db
          .prepare(
            'SELECT 1 FROM stock_receipts r JOIN receipt_cancellations c ON c.receiptId=r.id WHERE r.requestId=?',
          )
          .get(request),
      )
    );
  }
  purchaseForReceipt(receipt: Receipt) {
    const ids = this.store.db
      .prepare("SELECT id FROM operation_documents WHERE kind='purchase'")
      .all();
    return ids
      .map((r) => this.purchase(String(r.id)))
      .find((p) => p && this.receiptRequests(p, receipt.productId).includes(receipt.requestId))?.id;
  }
  transaction<T>(op: () => T) {
    return this.store.transaction(op);
  }
  record(actor: string, action: string, detail: unknown) {
    this.store.record(actor, action, detail);
  }
}
