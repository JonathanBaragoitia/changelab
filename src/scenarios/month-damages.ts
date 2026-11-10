import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { Store } from '../infrastructure/store.ts';
import { CommerceStore } from '../infrastructure/commerce-store.ts';
import { OperationStore } from '../infrastructure/operation-store.ts';
import { TransportStore } from '../infrastructure/transport-store.ts';
import { Warehouse } from '../application/warehouse.ts';
import { TransportDamages } from '../application/transport-damage.ts';
import type { Purchase } from '../application/operations.ts';

// Complemento sintético añadido a posteriori: no reescribe ventas, compras ni eventos anteriores.
const metadata = JSON.parse(readFileSync('data/scenarios/ultimo-mes.json', 'utf8'));
const database = resolve(metadata.database);
if (!database.startsWith(resolve('data/scenarios') + sep)) throw Error('Base no aislada.');
let date = '2026-10-07T11:00:00.000Z';
const store = new Store(database, () => date);
const commerce = new CommerceStore(store);
const purchases = new OperationStore<Purchase>(store, 'purchase');
const repo = new TransportStore(store, (id) => purchases.get(id));
const service = new TransportDamages(repo, new Warehouse(commerce, () => date), () => date);
const editorRow = store.db
  .prepare("SELECT id FROM users WHERE active=1 AND role='editor' LIMIT 1")
  .get();
if (!editorRow) throw Error('Falta cuenta editora.');
const actor = { id: String(editorRow.id), role: 'editor' };
const quantity = (id: string) =>
  Number(store.db.prepare('SELECT quantity FROM inventory WHERE productId=?').get(id)?.quantity);
