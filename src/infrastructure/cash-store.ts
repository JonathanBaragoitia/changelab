import { returnedValue, remainingSale } from '../application/partial-returns.ts';
import { readCashEntry, readCashReversal, readRefund, readRefundReversal } from './cash-records.ts';
import type { RefundReversal } from '../application/refund-reversal.ts';
import type { Refund } from '../application/refunds.ts';
import { fail } from '../domain/catalog.ts';
import type { CashEntry, CashRepository } from '../application/cash.ts';
import type { CashReversal } from '../application/cash-reversal.ts';
import type { Store } from './store.ts';
import type { CommerceStore } from './commerce-store.ts';
import type { ExpenseStore } from './expense-store.ts';
export class CashStore implements CashRepository {
  private store: Store;
  private commerce: CommerceStore;
  private expenses: ExpenseStore;
  constructor(store: Store, commerce: CommerceStore, expenses: ExpenseStore) {
    this.store = store;
    this.commerce = commerce;
    this.expenses = expenses;
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS refund_reversals(refundId TEXT PRIMARY KEY,document TEXT NOT NULL); CREATE TABLE IF NOT EXISTS cash_refunds(requestId TEXT PRIMARY KEY,reference TEXT UNIQUE NOT NULL,document TEXT NOT NULL); CREATE TABLE IF NOT EXISTS cash_entries(requestId TEXT PRIMARY KEY,reference TEXT UNIQUE NOT NULL,document TEXT NOT NULL); CREATE TABLE IF NOT EXISTS cash_reversals(entryId TEXT PRIMARY KEY REFERENCES cash_entries(requestId),document TEXT NOT NULL)',
    );
  }
  transaction<T>(operation: () => T): T {
    return this.store.transaction(operation);
  }
  record(actor: string, action: string, detail: unknown) {
    this.store.record(actor, action, detail);
  }
  entry(id: string): CashEntry | undefined {
    const row = this.store.db
      .prepare('SELECT document FROM cash_entries WHERE requestId=?')
      .get(id);
    return row ? readCashEntry(row.document, id) : undefined;
  }
  referenceExists(reference: string) {
    return !!this.store.db
      .prepare(
        'SELECT requestId FROM cash_entries WHERE reference=? UNION SELECT requestId FROM cash_refunds WHERE reference=?',
      )
      .get(reference.toLowerCase(), reference.toLowerCase());
  }
  all(): CashEntry[] {
    return this.store.db
      .prepare('SELECT requestId,document FROM cash_entries ORDER BY rowid DESC')
      .all()
      .map((row) => readCashEntry(row.document, String(row.requestId)));
  }
  target(kind: CashEntry['kind'], id: string) {
    if (kind === 'collection') {
      const sale = this.commerce.sale(id);
      return sale
        ? {
            totalCents:
              (remainingSale(sale).tax?.totalCents ?? remainingSale(sale).totalCents) +
              this.activeRefunds()
                .filter((r) => r.orderId === id)
                .reduce((sum, r) => sum + r.amountCents, 0),
            enabled: !['cancelled', 'returned'].includes(sale.status ?? ''),
          }
        : undefined;
    }
    const expense = this.expenses.expenseByRequest(id);
    return expense
      ? { totalCents: expense.totalCents, enabled: !this.expenses.cancellation(id) }
      : undefined;
  }
  settled(kind: CashEntry['kind'], id: string) {
    return this.active()
      .filter((e) => e.kind === kind && e.targetId === id)
      .reduce((sum, e) => sum + e.amountCents, 0);
  }
  save(entry: CashEntry) {
    this.store.db
      .prepare('INSERT INTO cash_entries VALUES(?,?,?)')
      .run(entry.requestId, entry.reference.toLowerCase(), JSON.stringify(entry));
  }

  reversal(id: string): CashReversal | undefined {
    const row = this.store.db
      .prepare('SELECT document FROM cash_reversals WHERE entryId=?')
      .get(id);
    return row ? readCashReversal(row.document, id) : undefined;
  }
  refund(id: string): Refund | undefined {
    const row = this.store.db
      .prepare('SELECT document FROM cash_refunds WHERE requestId=?')
      .get(id);
    return row ? readRefund(row.document, id) : undefined;
  }
  refunds(): Refund[] {
    return this.store.db
      .prepare('SELECT requestId,document FROM cash_refunds ORDER BY rowid DESC')
      .all()
      .map((row) => readRefund(row.document, String(row.requestId)));
  }
  refundReversal(id: string): RefundReversal | undefined {
    const row = this.store.db
      .prepare('SELECT document FROM refund_reversals WHERE refundId=?')
      .get(id);
    return row ? readRefundReversal(row.document, id) : undefined;
  }
  saveRefundReversal(value: RefundReversal) {
    this.store.db
      .prepare('INSERT INTO refund_reversals VALUES(?,?)')
      .run(value.refundId, JSON.stringify(value));
  }
  activeRefunds() {
    return this.refunds().filter((r) => !this.refundReversal(r.requestId));
  }
  refundable(id: string) {
    const sale = this.commerce.sale(id);
    if (
      !sale ||
      (!['cancelled', 'returned'].includes(sale.status ?? '') && !sale.returnedQuantities?.length)
    )
      return undefined;
    return (
      Math.min(
        this.settled('collection', id),
        ['cancelled', 'returned'].includes(sale.status ?? '')
          ? this.settled('collection', id)
          : returnedValue(sale),
      ) -
      this.activeRefunds()
        .filter((r) => r.orderId === id)
        .reduce((s, r) => s + r.amountCents, 0)
    );
  }
  saveRefund(value: Refund) {
    this.store.db
      .prepare('INSERT INTO cash_refunds VALUES(?,?,?)')
      .run(value.requestId, value.reference.toLowerCase(), JSON.stringify(value));
  }
  saveReversal(reversal: CashReversal) {
    const entry = this.entry(reversal.entryId)!;
    if (
      entry.kind === 'collection' &&
      this.settled('collection', entry.targetId) - entry.amountCents <
        this.activeRefunds()
          .filter((r) => r.orderId === entry.targetId)
          .reduce((s, r) => s + r.amountCents, 0)
    )
      fail(
        409,
        'REFUND_LINKED',
        'No se puede anular un cobro que respalda reembolsos registrados.',
      );
    this.store.db
      .prepare('INSERT INTO cash_reversals VALUES(?,?)')
      .run(reversal.entryId, JSON.stringify(reversal));
  }
  active() {
    return this.all().filter((entry) => !this.reversal(entry.requestId));
  }
  report() {
    const entries = this.active();
    const targets = [
      ...this.commerce.snapshot().sales.map((sale) => ({
        refundableCents: this.refundable(sale.id) ?? 0,
        kind: 'collection' as const,
        id: sale.id,
        label: 'Pedido ' + sale.id,
        totalCents: ['cancelled', 'returned'].includes(sale.status ?? '')
          ? 0
          : (remainingSale(sale).tax?.totalCents ?? remainingSale(sale).totalCents),
        enabled: !['cancelled', 'returned'].includes(sale.status ?? ''),
      })),
      ...this.expenses.all().map((e) => ({
        kind: 'payment' as const,
        id: e.requestId,
        label: 'Gasto ' + e.reference,
        totalCents: e.cancellation ? 0 : e.totalCents,
        enabled: !e.cancellation,
      })),
    ].map((target) => {
      const collectedForTarget = entries
        .filter((e) => e.kind === target.kind && e.targetId === target.id)
        .reduce((sum, e) => sum + e.amountCents, 0);
      const refundedCents =
        target.kind === 'collection'
          ? this.activeRefunds()
              .filter((r) => r.orderId === target.id)
              .reduce((s, r) => s + r.amountCents, 0)
          : 0;
      const settledCents = collectedForTarget - refundedCents;
      return {
        ...target,
        settledCents,
        refundedCents,
        pendingCents: target.totalCents - settledCents,
      };
    });
    const collectedCents = entries
        .filter((e) => e.kind === 'collection')
        .reduce((sum, e) => sum + e.amountCents, 0),
      paidCents = entries
        .filter((e) => e.kind === 'payment')
        .reduce((sum, e) => sum + e.amountCents, 0);
    return {
      entries: this.all().map((entry) => ({ ...entry, reversal: this.reversal(entry.requestId) })),
      targets,
      refunds: this.refunds().map((r) => ({ ...r, reversal: this.refundReversal(r.requestId) })),
      refundedCents: this.activeRefunds().reduce((s, r) => s + r.amountCents, 0),
      collectedCents,
      paidCents,
      balanceCents:
        collectedCents - paidCents - this.activeRefunds().reduce((s, r) => s + r.amountCents, 0),
    };
  }
}
