import { needsOwnerDecision, type CompanyActor } from './company-roles.ts';
import { fail } from '../domain/catalog.ts';
import type { Refund } from './refunds.ts';
export type RefundReversal = { refundId: string; reason: string; actorId: string; at: string };
export interface RefundReversalRepository {
  transaction<T>(op: () => T): T;
  refund(id: string): Refund | undefined;
  refundReversal(id: string): RefundReversal | undefined;
  saveRefundReversal(value: RefundReversal): void;
  record(actor: string, action: string, detail: unknown): void;
}
export class ReverseRefund {
  repo: RefundReversalRepository;
  constructor(repo: RefundReversalRepository) {
    this.repo = repo;
  }
  execute(actor: CompanyActor, refundId: string, input: unknown) {
    if (needsOwnerDecision(actor))
      fail(403, 'OWNER_APPROVAL_REQUIRED', 'Esta decisión económica corresponde a dirección.');
    if (actor.role !== 'editor') fail(403, 'FORBIDDEN', 'Solo edición puede corregir reembolsos.');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail(400, 'INVALID_REFUND_REVERSAL', 'Indica un motivo.');
    const v = input as Record<string, unknown>;
    if (
      Object.keys(v).join(',') !== 'reason' ||
      typeof v.reason !== 'string' ||
      v.reason.trim().length < 5 ||
      v.reason.length > 300
    )
      fail(400, 'INVALID_REFUND_REVERSAL', 'Indica un motivo entre 5 y 300 caracteres.');
    const reason = v.reason.trim();
    return this.repo.transaction(() => {
      const original = this.repo.refund(refundId);
      if (!original) fail(404, 'REFUND_NOT_FOUND', 'Reembolso no encontrado.');
      const prior = this.repo.refundReversal(refundId);
      if (prior) {
        if (prior.reason !== reason || prior.actorId !== actor.id)
          fail(409, 'REFUND_ALREADY_REVERSED', 'Reembolso ya corregido con otro motivo o autor.');
        return prior;
      }
      const value = { refundId, reason, actorId: actor.id, at: new Date().toISOString() };
      this.repo.saveRefundReversal(value);
      this.repo.record(actor.id, 'cash.refund-reversed', {
        ...value,
        orderId: original.orderId,
        reference: original.reference,
        amountCents: original.amountCents,
      });
      return value;
    });
  }
}
