import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/infrastructure/store.ts';
import { CommerceStore } from '../src/infrastructure/commerce-store.ts';
import { TransportStore } from '../src/infrastructure/transport-store.ts';
import { Warehouse } from '../src/application/warehouse.ts';
import { TransportDamages } from '../src/application/transport-damage.ts';
import type { Purchase } from '../src/application/operations.ts';
import { OperationStore } from '../src/infrastructure/operation-store.ts';
import { ReceiveStock } from '../src/application/receiving.ts';
import { CancelReceipt } from '../src/application/receipt-cancellation.ts';
import { sha } from '../src/infrastructure/store.ts';
import { SupplierStore } from '../src/infrastructure/supplier-store.ts';

test('abono documentado por Dirección y reposición enlazada a su recepción sin duplicar stock', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store);
  new SupplierStore(store).saveSupplier({
    id: 'demo-lavado',
    name: 'Proveedor de prueba',
    email: '',
    phone: '',
    active: 1,
    version: 1,
  });
  const p = {
    id: 'purchase-claim',
    version: 1,
    status: 'received',
    supplierId: 'demo-lavado',
    lines: [{ productId: 'nc1', quantity: 10, costCents: 4900 }],
  } as Purchase;
  new OperationStore<Purchase>(store, 'purchase').save(p, 0);
  const repo = new TransportStore(store, (id) => (id === p.id ? p : undefined));
  let date = '2026-11-10T09:00:00.000Z';
  const now = () => date;
  const service = new TransportDamages(repo, new Warehouse(commerce, now), now);
  const receiving = new ReceiveStock(commerce, randomUUID, now);
  const owner = { id: 'antonio', role: 'editor', businessRole: 'owner' } as const;
  const office = { id: 'ana', role: 'editor', businessRole: 'office' } as const;
  const warehouse = {
    id: 'mario',
    role: 'viewer',
    profile: 'warehouse',
    permissions: ['warehouse.receive', 'warehouse.damage'],
  } as const;
  const stock = () =>
    commerce.snapshot().inventory.find((row) => row.productId === 'nc1')?.quantity;
  const damage = (reference: string) =>
    service.create(warehouse, {
      requestId: randomUUID(),
      purchaseId: p.id,
      productId: 'nc1',
      quantity: 2,
      inStock: true,
      expectedQuantity: stock(),
      reference,
      reason: 'Dos envases rotos en transporte',
    });
  const first = damage('DAÑO-A');
  const credit = {
    id: first.id,
    kind: 'credit',
    creditReference: 'AB-123',
    amountCents: 9800,
    resolution: 'Abono neto documentado por proveedor',
  };
  assert.throws(() => service.resolve(office, credit), { code: 'OWNER_APPROVAL_REQUIRED' });
  assert.throws(() => service.resolve(owner, { ...credit, amountCents: 9801 }), {
    code: 'CREDIT_LIMIT',
  });
  const beforeCredit = commerce.snapshot();
  assert.equal(service.resolve(owner, credit).outcome?.kind, 'credit');
  assert.deepEqual(commerce.snapshot(), beforeCredit);
  service.resolve(owner, credit);
  assert.throws(() => service.resolve(owner, { ...credit, amountCents: 1 }), {
    code: 'ALREADY_RESOLVED',
  });

  const second = damage('DAÑO-B');
  const third = damage('DAÑO-C');
  const replace = {
    id: second.id,
    kind: 'replacement',
    receiptId: 'entrada-que-no-existe',
    resolution: 'Reposición verificada en almacén',
  };
  assert.throws(() => service.resolve(office, replace), { code: 'INVALID_REPLACEMENT_RECEIPT' });
  date = '2026-11-10T11:00:00.000Z';
  const receipt = receiving.execute(warehouse, {
    requestId: randomUUID(),
    productId: 'nc1',
    quantity: 2,
    supplierId: p.supplierId,
    supplier: 'Proveedor de prueba',
    reference: 'REPOS-123',
  });
  const afterReceipt = commerce.snapshot();
  assert.deepEqual(service.replacementCandidates(second, new Set()), [
    { id: receipt.id, reference: receipt.reference, at: receipt.at },
  ]);
  const resolved = service.resolve(office, { ...replace, receiptId: receipt.id });
  assert.deepEqual(resolved.outcome, {
    kind: 'replacement',
    receiptId: receipt.id,
    reference: receipt.reference,
  });
  assert.deepEqual(service.resolve(office, { ...replace, receiptId: receipt.id }), resolved);
  assert.throws(
    () => service.resolve(office, { ...replace, id: third.id, receiptId: receipt.id }),
    { code: 'REPLACEMENT_ALREADY_LINKED' },
  );
  assert.throws(() => service.guardReceiptCancellation(receipt), { code: 'REPLACEMENT_LINKED' });
  assert.deepEqual(service.replacementCandidates(third, new Set([receipt.id])), []);
  assert.deepEqual(commerce.snapshot(), afterReceipt);
  assert.equal(
    store.audit().filter((event) => event.action === 'transport.damage-resolved').length,
    2,
  );
  assert.ok(store.verifyAudit());
});

