import { needsOwnerDecision, type CompanyActor } from './company-roles.ts';
import { fail } from '../domain/catalog.ts';
import type { CashEntry } from './cash.ts';
export type CashReversal = { entryId: string; reason: string; actorId: string; at: string };
export interface ReversalRepository {
  transaction<T>(operation: () => T): T;
  entry(id: string): CashEntry | undefined;
  reversal(id: string): CashReversal | undefined;
  saveReversal(reversal: CashReversal): void;
  record(actor: string, action: string, detail: unknown): void;
}
export class ReverseCash {
  private repository: ReversalRepository;
  private now: () => string;
  constructor(repository: ReversalRepository, now: () => string) {
    this.repository = repository;
    this.now = now;
  }
  execute(actor: CompanyActor, entryId: string, input: unknown): CashReversal {
    if (needsOwnerDecision(actor))
      fail(403, 'OWNER_APPROVAL_REQUIRED', 'Esta decisión económica corresponde a dirección.');
    if (actor.role !== 'editor')
      fail(403, 'FORBIDDEN', 'Solo una cuenta editora puede anular anotaciones.');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail(400, 'INVALID_REVERSAL', 'Anulación no válida.');
    const body = input as Record<string, unknown>;
    if (
      Object.keys(body).some((key) => key !== 'reason') ||
      typeof body.reason !== 'string' ||
      body.reason.trim().length < 5 ||
      body.reason.length > 500
    )
      fail(400, 'INVALID_REVERSAL', 'Indica un motivo de entre 5 y 500 caracteres.');
    const reason = body.reason.trim();
    return this.repository.transaction(() => {
      const entry = this.repository.entry(entryId);
      if (!entry) fail(404, 'CASH_NOT_FOUND', 'Anotación no encontrada.');
      const previous = this.repository.reversal(entryId);
      if (previous) {
        if (previous.reason !== reason)
          fail(409, 'ALREADY_REVERSED', 'La anotación ya fue anulada con otro motivo.');
        return previous;
      }
      const reversal = { entryId, reason, actorId: actor.id, at: this.now() };
      this.repository.saveReversal(reversal);
      this.repository.record(actor.id, 'cash.reversed', {
        entryId,
        reason,
        reference: entry.reference,
        amountCents: entry.amountCents,
        kind: entry.kind,
      });
      return reversal;
    });
  }
}