const cases = [
  {
    day: '07',
    purchaseDay: '02',
    product: 'nc1',
    units: 2,
    inStock: true,
    reason: 'Dos garrafas con fuga detectadas al revisar el albarán de Bruma.',
    closeDay: '09',
    resolution:
      'Proveedor reconoce el daño. Reclamación documentada; abono pendiente de registro económico.',
  },
  {
    day: '17',
    purchaseDay: '12',
    product: 'nc16',
    units: 1,
    inStock: true,
    reason: 'Un pack de microfibras llegó con embalaje mojado y producto inutilizable.',
    closeDay: '20',
    resolution:
      'Reclamación aceptada. Se acuerda descuento en una compra futura, todavía sin contabilizar.',
  },
  {
    day: '18',
    purchaseDay: '10',
    product: 'nc13',
    units: 1,
    inStock: true,
    reason: 'Frasco de cera agrietado por golpe durante el transporte.',
    closeDay: null,
    resolution: null,
  },
  {
    day: '30',
    purchaseDay: '28',
    product: 'nc4',
    units: 2,
    inStock: false,
    reason: 'Dos unidades rechazadas en la descarga antes de incorporarlas al almacén.',
    closeDay: null,
    resolution: null,
  },
  {
    day: '31',
    purchaseDay: '28',
    product: 'nc16',
    units: 2,
    inStock: false,
    reason: 'Dos packs aplastados rechazados antes del alta en existencias.',
    closeDay: '31',
    resolution:
      'Transportista registra el rechazo. Se solicita sustitución; la reposición sigue pendiente de recibir.',
  },
] as const;
const rejected: string[] = [];
try {
  const originals = () =>
    JSON.stringify({
      orders: store.db.prepare('SELECT * FROM orders ORDER BY id').all(),
      sales: store.db.prepare('SELECT * FROM sales ORDER BY id').all(),
      purchases: purchases.all(),
    });
  const before = originals();
  store.transaction(() => {
    for (const item of cases) {
      const reference = `ROT-OCT26-${item.day}-${item.product}`;
      if (repo.all().some((d) => d.reference === reference)) continue;
      const purchase = purchases
        .all()
        .find(
          (p) =>
            p.createdAt.startsWith(`2026-10-${item.purchaseDay}`) &&
            p.lines.some((l) => l.productId === item.product) &&
            ['received', 'partially_received'].includes(p.status),
        );
      assert.ok(purchase, reference + ' sin compra compatible');
      date = `2026-10-${item.day}T11:00:00.000Z`;
      const stock = quantity(item.product);
      const input = {
        requestId: randomUUID(),
        purchaseId: purchase.id,
        productId: item.product,
        quantity: item.units,
        inStock: item.inStock,
        expectedQuantity: stock,
        reference,
        reason: item.reason,
      };
      const damage = service.create(actor, input);
      assert.equal(quantity(item.product), stock - (item.inStock ? item.units : 0));
      service.create(actor, input);
      assert.equal(quantity(item.product), stock - (item.inStock ? item.units : 0));
      if (item.closeDay) {
        date = `2026-10-${item.closeDay}T15:00:00.000Z`;
        service.resolve(actor, { id: damage.id, resolution: item.resolution });
        assert.equal(quantity(item.product), stock - (item.inStock ? item.units : 0));
      }
    }
    const sample = repo.all().find((d) => d.inStock)!;
    const payload = {
      requestId: randomUUID(),
      purchaseId: sample.purchaseId,
      productId: sample.productId,
      quantity: 1,
      inStock: true,
      expectedQuantity: quantity(sample.productId),
      reference: 'PRUEBA-BLOQUEADA',
      reason: 'Comprobación sintética que no debe guardarse',
    };
    const fingerprint = () =>
      JSON.stringify({
        damages: repo.all(),
        inventory: store.db.prepare('SELECT * FROM inventory').all(),
        audit: store.db.prepare('SELECT count(*) n FROM audit').get(),
      });
    const reject = (name: string, action: () => unknown) => {
      const state = fingerprint();
      assert.throws(action);
      assert.equal(fingerprint(), state);
      rejected.push(name);
    };
    reject('Rol revisor sin permiso de baja', () =>
      service.create({ id: 'review-test', role: 'reviewer' }, payload),
    );
    reject('Producto ajeno a la compra', () =>
      service.create(actor, { ...payload, productId: 'nc18' }),
    );
    reject('Cantidad dañada superior a lo comprado', () =>
      service.create(actor, { ...payload, quantity: 9999 }),
    );
    reject('Stock revisado obsoleto', () =>
      service.create(actor, { ...payload, expectedQuantity: quantity(sample.productId) + 1 }),
    );
    reject('Referencia ya registrada', () =>
      service.create(actor, { ...payload, reference: sample.reference }),
    );
    reject('Reutilización de petición con otra cantidad', () =>
      service.create(actor, { ...payload, requestId: sample.id, quantity: sample.quantity + 1 }),
    );
    assert.equal(originals(), before, 'No deben reescribirse operaciones históricas.');
    for (const row of store.db.prepare('SELECT productId,quantity FROM inventory').all()) {
      const sum = Number(
        store.db
          .prepare('SELECT coalesce(sum(quantity),0) n FROM inventory_movements WHERE productId=?')
          .get(String(row.productId))?.n,
      );
      assert.equal(row.quantity, 20 + sum, 'Descuadre de almacén ' + row.productId);
      assert.ok(Number(row.quantity) >= 0);
    }
    assert.ok(store.verifyAudit());
    assert.equal(store.db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
    assert.equal(store.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  });
  const damages = repo.all().filter((d) => d.reference.startsWith('ROT-OCT26'));
  const report = {
    generatedAt: new Date().toISOString(),
    scenario: 'Complemento sintético de octubre, añadido a posteriori',
    cases: damages.length,
    open: damages.filter((d) => d.status === 'open').length,
    resolved: damages.filter((d) => d.status === 'resolved').length,
    stockRemoved: damages.filter((d) => d.inStock).reduce((s, d) => s + d.quantity, 0),
    rejectedChecks: rejected,
    checks:
      'Stock conciliado con movimientos, auditoría y SQLite íntegros; ventas y compras conservadas.',
    damages,
  };
  writeFileSync(
    resolve(metadata.directory, 'roturas-verificacion.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        ...report,
        damages: damages.map((d) => ({
          reference: d.reference,
          status: d.status,
          quantity: d.quantity,
          inStock: d.inStock,
        })),
      },
      null,
      2,
    ),
  );
} finally {
  store.close();
}
