import { canApprove, canApproveOwn, type CompanyActor } from './company-roles.ts';
import { fail } from '../domain/catalog.ts';
import { fields, text, integer, type Actor } from './operations.ts';
export type Approval = {
  purchaseId?: string;
  id: string;
  author: string;
  kind: 'expense' | 'purchase';
  category: string;
  description: string;
  cents: number;
  status: 'pending' | 'approved' | 'rejected';
  at: string;
  decision?: { actor: string; at: string; reason: string };
  expenseId?: string;
};
export interface ApprovalRepository {
  transaction<T>(work: () => T): T;
  get(id: string): Approval | undefined;
  save(value: Approval): void;
  notify(value: Approval): void;
  record(actor: string, action: string, detail: unknown): void;
}
export class Approvals {
  private repo: ApprovalRepository;
  private now: () => string;
  constructor(repo: ApprovalRepository, now: () => string) {
    this.repo = repo;
    this.now = now;
  }
  create(actor: Actor, body: Record<string, unknown>) {
    if (actor.role !== 'editor') fail(403, 'FORBIDDEN', 'Solo edición puede solicitar.');
    fields(body, ['id', 'kind', 'category', 'description', 'cents']);
    const id = text(body.id, 16, 80),
      category = text(body.category, 2, 80);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(id)) fail(400, 'INVALID_REQUEST', 'Identificador no válido.');
    if (
      body.kind !== 'expense' ||
      !['Alquiler', 'Suministros', 'Servicios', 'Otros gastos operativos', 'Personal'].includes(
        category,
      )
    )
      fail(400, 'INVALID_REQUEST', 'Tipo o categoría no válidos.');
    const value: Approval = {
      id,
      author: actor.id,
      kind: body.kind as Approval['kind'],
      category,
      description: text(body.description, 5, 300),
      cents: integer(body.cents, 1, 100000000),
      status: 'pending',
      at: this.now(),
    };
    return this.repo.transaction(() => {
      const existing = this.repo.get(id);
      if (existing) {
        if (
          existing.author !== value.author ||
          existing.kind !== value.kind ||
          existing.category !== value.category ||
          existing.description !== value.description ||
          existing.cents !== value.cents
        )
          fail(409, 'REQUEST_REUSED', 'Identificador utilizado con otros datos.');
        return existing;
      }
      if (
        category === 'Personal' ||
        (!actor.businessRole && !actor.ownerApprovalRequired && value.cents <= 10000)
      ) {
        value.status = category === 'Personal' ? 'rejected' : 'approved';
        value.decision = {
          actor: 'policy',
          at: value.at,
          reason:
            category === 'Personal'
              ? 'Gasto personal no autorizado.'
              : 'Aprobación automática hasta 100 € sin IVA.',
        };
      }
      this.repo.save(value);
      this.repo.record(actor.id, 'approval.created', value);
      if (value.decision) this.repo.notify(value);
      return value;
    });
  }
  resolve(actor: Actor, id: string, body: Record<string, unknown>) {
    if (!canApprove(actor)) fail(403, 'FORBIDDEN', 'Se requiere revisión.');
    fields(body, ['status', 'reason']);
    if (!['approved', 'rejected'].includes(String(body.status)))
      fail(400, 'INVALID_DECISION', 'Decisión no válida.');
    const reason = text(body.reason, 5, 300);
    return this.repo.transaction(() => {
      const value = this.repo.get(id);
      if (!value) fail(404, 'REQUEST_MISSING', 'Solicitud no encontrada.');
      if (value.author === actor.id && !canApproveOwn(actor))
        fail(403, 'SELF_APPROVAL', 'No puedes resolver tu propia solicitud.');
      if (value.status !== 'pending')
        fail(409, 'REQUEST_RESOLVED', 'La solicitud ya está resuelta.');
      value.status = body.status as 'approved' | 'rejected';
      value.decision = { actor: actor.id, at: this.now(), reason };
      this.repo.save(value);
      this.repo.record(actor.id, 'approval.resolved', value);
      this.repo.notify(value);
      return value;
    });
  }
}
