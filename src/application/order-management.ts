import { validTrackingUrl } from './order-delivery.ts';
import { fail } from '../domain/catalog.ts';
import type { Sale } from './commerce.ts';
import { canOperate, type OperationalActor } from './order-permissions.ts';
export type OrderStatus = 'confirmed' | 'prepared' | 'shipped' | 'cancelled' | 'returned';
export function orderStatus(sale: Sale): OrderStatus {
  return sale.status ?? 'confirmed';
}
export interface OrderRepository {
  invoiceForOrder(id: string): unknown;
  transaction<T>(operation: () => T): T;
  sale(id: string): Sale | undefined;
  replaceSale(sale: Sale): void;
  returnStock(orderId: string, productId: string, quantity: number): void;
  record(actor: string, action: string, detail: unknown): void;
  queueOrderMail?(sale: Sale, event: 'confirmed' | 'shipped' | 'cancelled'): void;
}
export class ManageOrder {
  private repository: OrderRepository;
  private now: () => string;
  constructor(repository: OrderRepository, now: () => string = () => new Date().toISOString()) {
    this.repository = repository;
    this.now = now;
  }
  cancelByCustomer(customerId: string, id: string, input: Record<string, unknown>): Sale {
    if (
      Object.keys(input).some((key) => key !== 'expectedStatus') ||
      !['confirmed', 'prepared', 'cancelled'].includes(String(input.expectedStatus))
    )
      fail(400, 'INVALID_STATUS', 'Actualiza el pedido antes de cancelar.');
    return this.repository.transaction(() => {
      const sale = this.repository.sale(id);
      // Do not disclose whether an order belongs to another customer.
      if (!sale || sale.actorId !== customerId)
        fail(404, 'ORDER_NOT_FOUND', 'Pedido no encontrado.');
      return this.execute({ id: customerId, role: 'editor', name: 'Cliente' }, id, {
        status: 'cancelled',
        expectedStatus: input.expectedStatus,
      });
    });
  }
  execute(actor: OperationalActor, id: string, input: unknown): Sale {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail(400, 'INVALID_STATUS', 'Cambio de estado no válido.');
    const body = input as Record<string, unknown>;
    if (
      Object.keys(body).some(
        (key) => !['status', 'expectedStatus', 'carrier', 'reference', 'trackingUrl'].includes(key),
      ) ||
      !['prepared', 'dispatch_ready', 'shipped', 'cancelled'].includes(body.status as string) ||
      !['confirmed', 'prepared', 'shipped', 'cancelled'].includes(body.expectedStatus as string)
    )
      fail(400, 'INVALID_STATUS', 'Selecciona un estado permitido y la versión que has revisado.');
    const permitted =
      body.status === 'prepared'
        ? canOperate(actor, 'warehouse.prepare')
        : body.status === 'shipped'
          ? canOperate(actor, 'warehouse.handover')
          : body.status === 'dispatch_ready'
            ? canOperate(actor, 'orders.ship')
            : actor.role === 'editor';
    if (!permitted)
      fail(
        403,
        'FORBIDDEN',
        body.status === 'prepared'
          ? 'Necesitas permiso de preparación de almacén.'
          : body.status === 'shipped'
            ? 'Necesitas permiso para registrar envíos.'
            : 'Necesitas permiso de edición para cancelar pedidos.',
      );
    return this.repository.transaction(() => {
      const sale = this.repository.sale(id);
      if (!sale) fail(404, 'ORDER_NOT_FOUND', 'Pedido no encontrado.');
      if (body.status === 'dispatch_ready') {
        if (sale.status !== 'prepared' || body.expectedStatus !== 'prepared')
          fail(409, 'NOT_PREPARED', 'Almacén debe confirmar el paquete antes de tramitarlo.');
        const carrier = typeof body.carrier === 'string' ? body.carrier.trim() : '';
        const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
        if (!carrier || carrier.length > 100 || !reference || reference.length > 100)
          fail(
            400,
            'INVALID_DISPATCH',
            'Indica transportista y referencia de expedición (máximo 100 caracteres).',
          );
        let trackingUrl: string | undefined;
        try {
          trackingUrl = validTrackingUrl(body.trackingUrl);
        } catch {
          fail(
            400,
            'INVALID_TRACKING_URL',
            'El enlace de seguimiento debe ser una dirección HTTPS pública del transportista.',
          );
        }
        if (sale.dispatch) {
          if (
            sale.dispatch.carrier !== carrier ||
            sale.dispatch.reference !== reference ||
            (sale.dispatch.trackingUrl ?? '') !== (trackingUrl ?? '')
          )
            fail(409, 'DISPATCH_EXISTS', 'Este envío ya está tramitado con otros datos.');
          return sale;
        }
        const updated = {
          ...sale,
          dispatch: {
            by: actor.id,
            at: this.now(),
            carrier,
            reference,
            ...(trackingUrl ? { trackingUrl } : {}),
          },
        };
        this.repository.replaceSale(updated);
        this.repository.record(actor.id, 'order.dispatch-arranged', {
          orderId: id,
          carrier,
          reference,
        });
        return updated;
      }
      const previous = orderStatus(sale),
        next = body.status as OrderStatus;
      // Repeated requests do not repeat inventory movements or audit events.
      if (previous === next) return sale;
      if (previous !== body.expectedStatus)
        fail(409, 'ORDER_CHANGED', 'El pedido ha cambiado. Actualiza antes de continuar.');
      if (!(
        (previous === 'confirmed' && ['prepared', 'cancelled'].includes(next)) ||
        (previous === 'prepared' && ['shipped', 'cancelled'].includes(next))
      ))
        fail(
          409,
          'INVALID_TRANSITION',
          'Este cambio no está permitido. Los pedidos enviados requieren un proceso de devolución.',
        );
      if (next === 'shipped' && !sale.dispatch && actor.permissions)
        fail(
          409,
          'DISPATCH_REQUIRED',
          'Envíos debe tramitar la expedición antes de confirmar la recogida.',
        );
      if (next === 'cancelled' && this.repository.invoiceForOrder(id))
        fail(
          409,
          'ISSUED_ORDER',
          'El pedido tiene un documento emitido. Requiere un proceso de rectificación.',
        );
      if (next === 'cancelled')
        for (const line of sale.lines)
          this.repository.returnStock(sale.id, line.productId, line.quantity);
      const operationalEvent = { by: actor.id, at: this.now() };
      const updated = {
        ...sale,
        status: next,
        ...(next === 'prepared'
          ? { preparedBy: operationalEvent }
          : next === 'shipped'
            ? { shippedBy: operationalEvent }
            : {}),
      };
      this.repository.replaceSale(updated);
      this.repository.record(actor.id, 'order.status-changed', {
        orderId: id,
        before: previous,
        after: next,
        actorName: actor.name ?? actor.id,
        stockReturned: next === 'cancelled',
      });
      if (next === 'shipped' || next === 'cancelled')
        this.repository.queueOrderMail?.(updated, next);
      return updated;
    });
  }
}
