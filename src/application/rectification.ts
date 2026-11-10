import { needsOwnerDecision, type CompanyActor } from './company-roles.ts';
import { fail } from '../domain/catalog.ts';
import type { DemoInvoice } from './issuance.ts';
export type DemoCorrection = {
  id: string;
  number: string;
  invoiceId: string;
  originalNumber: string;
  reason: string;
  at: string;
  actorId: string;
  baseCents: number;
  taxCents: number;
  totalCents: number;
  mode: 'demo-not-fiscal';
};
export interface RectificationRepository {
  transaction<T>(operation: () => T): T;
  invoice(id: string): DemoInvoice | undefined;
  correctionForInvoice(id: string): DemoCorrection | undefined;
  nextCorrectionNumber(year: string): string;
  saveCorrection(correction: DemoCorrection): void;
  record(actor: string, action: string, detail: unknown): void;
}
export class RectifyDemoInvoice {
  private repository: RectificationRepository;
  private nextId: () => string;
  private now: () => string;
  constructor(repository: RectificationRepository, nextId: () => string, now: () => string) {
    this.repository = repository;
    this.nextId = nextId;
    this.now = now;
  }
  execute(actor: CompanyActor, invoiceId: string, input: unknown): DemoCorrection {
    if (needsOwnerDecision(actor))
      fail(403, 'OWNER_APPROVAL_REQUIRED', 'Esta decisión económica corresponde a dirección.');
    if (actor.role !== 'editor')
      fail(403, 'FORBIDDEN', 'Solo una cuenta editora puede rectificar documentos de prueba.');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail(400, 'INVALID_CORRECTION', 'Rectificación no válida.');
    const body = input as Record<string, unknown>;
    if (
      Object.keys(body).some((key) => !['reason', 'confirmDemo', 'expectedNumber'].includes(key)) ||
      body.confirmDemo !== true ||
      typeof body.reason !== 'string' ||
      body.reason.trim().length < 5 ||
      body.reason.length > 500 ||
      typeof body.expectedNumber !== 'string'
    )
      fail(
        400,
        'INVALID_CORRECTION',
        'Indica un motivo, revisa el documento y confirma la rectificación total de prueba.',
      );
    const reason = body.reason.trim();
    return this.repository.transaction(() => {
      const invoice = this.repository.invoice(invoiceId);
      if (!invoice) fail(404, 'INVOICE_NOT_FOUND', 'Documento no encontrado.');
      if (invoice.number !== body.expectedNumber)
        fail(409, 'INVOICE_CHANGED', 'La referencia no coincide con el documento revisado.');
      const existing = this.repository.correctionForInvoice(invoiceId);
      if (existing) {
        if (existing.reason !== reason)
          fail(
            409,
            'ALREADY_CORRECTED',
            'El documento ya tiene una rectificación total con otro motivo.',
          );
        return existing;
      }
      const at = this.now(),
        year = new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Europe/Madrid' }).format(
          new Date(at),
        );
      const correction: DemoCorrection = {
        id: this.nextId(),
        number: this.repository.nextCorrectionNumber(year),
        invoiceId,
        originalNumber: invoice.number,
        reason,
        at,
        actorId: actor.id,
        baseCents: -invoice.draft.baseCents,
        taxCents: -invoice.draft.taxCents,
        totalCents: -invoice.draft.totalCents,
        mode: 'demo-not-fiscal',
      };
      this.repository.saveCorrection(correction);
      this.repository.record(actor.id, 'billing.demo-corrected', {
        id: correction.id,
        number: correction.number,
        originalNumber: invoice.number,
        reason,
        totalCents: correction.totalCents,
      });
      return correction;
    });
  }
}
