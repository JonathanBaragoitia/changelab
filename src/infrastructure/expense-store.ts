import type { ExpenseCancellation } from '../application/expense-cancellation.ts';
import type { Expense, ExpenseRepository } from '../application/economics.ts';
import type { Store } from './store.ts';
export class ExpenseStore implements ExpenseRepository {
  private store: Store;
  constructor(store: Store) {
    this.store = store;
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS expenses(requestId TEXT PRIMARY KEY,reference TEXT UNIQUE NOT NULL,document TEXT NOT NULL); CREATE TABLE IF NOT EXISTS expense_cancellations(expenseId TEXT PRIMARY KEY REFERENCES expenses(requestId),document TEXT NOT NULL)',
    );
  }
  transaction<T>(operation: () => T): T {
    return this.store.transaction(operation);
  }
  record(actor: string, action: string, detail: unknown) {
    this.store.record(actor, action, detail);
  }
  expenseByRequest(id: string): Expense | undefined {
    const row = this.store.db.prepare('SELECT document FROM expenses WHERE requestId=?').get(id);
    return row ? (JSON.parse(row.document as string) as Expense) : undefined;
  }
  expenseByReference(reference: string): Expense | undefined {
    const row = this.store.db
      .prepare('SELECT document FROM expenses WHERE reference=?')
      .get(reference.toLowerCase());
    return row ? (JSON.parse(row.document as string) as Expense) : undefined;
  }
  saveExpense(expense: Expense) {
    this.store.db
      .prepare('INSERT INTO expenses VALUES(?,?,?)')
      .run(expense.requestId, expense.reference.toLowerCase(), JSON.stringify(expense));
  }
  cancellation(id: string): ExpenseCancellation | undefined {
    const row = this.store.db
      .prepare('SELECT document FROM expense_cancellations WHERE expenseId=?')
      .get(id);
    return row ? (JSON.parse(String(row.document)) as ExpenseCancellation) : undefined;
  }
  saveCancellation(value: ExpenseCancellation) {
    this.store.db
      .prepare('INSERT INTO expense_cancellations VALUES(?,?)')
      .run(value.expenseId, JSON.stringify(value));
  }
  all(): Expense[] {
    return this.store.db
      .prepare('SELECT document FROM expenses ORDER BY rowid DESC')
      .all()
      .map((row) => {
        const expense = JSON.parse(row.document as string) as Expense;
        const cancellation = this.cancellation(expense.requestId);
        return cancellation ? { ...expense, cancellation } : expense;
      });
  }
}
