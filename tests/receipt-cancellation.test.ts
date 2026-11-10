import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Store, sha } from '../src/infrastructure/store.ts';
import { CommerceStore } from '../src/infrastructure/commerce-store.ts';
import { ReceiveStock } from '../src/application/receiving.ts';
import { CancelReceipt } from '../src/application/receipt-cancellation.ts';
import { makeServer } from '../src/server.ts';
import { sessions } from './auth-fixture.ts';
const actor = { id: 'editor', role: 'editor' };
function setup(t: { after: (fn: () => void) => void }) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store);
  const receipt = new ReceiveStock(commerce, randomUUID, () => new Date().toISOString()).execute(
    actor,
    {
      requestId: randomUUID(),
      productId: 'nc1',
      quantity: 5,
      supplier: 'Proveedor prueba',
      reference: 'ALB-TEST',
    },
  );
  return { store, commerce, receipt, cancel: new CancelReceipt(commerce) };
}
test('anulación descuenta una sola vez, conserva recepción y registra movimiento y evento', (t) => {
  const { store, commerce, receipt, cancel } = setup(t),
    before = store.orders();
  const body = { reason: 'Entrada duplicada por error', expectedQuantity: 25 };
  const result = cancel.execute(actor, receipt.id, body),
    audit = store.audit();
  assert.deepEqual(cancel.execute(actor, receipt.id, body), result);
  assert.deepEqual(store.audit(), audit);
  assert.equal(commerce.snapshot().inventory.find((r) => r.productId === 'nc1')?.quantity, 20);
  assert.deepEqual(commerce.receipt(receipt.id), receipt);
  assert.deepEqual(store.orders(), before);
  assert.equal(
    commerce.snapshot().movements.filter((r) => r.kind === 'receipt-cancellation').length,
    1,
  );
  assert.equal(store.verifyAudit(), true);
  assert.throws(() =>
    cancel.execute(actor, receipt.id, { ...body, reason: 'Otro motivo distinto' }),
  );
});
test('bloquea stock cambiado/insuficiente, roles y datos inválidos; fallo revierte todo', (t) => {
  const { store, commerce, receipt, cancel } = setup(t);
  for (const role of ['viewer', 'reviewer'])
    assert.throws(() =>
      cancel.execute({ id: role, role }, receipt.id, {
        reason: 'Motivo de prueba',
        expectedQuantity: 25,
      }),
    );
  for (const body of [
    { reason: 'x', expectedQuantity: 25 },
    { reason: 'Motivo válido', expectedQuantity: 24 },
    { reason: 'Motivo válido', expectedQuantity: 25, extra: true },
  ])
    assert.throws(() => cancel.execute(actor, receipt.id, body));
  const original = commerce.record;
  commerce.record = () => {
    throw Error('disk');
  };
  assert.throws(() =>
    cancel.execute(actor, receipt.id, { reason: 'Motivo válido', expectedQuantity: 25 }),
  );
  assert.equal(commerce.receiptCancellation(receipt.id), undefined);
  assert.equal(commerce.snapshot().inventory.find((r) => r.productId === 'nc1')?.quantity, 25);
  commerce.record = original;
  store.db.prepare('UPDATE inventory SET quantity=2 WHERE productId=?').run('nc1');
  assert.throws(() =>
    cancel.execute(actor, receipt.id, { reason: 'Motivo válido', expectedQuantity: 2 }),
  );
  assert.equal(commerce.receiptCancellation(receipt.id), undefined);
});
test('HTTP recepción anulada exige rol editor y conserva estado en workspace', async (t) => {
  const { store, commerce, receipt } = setup(t),
    server = makeServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const base = 'http://127.0.0.1:' + addr.port,
    headers = sessions(store, base);
  const send = (role: string) =>
    fetch(base + '/api/inventory/receipts/' + receipt.id + '/cancel', {
      method: 'POST',
      headers: headers(role),
      body: JSON.stringify({ reason: 'Entrada errónea de prueba', expectedQuantity: 25 }),
    });
  assert.equal((await send('lucia')).status, 403);
  assert.equal((await send('marcos')).status, 403);
  assert.equal((await send('elena')).status, 200);
  assert.equal((await send('elena')).status, 200);
  assert.ok(commerce.snapshot().receipts[0]?.cancellation);
});

