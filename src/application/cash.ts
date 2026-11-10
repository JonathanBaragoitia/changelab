import { fail } from '../domain/catalog.ts';
import { validDate } from './economics.ts';
export type CashEntry = {
  requestId: string;
  kind: 'collection' | 'payment';
  targetId: string;
  amountCents: number;
  date: string;
  reference: string;
  method: string;
  actorId: string;
};
export interface CashRepository {
  transaction<T>(operation: () => T): T;
  entry(id: string): CashEntry | undefined;
  referenceExists(reference: string): boolean;
  target(
    kind: 'collection' | 'payment',
    id: string,
  ): { totalCents: number; enabled: boolean } | undefined;
  settled(kind: 'collection' | 'payment', id: string): number;
  save(entry: CashEntry): void;
  record(actor: string, action: string, detail: unknown): void;
}
export class RegisterCash {
  private repository: CashRepository;
  constructor(repository: CashRepository) {
    this.repository = repository;
  }
  execute(actor: { id: string; role: string }, input: unknown): CashEntry {
    if (actor.role !== 'editor')
      fail(403, 'FORBIDDEN', 'Solo una cuenta editora puede registrar cobros y pagos.');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail(400, 'INVALID_CASH', 'Movimiento no válido.');
    const v = input as Record<string, unknown>;
    if (
      Object.keys(v).some(
        (key) =>
          !['requestId', 'kind', 'targetId', 'amountCents', 'date', 'reference', 'method'].includes(
            key,
          ),
      ) ||
      typeof v.requestId !== 'string' ||
      !/^[a-zA-Z0-9-]{16,80}$/.test(v.requestId) ||
      !['collection', 'payment'].includes(v.kind as string) ||
      typeof v.targetId !== 'string' ||
      !v.targetId ||
      !Number.isSafeInteger(v.amountCents) ||
      (v.amountCents as number) < 1 ||
      (v.amountCents as number) > 100000000 ||
      !validDate(v.date) ||
      typeof v.reference !== 'string' ||
      !v.reference.trim() ||
      v.reference.length > 100 ||
      !['Transferencia', 'Tarjeta', 'Efectivo', 'Otro'].includes(v.method as string)
    )
      fail(400, 'INVALID_CASH', 'Revisa destino, importe, fecha, referencia y medio.');
    const entry: CashEntry = {
      requestId: v.requestId,
      kind: v.kind as CashEntry['kind'],
      targetId: v.targetId,
      amountCents: v.amountCents as number,
      date: v.date,
      reference: v.reference.trim(),
      method: v.method as string,
      actorId: actor.id,
    };
    return this.repository.transaction(() => {
      const previous = this.repository.entry(entry.requestId);
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(entry))
          fail(409, 'CASH_REUSED', 'La operación ya se registró con otros datos.');
        return previous;
      }
      if (this.repository.referenceExists(entry.reference))
        fail(409, 'DUPLICATE_CASH', 'La referencia del movimiento ya existe.');
      const target = this.repository.target(entry.kind, entry.targetId);
      if (!target || !target.enabled)
        fail(409, 'CASH_TARGET', 'El destino no existe o no admite movimientos.');
      if (
        this.repository.settled(entry.kind, entry.targetId) + entry.amountCents >
        target.totalCents
      )
        fail(409, 'EXCESS_CASH', 'El importe supera la cantidad pendiente.');
      this.repository.save(entry);
      this.repository.record(actor.id, 'cash.registered', {
        kind: entry.kind,
        targetId: entry.targetId,
        amountCents: entry.amountCents,
        date: entry.date,
        reference: entry.reference,
      });
      return entry;
    });
  }
}
