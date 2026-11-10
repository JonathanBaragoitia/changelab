import { needsOwnerDecision, type CompanyActor } from './company-roles.ts';
import { remainingSale } from './partial-returns.ts';
import type { ExpenseCancellation } from './expense-cancellation.ts';
import { fail } from '../domain/catalog.ts';
import type { Sale } from './commerce.ts';
export type Expense = {
  cancellation?: ExpenseCancellation;
  requestId: string;
  date: string;
  reference: string;
  category: string;
  description: string;
  baseCents: number;
  vatRate: 0 | 21;
  taxCents: number;
  totalCents: number;
  actorId: string;
};
export function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function period(from: unknown, to: unknown) {
  if (!validDate(from) || !validDate(to) || from > to)
    fail(400, 'INVALID_PERIOD', 'Selecciona un periodo válido (desde y hasta).');
  return { from, to };
}
export function businessDate(value: string) {
  const parts = new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Europe/Madrid',
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return get('year') + '-' + get('month') + '-' + get('day');
}
export function economicReport(sales: Sale[], expenses: Expense[], from: string, to: string) {
  period(from, to);
  const selected = sales.filter((sale) => {
    const date = businessDate(sale.createdAt);
    return date >= from && date <= to && !['cancelled', 'returned'].includes(sale.status ?? '');
  });
  const measured = selected.filter((sale) => sale.tax).map(remainingSale);
  const periodExpenses = expenses.filter((expense) => expense.date >= from && expense.date <= to);
  const includedExpenses = periodExpenses.filter((expense) => !expense.cancellation);
  const revenueCents = measured.reduce((sum, sale) => sum + sale.tax!.baseCents, 0),
    costCents = measured.reduce((sum, sale) => sum + sale.costCents, 0);
  const expenseCents = includedExpenses.reduce((sum, expense) => sum + expense.baseCents, 0);
  return {
    from,
    to,
    orders: measured.length,
    excludedHistoricalOrders: selected.length - measured.length,
    revenueCents,
    costCents,
    grossMarginCents: revenueCents - costCents,
    expenseCents,
    operatingResultCents: revenueCents - costCents - expenseCents,
    expenses: includedExpenses,
    cancelledExpenses: periodExpenses.filter((expense) => expense.cancellation),
  };
}
export interface ExpenseRepository {
  transaction<T>(operation: () => T): T;
  expenseByRequest(id: string): Expense | undefined;
  expenseByReference(reference: string): Expense | undefined;
  saveExpense(expense: Expense): void;
  record(actor: string, action: string, detail: unknown): void;
}
export class RegisterExpense {
  private repository: ExpenseRepository;
  constructor(repository: ExpenseRepository) {
    this.repository = repository;
  }
  execute(
    actor: CompanyActor,
    input: unknown,
    approval?: { approvalId: string; approvedBy: string },
  ): Expense {
    if (actor.role !== 'editor')
      fail(403, 'FORBIDDEN', 'Solo una cuenta editora puede registrar gastos.');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail(400, 'INVALID_EXPENSE', 'Gasto no válido.');
    const v = input as Record<string, unknown>;
    if (
      needsOwnerDecision(actor) &&
      (!approval || approval.approvalId !== v.requestId || !approval.approvedBy)
    )
      fail(403, 'OWNER_APPROVAL_REQUIRED', 'Antonio debe aprobar el gasto antes de registrarlo.');
    if (
      Object.keys(v).some(
        (key) =>
          ![
            'requestId',
            'date',
            'reference',
            'category',
            'description',
            'baseCents',
            'vatRate',
          ].includes(key),
      ) ||
      typeof v.requestId !== 'string' ||
      !/^[a-zA-Z0-9-]{16,80}$/.test(v.requestId) ||
      !validDate(v.date) ||
      typeof v.reference !== 'string' ||
      !v.reference.trim() ||
      v.reference.length > 100 ||
      !['Alquiler', 'Suministros', 'Servicios', 'Otros gastos operativos'].includes(
        v.category as string,
      ) ||
      typeof v.description !== 'string' ||
      v.description.trim().length < 5 ||
      v.description.length > 300 ||
      !Number.isSafeInteger(v.baseCents) ||
      (v.baseCents as number) < 1 ||
      (v.baseCents as number) > 100000000 ||
      ![0, 21].includes(v.vatRate as number)
    )
      fail(400, 'INVALID_EXPENSE', 'Revisa fecha, referencia, categoría, concepto e importe.');
    const baseCents = v.baseCents as number,
      vatRate = v.vatRate as 0 | 21,
      taxCents = Math.round((baseCents * vatRate) / 100);
    const expense: Expense = {
      requestId: v.requestId,
      date: v.date,
      reference: (v.reference as string).trim(),
      category: v.category as string,
      description: (v.description as string).trim(),
      baseCents,
      vatRate,
      taxCents,
      totalCents: baseCents + taxCents,
      actorId: actor.id,
    };
    return this.repository.transaction(() => {
      const existing = this.repository.expenseByRequest(expense.requestId);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(expense))
          fail(409, 'EXPENSE_REUSED', 'La operación ya se registró con otros datos.');
        return existing;
      }
      if (this.repository.expenseByReference(expense.reference))
        fail(409, 'DUPLICATE_EXPENSE', 'La referencia de gasto ya existe.');
      this.repository.saveExpense(expense);
      this.repository.record(actor.id, 'expense.registered', {
        reference: expense.reference,
        baseCents,
        totalCents: expense.totalCents,
        date: expense.date,
        category: expense.category,
      });
      return expense;
    });
  }
}