test('roturas: baja única y atómica, permisos, stock obsoleto y cierre sin reposición', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store);
  const purchase = {
    id: 'purchase',
    status: 'received',
    lines: [{ productId: 'nc1', quantity: 10 }],
  } as Purchase;
  const repo = new TransportStore(store, (id) => (id === 'purchase' ? purchase : undefined));
  const service = new TransportDamages(
    repo,
    new Warehouse(commerce, () => new Date().toISOString()),
    () => new Date().toISOString(),
  );
  const editor = { id: 'editor', role: 'editor' };
  const stock = () =>
    Number(
      store.db.prepare("SELECT quantity FROM inventory WHERE productId='nc1'").get()?.quantity,
    );
  const input = {
    requestId: randomUUID(),
    purchaseId: 'purchase',
    productId: 'nc1',
    quantity: 2,
    inStock: true,
    expectedQuantity: 20,
    reference: 'ALB-1',
    reason: 'Dos envases rotos durante el transporte',
  };
  assert.throws(() => service.create({ id: 'reviewer', role: 'reviewer' }, input));
  const damage = service.create(editor, input);
  assert.equal(stock(), 18);
  service.create(editor, input);
  assert.equal(stock(), 18);
  assert.equal(repo.all().length, 1);
  assert.throws(() => service.create(editor, { ...input, requestId: randomUUID() }));
  assert.throws(() =>
    service.create(editor, {
      ...input,
      requestId: randomUUID(),
      reference: 'ALB-2',
      expectedQuantity: 20,
    }),
  );
  assert.equal(repo.all().length, 1);
  assert.equal(stock(), 18);
  service.resolve(editor, {
    id: damage.id,
    resolution: 'Proveedor acepta la reclamación; abono pendiente.',
  });
  assert.equal(stock(), 18);
  assert.equal(repo.get(damage.id)?.status, 'resolved');
  assert.ok(store.verifyAudit());
  store.db
    .prepare("UPDATE transport_damages SET document=json_set(document,'$.quantity',-5) WHERE id=?")
    .run(damage.id);
  assert.throws(() => repo.all(), { code: 'CORRUPT_TRANSPORT' });
  assert.throws(
    () => service.resolve(editor, { id: damage.id, resolution: 'Otra resolución tras corrupción' }),
    { code: 'CORRUPT_TRANSPORT' },
  );
  assert.equal(stock(), 18);
});

test('mercancía no incorporada: reclamación sin baja y límites de recepción', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store);
  const purchase = {
    id: 'purchase',
    status: 'sent',
    lines: [{ productId: 'nc1', quantity: 10 }],
  } as Purchase;
  const repo = new TransportStore(store, () => purchase);
  const service = new TransportDamages(
    repo,
    new Warehouse(commerce, () => new Date().toISOString()),
    () => new Date().toISOString(),
  );
  const editor = { id: 'editor', role: 'editor' },
    input = {
      requestId: randomUUID(),
      purchaseId: 'purchase',
      productId: 'nc1',
      quantity: 3,
      inStock: false,
      reference: 'RECL-1',
      reason: 'Caja rechazada por daños antes de su entrada',
    };
  service.create(editor, input);
  assert.equal(
    store.db.prepare("SELECT quantity FROM inventory WHERE productId='nc1'").get()?.quantity,
    20,
  );
  assert.throws(() =>
    service.create(editor, { ...input, requestId: randomUUID(), reference: 'RECL-2', quantity: 8 }),
  );
  assert.throws(() =>
    service.create(editor, {
      ...input,
      requestId: randomUUID(),
      reference: 'RECL-3',
      inStock: true,
      expectedQuantity: 20,
    }),
  );
  assert.equal(repo.all().length, 1);
});

