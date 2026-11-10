import { needsOwnerDecision, type CompanyActor } from './company-roles.ts';
import { fail } from '../domain/catalog.ts';
import { validDate } from './economics.ts';
export type Refund = {
  requestId: string;
  orderId: string;
  amountCents: number;
  date: string;
  reference: string;
  reason: string;
  actorId: string;
};
export interface RefundRepository {
  transaction<T>(op: () => T): T;
  refund(id: string): Refund | undefined;
  refunds(): Refund[];
  referenceExists(value: string): boolean;
  refundable(id: string): number | undefined;
  saveRefund(value: Refund): void;
  record(actor: string, action: string, detail: unknown): void;
}
export class RegisterRefund {
  repo: RefundRepository;
  constructor(repo: RefundRepository) {
    this.repo = repo;
  }
  execute(actor: CompanyActor, input: unknown) {
    if (needsOwnerDecision(actor))
      fail(403, 'OWNER_APPROVAL_REQUIRED', 'Esta decisión económica corresponde a dirección.');
    if (actor.role !== 'editor') fail(403, 'FORBIDDEN', 'Solo edición puede registrar reembolsos.');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail(400, 'INVALID_REFUND', 'Reembolso no válido.');
    const v = input as Record<string, unknown>;
    if (
      Object.keys(v).some(
        (k) => !['requestId', 'orderId', 'amountCents', 'date', 'reference', 'reason'].includes(k),
      ) ||
      typeof v.requestId !== 'string' ||
      !/^[a-zA-Z0-9-]{16,80}$/.test(v.requestId) ||
      typeof v.orderId !== 'string' ||
      !v.orderId ||
      !Number.isSafeInteger(v.amountCents) ||
      (v.amountCents as number) < 1 ||
      (v.amountCents as number) > 100000000 ||
      !validDate(v.date) ||
      typeof v.reference !== 'string' ||
      !v.reference.trim() ||
      v.reference.length > 100 ||
      typeof v.reason !== 'string' ||
      v.reason.trim().length < 5 ||
      v.reason.length > 300
    )
      fail(400, 'INVALID_REFUND', 'Revisa pedido, importe, fecha, referencia y motivo.');
    const value: Refund = {
      requestId: v.requestId,
      orderId: v.orderId,
      amountCents: v.amountCents as number,
      date: v.date,
      reference: v.reference.trim(),
      reason: v.reason.trim(),
      actorId: actor.id,
    };
    return this.repo.transaction(() => {
      const prior = this.repo.refund(value.requestId);
      if (prior) {
        if (JSON.stringify(prior) !== JSON.stringify(value))
          fail(409, 'REFUND_REUSED', 'Operación reutilizada con otros datos.');
        return prior;
      }
      if (
        this.repo.referenceExists(value.reference) ||
        this.repo.refunds().some((r) => r.reference.toLowerCase() === value.reference.toLowerCase())
      )
        fail(409, 'DUPLICATE_REFUND', 'Referencia ya utilizada.');
      const available = this.repo.refundable(value.orderId);
      if (available === undefined)
        fail(
          409,
          'REFUND_TARGET',
          'Solo pedidos cancelados o devueltos admiten este reembolso de prueba.',
        );
      if (value.amountCents > available)
        fail(409, 'EXCESS_REFUND', 'Supera los cobros activos pendientes de reembolsar.');
      this.repo.saveRefund(value);
      this.repo.record(actor.id, 'cash.refunded', value);
      return value;
    });
  }
}
