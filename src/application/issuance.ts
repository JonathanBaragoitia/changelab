import { fail } from '../domain/catalog.ts';
import type { Draft } from './billing.ts';
import type { Sale } from './commerce.ts';
export type DemoInvoice = {
  id: string;
  number: string;
  issuedAt: string;
  issuedBy: string;
  draftVersion: number;
  draft: Draft;
  mode: 'demo-not-fiscal';
};
export interface IssuanceRepository {
  transaction<T>(operation: () => T): T;
  draft(id: string): Draft | undefined;
  sale(id: string): Sale | undefined;
  invoiceForDraft(id: string): DemoInvoice | undefined;
  nextInvoiceNumber(year: string): string;
  saveInvoice(invoice: DemoInvoice): void;
  record(actor: string, action: string, detail: unknown): void;
}
export class IssueDemoInvoice {
  private repository: IssuanceRepository;
  private nextId: () => string;
  private now: () => string;
  constructor(repository: IssuanceRepository, nextId: () => string, now: () => string) {
    this.repository = repository;
    this.nextId = nextId;
    this.now = now;
  }
  execute(actor: { id: string; role: string }, draftId: string, input: unknown): DemoInvoice {
    if (actor.role !== 'editor')
      fail(403, 'FORBIDDEN', 'Solo una cuenta editora puede emitir documentos de prueba.');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail(400, 'INVALID_ISSUANCE', 'Emisión no válida.');
    const body = input as Record<string, unknown>;
    if (
      Object.keys(body).some((key) => !['expectedVersion', 'confirmDemo'].includes(key)) ||
      body.confirmDemo !== true ||
      !Number.isSafeInteger(body.expectedVersion) ||
      (body.expectedVersion as number) < 1
    )
      fail(400, 'INVALID_ISSUANCE', 'Revisa la versión y confirma la emisión de demostración.');
    return this.repository.transaction(() => {
      const existing = this.repository.invoiceForDraft(draftId);
      if (existing) {
        if (existing.draftVersion !== body.expectedVersion)
          fail(409, 'DRAFT_CHANGED', 'La versión emitida no coincide.');
        return existing;
      }
      const draft = this.repository.draft(draftId);
      if (!draft) fail(404, 'DRAFT_NOT_FOUND', 'Borrador no encontrado.');
      if ((draft.version ?? 1) !== body.expectedVersion)
        fail(409, 'DRAFT_CHANGED', 'El borrador ha cambiado. Revisa la versión actual.');
      const order = this.repository.sale(draft.orderId);
      if (!order || ['cancelled', 'returned'].includes(order.status ?? ''))
        fail(409, 'ORDER_CANCELLED', 'No se emite para un pedido cancelado o inexistente.');
      const at = this.now();
      const year = new Intl.DateTimeFormat('en', {
        year: 'numeric',
        timeZone: 'Europe/Madrid',
      }).format(new Date(at));
      const invoice: DemoInvoice = {
        id: this.nextId(),
        number: this.repository.nextInvoiceNumber(year),
        issuedAt: at,
        issuedBy: actor.id,
        draftVersion: draft.version ?? 1,
        draft,
        mode: 'demo-not-fiscal',
      };
      this.repository.saveInvoice(invoice);
      this.repository.record(actor.id, 'billing.demo-issued', {
        id: invoice.id,
        number: invoice.number,
        draftId,
        orderId: draft.orderId,
        mode: invoice.mode,
      });
      return invoice;
    });
  }
}