test('recepción anulada y baja por rotura no pueden descontar dos veces la misma compra', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store),
    now = () => new Date().toISOString();
  const p = {
    id: 'purchase-cross-check',
    version: 1,
    status: 'received',
    lines: [
      { productId: 'nc1', quantity: 10 },
      { productId: 'nc4', quantity: 10 },
    ],
  } as Purchase;
  new OperationStore<Purchase>(store, 'purchase').save(p, 0);
  const repo = new TransportStore(store, (id) => (id === p.id ? p : undefined)),
    service = new TransportDamages(repo, new Warehouse(commerce, now), now);
  const receiving = new ReceiveStock(commerce, randomUUID, now),
    cancellation = new CancelReceipt(commerce, (r) => service.guardReceiptCancellation(r));
  const actor = { id: 'editor', role: 'editor' };
  const receipts = ['nc1', 'nc4'].map((productId) =>
    receiving.execute(actor, {
      requestId: sha({ purchaseId: p.id, productId }),
      productId,
      quantity: 10,
      supplier: 'Proveedor de pruebas',
      reference: 'ALB-CROSS',
    }),
  );
  cancellation.execute(actor, receipts[1]!.id, {
    expectedQuantity: 30,
    reason: 'Entrada registrada por error',
  });
  const input = {
    requestId: randomUUID(),
    purchaseId: p.id,
    productId: 'nc4',
    quantity: 1,
    inStock: true,
    expectedQuantity: 20,
    reference: 'ROT-CROSS',
    reason: 'Daño detectado en transporte',
  };
  assert.throws(() => service.create(actor, input), { code: 'RECEIPT_CANCELLED' });
  service.create(actor, {
    ...input,
    requestId: randomUUID(),
    productId: 'nc1',
    expectedQuantity: 30,
  });
  assert.throws(
    () =>
      cancellation.execute(actor, receipts[0]!.id, {
        expectedQuantity: 29,
        reason: 'Intento de anular después de la baja',
      }),
    { code: 'DAMAGE_LINKED' },
  );
  assert.equal(
    store.db.prepare("SELECT quantity FROM inventory WHERE productId='nc1'").get()?.quantity,
    29,
  );
  assert.equal(repo.all().length, 1);
  assert.ok(store.verifyAudit());
});

test('Mario registra una rotura con baja única y no puede cerrar su reclamación económica', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store);
  const purchase = {
    id: 'purchase',
    status: 'received',
    lines: [{ productId: 'nc1', quantity: 10 }],
  } as Purchase;
  const service = new TransportDamages(
    new TransportStore(store, () => purchase),
    new Warehouse(commerce, () => new Date().toISOString()),
    () => new Date().toISOString(),
  );
  const mario = {
    id: 'mario',
    role: 'viewer',
    profile: 'warehouse' as const,
    permissions: ['warehouse.damage'],
  };
  const input = {
    requestId: randomUUID(),
    purchaseId: 'purchase',
    productId: 'nc1',
    quantity: 2,
    inStock: true,
    expectedQuantity: 20,
    reference: 'ALB-MARIO',
    reason: 'Dos envases rotos en transporte',
  };
  const damage = service.create(mario, input);
  service.create(mario, input);
  assert.equal(commerce.snapshot().inventory.find((r) => r.productId === 'nc1')?.quantity, 18);
  assert.equal(damage.createdBy, 'mario');
  assert.throws(
    () => service.resolve(mario, { id: damage.id, resolution: 'Reclamación aceptada' }),
    { code: 'FORBIDDEN' },
  );
  assert.throws(
    () =>
      new Warehouse(commerce, () => new Date().toISOString()).adjust(mario, {
        requestId: randomUUID(),
        productId: 'nc1',
        delta: 2,
        expectedQuantity: 18,
        reason: 'Cambio arbitrario de stock',
      }),
    { code: 'FORBIDDEN' },
  );
});
