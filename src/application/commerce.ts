import { orderDelivery } from './order-delivery.ts';
import { demoTax } from '../domain/tax.ts';
import type { TaxSnapshot } from '../domain/tax.ts';
import { fail } from '../domain/catalog.ts';
import type { Product } from '../domain/catalog.ts';
export type BasketLine = { productId: string; quantity: number; expectedPriceCents: number };
export type SaleLine = BasketLine & { name: string; unitPriceCents: number; unitCostCents: number };
export type Customer = { name: string; email: string; address: string };
export type Sale = {
  preparedBy?: { by: string; at: string };
  dispatch?: { by: string; at: string; carrier: string; reference: string; trackingUrl?: string };
  shippedBy?: { by: string; at: string };
  returnedQuantities?: { productId: string; quantity: number }[];
  tax?: TaxSnapshot;
  status?: 'confirmed' | 'prepared' | 'shipped' | 'cancelled' | 'returned';
  customer?: Customer;
  id: string;
  actorId: string;
  requestId: string;
  createdAt: string;
  totalCents: number;
  costCents: number;
  lines: SaleLine[];
};
export interface CommerceRepository {
  transaction<T>(operation: () => T): T;
  products(): Product[];
  saleByRequest(actorId: string, requestId: string): Sale | undefined;
  takeStock(productId: string, quantity: number): boolean;
  saveSale(sale: Sale): void;
  record(actor: string, action: string, detail: unknown): void;
  queueOrderMail?(sale: Sale, event: 'confirmed' | 'shipped' | 'cancelled'): void;
}
export function validateBasket(input: unknown): { requestId: string; lines: BasketLine[] } {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail(400, 'INVALID_BASKET', 'Carrito no válido.');
  const body = input as Record<string, unknown>;
  if (
    Object.keys(body).some((key) => !['requestId', 'lines'].includes(key)) ||
    typeof body.requestId !== 'string' ||
    !/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId) ||
    !Array.isArray(body.lines) ||
    !body.lines.length ||
    body.lines.length > 50
  )
    fail(
      400,
      'INVALID_BASKET',
      'El carrito debe contener entre 1 y 50 artículos y una referencia de compra.',
    );
  const seen = new Set<string>();
  const lines = body.lines.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      fail(400, 'INVALID_BASKET', 'Artículo no válido.');
    const line = raw as Record<string, unknown>;
    if (
      Object.keys(line).some(
        (key) => !['productId', 'quantity', 'expectedPriceCents'].includes(key),
      ) ||
      typeof line.productId !== 'string' ||
      !line.productId ||
      seen.has(line.productId) ||
      !Number.isSafeInteger(line.quantity) ||
      (line.quantity as number) < 1 ||
      (line.quantity as number) > 100 ||
      !Number.isSafeInteger(line.expectedPriceCents) ||
      (line.expectedPriceCents as number) < 1
    )
      fail(
        400,
        'INVALID_BASKET',
        'Revisa artículos, precios y cantidades (1–100). No se permiten duplicados.',
      );
    seen.add(line.productId);
    return {
      productId: line.productId,
      quantity: line.quantity as number,
      expectedPriceCents: line.expectedPriceCents as number,
    };
  });
  return { requestId: body.requestId, lines };
}
export class Checkout {
  private repository: CommerceRepository;
  private nextId: () => string;
  private now: () => string;
  constructor(repository: CommerceRepository, nextId: () => string, now: () => string) {
    this.repository = repository;
    this.nextId = nextId;
    this.now = now;
  }
  execute(actor: { id: string; role: string }, input: unknown): Sale {
    if (actor.role !== 'editor')
      fail(403, 'FORBIDDEN', 'La compra de demostración requiere una cuenta editora.');
    return this.place(actor.id, input);
  }
  customerCheckout(customerId: string, input: unknown): Sale {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail(400, 'INVALID_CUSTOMER', 'Datos no válidos.');
    const body = input as Record<string, unknown>;
    if (Object.keys(body).some((key) => !['requestId', 'lines', 'customer'].includes(key)))
      fail(400, 'INVALID_CUSTOMER', 'Campos no permitidos.');
    const customer = validateCustomer(body.customer);
    return this.place(customerId, { requestId: body.requestId, lines: body.lines }, customer);
  }
  private place(actorId: string, input: unknown, customer?: Customer): Sale {
    const basket = validateBasket(input);
    return this.repository.transaction(() => {
      const existing = this.repository.saleByRequest(actorId, basket.requestId);
      if (existing) {
        const original = existing.lines.map(({ productId, quantity, expectedPriceCents }) => ({
          productId,
          quantity,
          expectedPriceCents,
        }));
        if (
          JSON.stringify(original) !== JSON.stringify(basket.lines) ||
          JSON.stringify(existing.customer) !== JSON.stringify(customer)
        )
          fail(409, 'REQUEST_REUSED', 'La referencia de compra ya se utilizó con otro carrito.');
        return existing;
      }
      const products = this.repository.products();
      const lines = basket.lines.map((line) => {
        const product = products.find((p) => p.id === line.productId);
        if (!product) fail(409, 'PRODUCT_UNAVAILABLE', 'Un artículo ya no está disponible.');
        if (product.priceCents !== line.expectedPriceCents)
          fail(
            409,
            'PRICE_CHANGED',
            'Ha cambiado un precio. Actualiza el carrito y revisa el nuevo total.',
          );
        return {
          ...line,
          name: product.name,
          unitPriceCents: product.priceCents,
          unitCostCents: product.costCents,
        };
      });
      const totalCents = lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0);
      const costCents = lines.reduce((sum, line) => sum + line.quantity * line.unitCostCents, 0);
      if (!Number.isSafeInteger(totalCents) || !Number.isSafeInteger(costCents))
        fail(400, 'TOTAL_LIMIT', 'Importe fuera de rango.');
      for (const line of lines) {
        if (!this.repository.takeStock(line.productId, line.quantity))
          fail(
            409,
            'INSUFFICIENT_STOCK',
            'No quedan suficientes existencias. Actualiza el catálogo.',
          );
      }
      const sale: Sale = {
        id: this.nextId(),
        actorId,
        ...(customer ? { customer } : {}),
        requestId: basket.requestId,
        createdAt: this.now(),
        totalCents,
        tax: demoTax(lines),
        costCents,
        lines,
      };
      this.repository.saveSale(sale);
      this.repository.record(actorId, 'order.confirmed', {
        orderId: sale.id,
        totalCents,
        units: lines.reduce((sum, line) => sum + line.quantity, 0),
      });
      this.repository.queueOrderMail?.(sale, 'confirmed');
      return sale;
    });
  }
}
export function validateCustomer(input: unknown): Customer {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail(400, 'INVALID_CUSTOMER', 'Completa los datos del cliente.');
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).some((key) => !['name', 'email', 'address'].includes(key)) ||
    typeof value.name !== 'string' ||
    value.name.trim().length < 2 ||
    value.name.length > 100 ||
    typeof value.email !== 'string' ||
    value.email.length > 150 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) ||
    typeof value.address !== 'string' ||
    value.address.trim().length < 8 ||
    value.address.length > 300
  )
    fail(400, 'INVALID_CUSTOMER', 'Revisa nombre, correo y dirección.');
  return { name: value.name.trim(), email: value.email.trim(), address: value.address.trim() };
}
export function customerView(sale: Sale) {
  return {
    returnedQuantities: sale.returnedQuantities ?? [],
    id: sale.id,
    createdAt: sale.createdAt,
    totalCents: sale.tax?.totalCents ?? sale.totalCents,
    tax: sale.tax,
    status: sale.status ?? 'confirmed',
    shipping: orderDelivery(sale),
    preparedAt: sale.preparedBy?.at ?? null,
    lines: sale.lines.map(({ productId, name, quantity, unitPriceCents }) => ({
      productId,
      name,
      quantity,
      unitPriceCents,
    })),
  };
}
