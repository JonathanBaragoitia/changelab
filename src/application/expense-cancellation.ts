import { needsOwnerDecision, type CompanyActor } from './company-roles.ts';
import { fail } from '../domain/catalog.ts';
import type { Expense } from './economics.ts';
export type ExpenseCancellation = {
  expenseId: string;
  reason: string;
  actorId: string;
  createdAt: string;
};
export interface ExpenseCancellationRepository {
  transaction<T>(operation: () => T): T;
  expenseByRequest(id: string): Expense | undefined;
  cancellation(id: string): ExpenseCancellation | undefined;
  saveCancellation(value: ExpenseCancellation): void;
  record(actor: string, action: string, detail: unknown): void;
}
export class CancelExpense {
  repo: ExpenseCancellationRepository;
  settled: (id: string) => number;
  constructor(repo: ExpenseCancellationRepository, settled: (id: string) => number) {
    this.repo = repo;
    this.settled = settled;
  }
  execute(actor: CompanyActor, expenseId: string, input: unknown) {
    if (needsOwnerDecision(actor))
      fail(403, 'OWNER_APPROVAL_REQUIRED', 'Esta decisión económica corresponde a dirección.');
    if (actor.role !== 'editor')
      fail(403, 'FORBIDDEN', 'Solo una cuenta editora puede anular gastos.');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail(400, 'INVALID_CANCELLATION', 'Indica el motivo.');
    const v = input as Record<string, unknown>;
    if (
      Object.keys(v).join(',') !== 'reason' ||
      typeof v.reason !== 'string' ||
      v.reason.trim().length < 5 ||
      v.reason.length > 300
    )
      fail(400, 'INVALID_CANCELLATION', 'Indica un motivo entre 5 y 300 caracteres.');
    const reason = v.reason.trim();
    return this.repo.transaction(() => {
      const expense = this.repo.expenseByRequest(expenseId);
      if (!expense) fail(404, 'EXPENSE_NOT_FOUND', 'Gasto no encontrado.');
      const existing = this.repo.cancellation(expenseId);
      if (existing) {
        if (existing.reason !== reason || existing.actorId !== actor.id)
          fail(409, 'EXPENSE_CANCELLED', 'El gasto ya fue anulado con otro motivo o autor.');
        return existing;
      }
      if (this.settled(expenseId) !== 0)
        fail(
          409,
          'EXPENSE_HAS_PAYMENTS',
          'El gasto tiene pagos activos. Acláralos antes de anular; no se devuelve dinero automáticamente.',
        );
      const cancellation = {
        expenseId,
        reason,
        actorId: actor.id,
        createdAt: new Date().toISOString(),
      };
      this.repo.saveCancellation(cancellation);
      this.repo.record(actor.id, 'expense.cancelled', {
        ...cancellation,
        reference: expense.reference,
        baseCents: expense.baseCents,
        totalCents: expense.totalCents,
      });
      return cancellation;
    });
  }
}
