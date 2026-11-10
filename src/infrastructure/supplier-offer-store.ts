import { needsOwnerDecision, type CompanyActor } from '../application/company-roles.ts';
import type { Store } from './store.ts';
import { fail } from '../domain/catalog.ts';
export type SupplierOffer = {
  supplierId: string;
  productId: string;
  costCents: number;
  packUnits: number;
  leadDays: number;
  version: number;
};
/** Fictional offers are inserted once; existing supplier records and prices are untouched. */
export class SupplierOfferStore {
  private store: Store;
  constructor(store: Store) {
    this.store = store;
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS supplier_offers(supplierId TEXT NOT NULL REFERENCES suppliers(id),productId TEXT NOT NULL REFERENCES products(id),costCents INTEGER NOT NULL CHECK(costCents>0),packUnits INTEGER NOT NULL CHECK(packUnits>0),leadDays INTEGER NOT NULL CHECK(leadDays>0),version INTEGER NOT NULL,PRIMARY KEY(supplierId,productId)); CREATE TABLE IF NOT EXISTS supplier_offer_versions(id TEXT PRIMARY KEY)',
    );
    store.transaction(() => {
      if (store.db.prepare('SELECT id FROM supplier_offer_versions WHERE id=?').get('fictional-v2'))
        return;
      const suppliers = [
        [
          'demo-lavado',
          'Bruma · Químicos de lavado',
          ['Lavado exterior', 'Interior', 'Cristales'],
          100,
          1,
          3,
        ],
        [
          'demo-acabado',
          'Lustre · Cuidado y acabado',
          ['Protección de pintura', 'Llantas y neumáticos'],
          97,
          1,
          4,
        ],
        [
          'demo-accesorios',
          'Trama · Accesorios de detailing',
          ['Accesorios de limpieza'],
          95,
          6,
          3,
        ],
        ['demo-general', 'Nexo · Distribución AutoCare', [], 108, 1, 2],
      ] as const;
      for (const [id, name, categories, factor, pack, days] of suppliers) {
        store.db
          .prepare('INSERT OR IGNORE INTO suppliers VALUES(?,?,?,?,?,?)')
          .run(id, name, '', '', 1, 1);
        for (const p of store.products()) {
          if (categories.length && !(categories as readonly string[]).includes(p.category))
            continue;
          store.db
            .prepare('INSERT OR IGNORE INTO supplier_offers VALUES(?,?,?,?,?,1)')
            .run(id, p.id, Math.max(1, Math.round((p.costCents * factor) / 100)), pack, days);
        }
      }
      store.db.prepare('INSERT INTO supplier_offer_versions VALUES(?)').run('fictional-v2');
      store.record('system', 'supplier.offers-seeded', {
        version: 'fictional-v2',
        fictional: true,
      });
    });
  }
  all() {
    return this.store.db
      .prepare('SELECT * FROM supplier_offers ORDER BY supplierId,productId')
      .all() as SupplierOffer[];
  }
  save(input: Record<string, unknown>, actor: CompanyActor) {
    if (needsOwnerDecision(actor))
      fail(
        403,
        'OWNER_APPROVAL_REQUIRED',
        'Prepara una tarifa; Antonio debe aprobar los nuevos precios.',
      );
    if (actor.role !== 'editor') fail(403, 'FORBIDDEN', 'Solo edición puede gestionar ofertas.');
    if (
      Object.keys(input).some(
        (k) =>
          ![
            'supplierId',
            'productId',
            'costCents',
            'packUnits',
            'leadDays',
            'expectedVersion',
            'reason',
          ].includes(k),
      ) ||
      typeof input.supplierId !== 'string' ||
      (input.reason !== undefined &&
        (typeof input.reason !== 'string' ||
          input.reason.trim().length < 5 ||
          input.reason.length > 500)) ||
      typeof input.productId !== 'string' ||
      !Number.isSafeInteger(input.costCents) ||
      Number(input.costCents) < 1 ||
      Number(input.costCents) > 100000000 ||
      !Number.isInteger(input.packUnits) ||
      Number(input.packUnits) < 1 ||
      Number(input.packUnits) > 10000 ||
      !Number.isInteger(input.leadDays) ||
      Number(input.leadDays) < 1 ||
      Number(input.leadDays) > 365
    )
      fail(400, 'INVALID_OFFER', 'Revisa coste, lote y plazo.');
    return this.store.transaction(() => {
      if (
        !this.store.db
          .prepare('SELECT id FROM suppliers WHERE id=? AND active=1')
          .get(input.supplierId as string) ||
        !this.store.products().some((p) => p.id === input.productId)
      )
        fail(409, 'INVALID_OFFER', 'Selecciona proveedor activo y producto disponible.');
      const current = this.get(input.supplierId as string, input.productId as string);
      if (input.expectedVersion !== (current?.version ?? 0))
        fail(409, 'OFFER_CHANGED', 'La oferta ha cambiado. Actualiza.');
      this.store.db
        .prepare(
          'INSERT INTO supplier_offers VALUES(?,?,?,?,?,?) ON CONFLICT(supplierId,productId) DO UPDATE SET costCents=excluded.costCents,packUnits=excluded.packUnits,leadDays=excluded.leadDays,version=excluded.version',
        )
        .run(
          input.supplierId as string,
          input.productId as string,
          Number(input.costCents),
          Number(input.packUnits),
          Number(input.leadDays),
          (current?.version ?? 0) + 1,
        );
      this.store.record(actor.id, 'supplier.offer-saved', {
        ...input,
        beforeCostCents: current?.costCents ?? null,
        version: (current?.version ?? 0) + 1,
      });
      return this.get(input.supplierId as string, input.productId as string);
    });
  }
  get(supplierId: string, productId: string) {
    return this.store.db
      .prepare('SELECT * FROM supplier_offers WHERE supplierId=? AND productId=?')
      .get(supplierId, productId) as SupplierOffer | undefined;
  }
}
