import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/infrastructure/store.ts';
import { CommerceStore } from '../src/infrastructure/commerce-store.ts';
import { SupplierStore } from '../src/infrastructure/supplier-store.ts';
import { ManageSuppliers } from '../src/application/suppliers.ts';
import { ReceiveStock } from '../src/application/receiving.ts';
const editor = { id: 'editor', role: 'editor' };
test('recepción vincula proveedor, conserva nombre y evita albarán duplicado tras renombrar', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store),
    repo = new SupplierStore(store),
    manage = new ManageSuppliers(repo, randomUUID);
  const supplier = manage.execute(editor, undefined, {
    name: 'Proveedor de prueba',
    email: 'supplier@example.com',
    phone: '',
    active: true,
  });
  const service = new ReceiveStock(commerce, randomUUID, () => new Date().toISOString());
  const input = {
    requestId: randomUUID(),
    productId: 'nc1',
    quantity: 2,
    supplierId: supplier.id,
    supplier: supplier.name,
    reference: 'ALB-001',
  };
  const receipt = service.execute(editor, input);
  manage.execute(editor, supplier.id, {
    name: 'Proveedor renombrado',
    email: 'supplier@example.com',
    phone: '',
    active: true,
    expectedVersion: 1,
  });
  assert.equal(commerce.receiptByRequest(input.requestId)?.supplier, 'Proveedor de prueba');
  assert.deepEqual(service.execute(editor, input), receipt);
  assert.throws(() =>
    service.execute(editor, {
      ...input,
      requestId: randomUUID(),
      supplier: 'Proveedor renombrado',
    }),
  );
  manage.execute(editor, supplier.id, {
    name: 'Proveedor renombrado',
    email: 'supplier@example.com',
    phone: '',
    active: false,
    expectedVersion: 2,
  });
  assert.throws(() =>
    service.execute(editor, { ...input, requestId: randomUUID(), reference: 'ALB-002' }),
  );
  assert.equal(store.verifyAudit(), true);
});
test('permisos, duplicados y versión del proveedor; auditoría fallida revierte alta', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  new CommerceStore(store);
  const repo = new SupplierStore(store),
    service = new ManageSuppliers(repo, randomUUID),
    input = { name: 'Proveedor de prueba', email: '', phone: '', active: true };
  assert.throws(() => service.execute({ id: 'reader', role: 'viewer' }, undefined, input));
  const s = service.execute(editor, undefined, input);
  assert.throws(() => service.execute(editor, undefined, input));
  assert.throws(() => service.execute(editor, s.id, { ...input, expectedVersion: 0 }));
  store.db.exec(
    "CREATE TRIGGER fail_supplier BEFORE INSERT ON audit WHEN NEW.action='supplier.created' BEGIN SELECT RAISE(ABORT,'failure'); END",
  );
  assert.throws(() => service.execute(editor, undefined, { ...input, name: 'Otro proveedor' }));
  assert.equal(repo.suppliers().length, 1);
});