test('HTTP anular una línea de compra conserva las demás y permite corregirla sin duplicar stock', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const server = makeServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  const headers = sessions(store, base);
  const post = async (path: string, payload: unknown, status = 200, id = 'elena') => {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: headers(id),
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    return body;
  };
  const currentPurchase = async (id: string) => {
    const response = await fetch(base + '/api/operations', { headers: headers('elena') });
    assert.equal(response.status, 200);
    return (await response.json()).purchases.find((purchase: { id: string }) => purchase.id === id);
  };
  const commerce = new CommerceStore(store);
  const stock = (id: string) =>
    Number(commerce.snapshot().inventory.find((row) => row.productId === id)!.quantity);
  store.db
    .prepare('INSERT INTO suppliers VALUES(?,?,?,?,?,?)')
    .run('supplier', 'Proveedor', '', '', 1, 1);
  for (const productId of ['nc1', 'nc4'])
    store.db
      .prepare('INSERT INTO supplier_offers VALUES(?,?,?,?,?,?)')
      .run('supplier', productId, 4900, 1, 3, 1);
  for (const legacy of [false, true]) {
    const initialStock = stock('nc1');
    const initialOther = stock('nc4');
    const lines = [
      { productId: 'nc1', quantity: 2 },
      { productId: 'nc4', quantity: 1 },
    ];
    const purchase = await post(
      '/api/purchases',
      {
        requestId: randomUUID(),
        supplierId: 'supplier',
        reason: 'Reponer existencias',
        lines,
      },
      201,
    );
    const path = '/api/purchases/' + purchase.id;
    const approved = await post(
      path,
      { action: 'approve', expectedVersion: purchase.version },
      200,
      'marcos',
    );
    const deliveryId = randomUUID();
    const reference = 'ALB-' + deliveryId;
    const sent = legacy
      ? approved
      : await post(path, { action: 'send', expectedVersion: approved.version });
    const delivery = {
      confirmReceived: true,
      expectedVersion: sent.version,
      reference,
      ...(legacy
        ? { action: 'receive' }
        : { action: 'receive-partial', requestId: deliveryId, lines }),
    };
    const received = await post(path, delivery);
    assert.equal(received.status, 'received');
    if (!legacy) {
      assert.deepEqual(
        await post(path, {
          ...delivery,
          reference: ' ' + reference + ' ',
          lines: lines.map(({ productId, quantity }) => ({ quantity, productId })),
        }),
        received,
      );
    }
    const receipt = commerce.receiptByRequest(
      sha({
        purchaseId: purchase.id,
        productId: 'nc1',
        ...(legacy ? {} : { deliveryId }),
      }),
    )!;
    const cancelPath = '/api/inventory/receipts/' + receipt.id + '/cancel';
    const cancellation = {
      reason: 'Unidades anotadas por error',
      expectedQuantity: initialStock + 2,
    };
    await post(cancelPath, { ...cancellation, expectedQuantity: initialStock + 1 }, 409);
    assert.equal((await currentPurchase(purchase.id)).version, received.version);
    assert.equal(stock('nc1'), initialStock + 2);
    assert.equal(commerce.receiptCancellation(receipt.id), undefined);

    const cancelled = await post(cancelPath, cancellation);
    assert.equal(cancelled.purchaseId, purchase.id);
    assert.deepEqual(await post(cancelPath, cancellation), cancelled);
    if (!legacy) await post(path, delivery, 409);
    const reopened = await currentPurchase(purchase.id);
    assert.equal(reopened.status, 'partially_received');
    assert.equal(reopened.version, received.version + 1);
    assert.equal(
      reopened.deliveries
        .flatMap((entry: { lines: unknown[] }) => entry.lines)
        .find((line: { productId: string }) => line.productId === 'nc1').cancelledReceiptId,
      receipt.id,
    );
    assert.equal(stock('nc1'), initialStock);
    assert.equal(stock('nc4'), initialOther + 1);
    const correction = {
      action: 'receive-partial',
      confirmReceived: true,
      expectedVersion: reopened.version,
      requestId: randomUUID(),
      reference: 'RECT-' + deliveryId,
      lines: [{ productId: 'nc1', quantity: 2 }],
    };
    await post(path, { ...correction, lines: [{ productId: 'nc1', quantity: 3 }] }, 409);
    assert.equal((await post(path, correction)).status, 'received');
    assert.equal((await currentPurchase(purchase.id)).status, 'received');
    assert.equal(stock('nc1'), initialStock + 2);
    assert.equal(stock('nc4'), initialOther + 1);
  }
  assert.equal(
    store.audit().filter((event) => event.action === 'purchase.receipt-reopened').length,
    2,
  );
  store.db.prepare('UPDATE users SET role=? WHERE id=?').run('editor', 'marcos');
  store.db.prepare('INSERT INTO user_business_roles VALUES(?,?)').run('marcos', 'owner');
  const ownerPurchase = await post(
    '/api/purchases',
    {
      requestId: randomUUID(),
      supplierId: 'supplier',
      reason: 'Compra de prueba de Dirección',
      lines: [{ productId: 'nc1', quantity: 1 }],
    },
    201,
    'marcos',
  );
  await post(
    '/api/purchases/' + ownerPurchase.id,
    {
      action: 'approve',
      expectedVersion: ownerPurchase.version,
    },
    200,
    'marcos',
  );
  const stored = await currentPurchase(ownerPurchase.id);
  assert.equal(stored.status, 'approved');
  assert.equal(stored.approvedBy, stored.createdBy);
  assert.ok(store.verifyAudit());
});
