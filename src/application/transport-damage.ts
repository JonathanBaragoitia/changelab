import { canOperate } from './order-permissions.ts';
import { fail } from '../domain/catalog.ts';
import {
  fields,
  integer,
  text,
  receivedPurchaseQuantity,
  type Actor,
  type Purchase,
} from './operations.ts';
import type { Warehouse } from './warehouse.ts';
import type { Receipt } from './receiving.ts';
import { needsOwnerDecision } from './company-roles.ts';
export type DamageOutcome =
  | { kind: 'credit'; reference: string; amountCents: number }
  | { kind: 'replacement'; receiptId: string; reference: string };
export type TransportDamage = {
  id: string;
  purchaseId: string;
  productId: string;
  quantity: number;
  inStock: boolean;
  reference: string;
  reason: string;
  createdBy: string;
  createdAt: string;
  status: 'open' | 'resolved';
  resolution?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  outcome?: DamageOutcome;
};
export interface TransportRepository {
  all(): TransportDamage[];
  get(id: string): TransportDamage | undefined;
  save(value: TransportDamage): void;
  purchase(id: string): Purchase | undefined;
  hasCancelledReceipt(purchaseId: string, productId: string): boolean;
  purchaseForReceipt(receipt: Receipt): string | undefined;
  availableReceipt(id: string): Receipt | undefined;
  replacementReceipts(damage: TransportDamage, supplierId: string): Receipt[];
  transaction<T>(op: () => T): T;
  record(actor: string, action: string, detail: unknown): void;
}
export class TransportDamages {
  private repo: TransportRepository;
  private warehouse: Warehouse;
  private now: () => string;
  constructor(repo: TransportRepository, warehouse: Warehouse, now: () => string) {
    this.repo = repo;
    this.warehouse = warehouse;
    this.now = now;
  }
  create(actor: Actor, input: Record<string, unknown>) {
    if (actor.businessRole === 'office')
      fail(
        403,
        'WAREHOUSE_REQUIRED',
        'Mario debe registrar la rotura física; oficina tramita su reclamación.',
      );
    if (actor.role !== 'editor' && !canOperate(actor, 'warehouse.damage'))
      fail(403, 'FORBIDDEN', 'Necesitas permiso para registrar roturas.');
    fields(input, [
      'requestId',
      'purchaseId',
      'productId',
      'quantity',
      'inStock',
      'expectedQuantity',
      'reference',
      'reason',
    ]);
    const id = text(input.requestId, 16, 80);
    if (!/^[a-zA-Z0-9-]+$/.test(id) || typeof input.inStock !== 'boolean')
      fail(400, 'INVALID_DAMAGE', 'Datos de rotura no válidos.');
    const value: TransportDamage = {
      id,
      purchaseId: text(input.purchaseId, 1, 80),
      productId: text(input.productId, 1, 80),
      quantity: integer(input.quantity, 1, 10000),
      inStock: input.inStock,
      reference: text(input.reference, 1, 100),
      reason: text(input.reason, 5, 300),
      createdBy: actor.id,
      createdAt: this.now(),
      status: 'open',
    };
    return this.repo.transaction(() => {
      const old = this.repo.get(id);
      if (old) {
        for (const key of [
          'purchaseId',
          'productId',
          'quantity',
          'inStock',
          'reference',
          'reason',
          'createdBy',
        ] as const)
          if (old[key] !== value[key])
            fail(409, 'DAMAGE_REUSED', 'La operación ya existe con otros datos.');
        return old;
      }
      const purchase = this.repo.purchase(value.purchaseId);
      const line = purchase?.lines.find((l) => l.productId === value.productId);
      if (
        !purchase ||
        !line ||
        !['sent', 'partially_received', 'received'].includes(purchase.status)
      )
        fail(
          409,
          'INVALID_PURCHASE',
          'Selecciona una compra enviada o recibida y uno de sus productos.',
        );
      if (this.repo.hasCancelledReceipt(value.purchaseId, value.productId))
        fail(
          409,
          'RECEIPT_CANCELLED',
          'Esta compra tiene una recepción anulada de este producto. Revisa y regulariza la recepción antes de registrar roturas.',
        );
      const previous = this.repo
        .all()
        .filter((d) => d.purchaseId === value.purchaseId && d.productId === value.productId);
      if (previous.some((d) => d.reference.toLowerCase() === value.reference.toLowerCase()))
        fail(409, 'DUPLICATE_DAMAGE', 'Ya existe una incidencia de este producto y referencia.');
      if (previous.reduce((n, d) => n + d.quantity, 0) + value.quantity > line.quantity)
        fail(409, 'DAMAGE_LIMIT', 'Las unidades dañadas superan las compradas.');
      const received = receivedPurchaseQuantity(purchase, value.productId);
      const sameStage = previous
        .filter((d) => d.inStock === value.inStock)
        .reduce((n, d) => n + d.quantity, 0);
      if (sameStage + value.quantity > (value.inStock ? received : line.quantity - received))
        fail(
          409,
          'DAMAGE_STAGE',
          'La cantidad no corresponde a las unidades recibidas o pendientes.',
        );
      // La baja y la incidencia se guardan en la misma transacción, sin descuentos dobles al reintentar.
      if (value.inStock)
        // Elevation is limited to this validated damage deduction; no arbitrary adjustment is exposed.
        this.warehouse.adjust(
          { id: actor.id, role: 'editor' },
          {
            requestId: id,
            productId: value.productId,
            delta: -value.quantity,
            expectedQuantity: integer(input.expectedQuantity, 0, 1000000),
            reason: `Rotura en transporte · ${value.reference}: ${value.reason}`,
          },
        );
      this.repo.save(value);
      this.repo.record(actor.id, 'transport.damage-created', value);
      return value;
    });
  }
  private matchesReplacement(damage: TransportDamage, purchase: Purchase, receipt: Receipt) {
    return (
      receipt.supplierId === purchase.supplierId &&
      receipt.productId === damage.productId &&
      receipt.quantity === damage.quantity &&
      receipt.at >= damage.createdAt &&
      this.repo.purchaseForReceipt(receipt) === (damage.inStock ? undefined : purchase.id)
    );
  }
  replacementCandidates(damage: TransportDamage, used: ReadonlySet<string>) {
    if (damage.status !== 'open') return [];
    const purchase = this.repo.purchase(damage.purchaseId);
    if (!purchase) return [];
    return this.repo
      .replacementReceipts(damage, purchase.supplierId)
      .filter(
        (receipt) => !used.has(receipt.id) && this.matchesReplacement(damage, purchase, receipt),
      )
      .map(({ id, reference, at }) => ({ id, reference, at }));
  }
  resolve(actor: Actor, input: Record<string, unknown>) {
    if (actor.role !== 'editor') fail(403, 'FORBIDDEN', 'Solo edición puede cerrar incidencias.');
    fields(input, ['id', 'resolution', 'kind', 'creditReference', 'amountCents', 'receiptId']);
    const id = text(input.id, 16, 80),
      resolution = text(input.resolution, 5, 300);
    const kind = input.kind === undefined ? 'note' : input.kind;
    if (
      (kind !== 'note' && kind !== 'credit' && kind !== 'replacement') ||
      (kind !== 'credit' &&
        (input.creditReference !== undefined || input.amountCents !== undefined)) ||
      (kind !== 'replacement' && input.receiptId !== undefined)
    )
      fail(400, 'INVALID_DAMAGE_OUTCOME', 'Revisa los datos del resultado de la reclamación.');
    if (kind === 'credit' && needsOwnerDecision(actor))
      fail(403, 'OWNER_APPROVAL_REQUIRED', 'Dirección debe registrar el abono del proveedor.');
    const credit =
      kind === 'credit'
        ? {
            kind: 'credit' as const,
            reference: text(input.creditReference, 1, 100),
            amountCents: integer(input.amountCents, 1, 100_000_000),
          }
        : undefined;
    const receiptId = kind === 'replacement' ? text(input.receiptId, 1, 80) : undefined;
    return this.repo.transaction(() => {
      const old = this.repo.get(id);
      if (!old) fail(404, 'NOT_FOUND', 'Incidencia no encontrada.');
      if (old.status === 'resolved') {
        const sameOutcome = credit
          ? old.outcome?.kind === 'credit' &&
            old.outcome.reference === credit.reference &&
            old.outcome.amountCents === credit.amountCents
          : receiptId
            ? old.outcome?.kind === 'replacement' && old.outcome.receiptId === receiptId
            : !old.outcome;
        if (old.resolution !== resolution || !sameOutcome)
          fail(409, 'ALREADY_RESOLVED', 'La incidencia ya se cerró.');
        return old;
      }
      let outcome: DamageOutcome | undefined = credit;
      if (credit || receiptId) {
        const purchase = this.repo.purchase(old.purchaseId);
        const line = purchase?.lines.find((item) => item.productId === old.productId);
        if (!purchase || !line)
          fail(409, 'INVALID_PURCHASE', 'La reclamación no tiene una línea de compra válida.');
        if (
          credit &&
          (!Number.isSafeInteger(line.costCents) ||
            credit.amountCents > line.costCents * old.quantity)
        )
          fail(409, 'CREDIT_LIMIT', 'El abono neto supera el coste de las unidades dañadas.');
        if (receiptId) {
          const receipt = this.repo.availableReceipt(receiptId);
          if (!receipt || !this.matchesReplacement(old, purchase, receipt))
            fail(
              409,
              'INVALID_REPLACEMENT_RECEIPT',
              'Selecciona una entrada posterior a la rotura del mismo proveedor, producto y cantidad.',
            );
          if (
            this.repo
              .all()
              .some(
                (damage) =>
                  damage.outcome?.kind === 'replacement' && damage.outcome.receiptId === receiptId,
              )
          )
            fail(409, 'REPLACEMENT_ALREADY_LINKED', 'Esa entrada ya justifica otra reposición.');
          outcome = { kind: 'replacement', receiptId, reference: receipt.reference };
        }
      }
      const value: TransportDamage = {
        ...old,
        status: 'resolved',
        resolution,
        resolvedBy: actor.id,
        resolvedAt: this.now(),
        ...(outcome ? { outcome } : {}),
      };
      this.repo.save(value);
      this.repo.record(actor.id, 'transport.damage-resolved', value);
      return value;
    });
  }
  guardReceiptCancellation(receipt: Receipt) {
    if (
      this.repo
        .all()
        .some(
          (damage) =>
            damage.outcome?.kind === 'replacement' && damage.outcome.receiptId === receipt.id,
        )
    )
      fail(
        409,
        'REPLACEMENT_LINKED',
        'La recepción justifica una reposición cerrada. Revisa primero la reclamación.',
      );
    const purchaseId = this.repo.purchaseForReceipt(receipt);
    if (
      purchaseId &&
      this.repo
        .all()
        .some((d) => d.purchaseId === purchaseId && d.productId === receipt.productId && d.inStock)
    )
      fail(
        409,
        'DAMAGE_LINKED',
        'Esta compra tiene una baja por rotura de este producto. No anules también la recepción: revisa sus movimientos para evitar descontar la mercancía dos veces.',
      );
  }
}
