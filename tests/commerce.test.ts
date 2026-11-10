import { Warehouse } from '../src/application/warehouse.ts';
import { RectifyDemoInvoice } from '../src/application/rectification.ts';
import { IssueDemoInvoice } from '../src/application/issuance.ts';
import { ReviseDraft } from '../src/application/billing.ts';
import { PrepareInvoiceDraft, calculateDraftLines } from '../src/application/billing.ts';
import { ReceiveStock } from '../src/application/receiving.ts';
import { ManageOrder } from '../src/application/order-management.ts';
import { customerView } from '../src/application/commerce.ts';
import { CustomerSessions } from '../src/infrastructure/customer-sessions.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/infrastructure/store.ts';
import { CommerceStore } from '../src/infrastructure/commerce-store.ts';
import { Checkout } from '../src/application/commerce.ts';
const editor = { id: 'test-editor', role: 'editor' };
const request = (quantity = 2) => ({
  requestId: randomUUID(),
  lines: [{ productId: 'nc1', quantity, expectedPriceCents: 7990 }],
});
const errorCode = (code: string) => (error: unknown) =>
  !!error && typeof error === 'object' && 'code' in error && error.code === code;
function fixture(t: test.TestContext) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store);
  const checkout = new Checkout(commerce, randomUUID, () => '2026-10-27T10:00:00.000Z');
  return { store, commerce, checkout };
}
test('compra conserva precio y coste, descuenta stock y no altera pedidos antiguos', (t) => {
  const { store, commerce, checkout } = fixture(t);
  const historical = store.orders();
  const sale = checkout.execute(editor, request());
  assert.equal(sale.totalCents, 15980);
  assert.equal(sale.costCents, 9800);
  store.db.prepare("UPDATE products SET priceCents=9000,costCents=6000 WHERE id='nc1'").run();
  assert.equal(commerce.snapshot().inventory.find((row) => row.productId === 'nc1')?.quantity, 18);
  assert.equal(commerce.snapshot().sales[0]?.lines[0]?.unitPriceCents, 7990);
  assert.equal(commerce.snapshot().metrics.grossCents, 6180);
  assert.deepEqual(store.orders(), historical);
  assert.equal(store.verifyAudit(), true);
});
test('reintento devuelve el mismo pedido sin descontar dos veces y rechaza reutilización diferente', (t) => {
  const { commerce, checkout } = fixture(t);
  const body = request();
  const first = checkout.execute(editor, body);
  assert.deepEqual(checkout.execute(editor, body), first);
  assert.equal(commerce.snapshot().metrics.orders, 1);
  assert.equal(commerce.snapshot().inventory.find((row) => row.productId === 'nc1')?.quantity, 18);
  body.lines[0]!.quantity = 3;
  assert.throws(() => checkout.execute(editor, body), errorCode('REQUEST_REUSED'));
});
test('fallo de segunda línea revierte todo el stock y no crea pedido ni evento', (t) => {
  const { store, commerce, checkout } = fixture(t);
  const before = commerce.snapshot();
  const audit = store.audit();
  const body = request();
  body.lines.push({ productId: 'nc2', quantity: 21, expectedPriceCents: 3490 });
  assert.throws(() => checkout.execute(editor, body), errorCode('INSUFFICIENT_STOCK'));
  assert.deepEqual(commerce.snapshot(), before);
  assert.deepEqual(store.audit(), audit);
});
test('fallo al registrar evento revierte pedido y existencias', (t) => {
  const { store, commerce, checkout } = fixture(t);
  const before = commerce.snapshot();
  store.db.exec(
    "CREATE TRIGGER fail_order BEFORE INSERT ON audit WHEN NEW.action='order.confirmed' BEGIN SELECT RAISE(ABORT,'failure'); END",
  );
  assert.throws(() => checkout.execute(editor, request()));
  assert.deepEqual(commerce.snapshot(), before);
});
test('rechaza precios cambiados, artículos retirados, duplicados y cantidades inválidas', (t) => {
  const { store, commerce, checkout } = fixture(t);
  const before = commerce.snapshot();
  const price = request();
  price.lines[0]!.expectedPriceCents = 1;
  assert.throws(() => checkout.execute(editor, price), errorCode('PRICE_CHANGED'));
  for (const quantity of [0, -1, 1.5, 101])
    assert.throws(() => checkout.execute(editor, request(quantity)), errorCode('INVALID_BASKET'));
  const duplicate = request();
  duplicate.lines.push(duplicate.lines[0]!);
  assert.throws(() => checkout.execute(editor, duplicate), errorCode('INVALID_BASKET'));
  store.db.prepare("UPDATE products SET active=0 WHERE id='nc1'").run();
  assert.throws(() => checkout.execute(editor, request()), errorCode('PRODUCT_UNAVAILABLE'));
  assert.deepEqual(commerce.snapshot(), before);
});
test('cuentas de lectura y revisión no compran ni envían totales impuestos por cliente', (t) => {
  const { checkout } = fixture(t);
  for (const role of ['viewer', 'reviewer'])
    assert.throws(() => checkout.execute({ id: role, role }, request()), errorCode('FORBIDDEN'));
  assert.throws(
    () => checkout.execute(editor, { ...request(), totalCents: 1 }),
    errorCode('INVALID_BASKET'),
  );
});
test('dos conexiones compitiendo por la última unidad no venden stock negativo; reinicio no repone', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'changelab-commerce-'));
  const path = join(directory, 'test.sqlite');
  const first = new Store(path),
    firstCommerce = new CommerceStore(first);
  const second = new Store(path),
    secondCommerce = new CommerceStore(second);
  t.after(() => {
    first.close();
    second.close();
    rmSync(directory, { recursive: true, force: true });
  });
  first.db.prepare("UPDATE inventory SET quantity=1 WHERE productId='nc1'").run();
  const a = new Checkout(firstCommerce, randomUUID, () => new Date().toISOString());
  const b = new Checkout(secondCommerce, randomUUID, () => new Date().toISOString());
  a.execute(editor, request(1));
  assert.throws(() => b.execute(editor, request(1)), errorCode('INSUFFICIENT_STOCK'));
  new CommerceStore(second);
  assert.equal(
    secondCommerce.snapshot().inventory.find((row) => row.productId === 'nc1')?.quantity,
    0,
  );
  assert.equal(secondCommerce.snapshot().sales.length, 1);
});

test('sesión invitada persiste al recrearla y caducada no autentica', (t) => {
  const { store } = fixture(t);
  const sessions = new CustomerSessions(store.db);
  const created = sessions.create();
  assert.equal(new CustomerSessions(store.db).require(created.token).id, created.id);
  assert.equal(sessions.current('inventada'), undefined);
  assert.equal(
    store.db.prepare('SELECT hash FROM customer_sessions').get()?.hash === created.token,
    false,
  );
  store.db.prepare('UPDATE customer_sessions SET expiresAt=0').run();
  assert.throws(() => sessions.require(created.token), errorCode('CUSTOMER_SESSION'));
});
test('datos de cliente quedan en instantánea y reintento con otros datos se rechaza', (t) => {
  const { checkout, commerce } = fixture(t);
  const body = {
    ...request(1),
    customer: { name: 'Cliente demo', email: 'demo@example.com', address: 'Calle Prueba 1' },
  };
  const sale = checkout.customerCheckout('guest-test', body);
  assert.deepEqual(commerce.snapshot().sales[0]?.customer, body.customer);
  assert.deepEqual(checkout.customerCheckout('guest-test', body), sale);
  assert.throws(
    () =>
      checkout.customerCheckout('guest-test', {
        ...body,
        customer: { ...body.customer, name: 'Otra persona' },
      }),
    errorCode('REQUEST_REUSED'),
  );
});

test('pedido preparado y enviado conserva stock; enviado no se cancela', (t) => {
  const { store, commerce, checkout } = fixture(t);
  const sale = checkout.execute(editor, request(1)),
    manager = new ManageOrder(commerce);
  manager.execute(editor, sale.id, { status: 'prepared', expectedStatus: 'confirmed' });
  manager.execute(editor, sale.id, { status: 'shipped', expectedStatus: 'prepared' });
  assert.equal(commerce.sale(sale.id)?.status, 'shipped');
  assert.equal(commerce.snapshot().inventory.find((row) => row.productId === 'nc1')?.quantity, 19);
  assert.throws(
    () => manager.execute(editor, sale.id, { status: 'cancelled', expectedStatus: 'shipped' }),
    errorCode('INVALID_TRANSITION'),
  );
  assert.equal(store.verifyAudit(), true);
});
test('cancelar devuelve unidades una sola vez y excluye venta y coste de métricas', (t) => {
  const { store, commerce, checkout } = fixture(t);
  const sale = checkout.execute(editor, request(2)),
    manager = new ManageOrder(commerce);
  const input = { status: 'cancelled', expectedStatus: 'confirmed' };
  manager.execute(editor, sale.id, input);
  const audit = store.audit();
  manager.execute(editor, sale.id, input);
  assert.deepEqual(store.audit(), audit);
  assert.equal(commerce.snapshot().inventory.find((row) => row.productId === 'nc1')?.quantity, 20);
  assert.equal(commerce.snapshot().metrics.orders, 1);
  assert.equal(commerce.snapshot().metrics.cancelledOrders, 1);
  assert.equal(commerce.snapshot().metrics.revenueCents, 0);
  assert.equal(commerce.snapshot().metrics.costCents, 0);
  assert.equal(
    commerce.snapshot().movements.filter((row) => row.kind === 'cancellation').length,
    1,
  );
  assert.equal(commerce.sale(sale.id)?.totalCents, sale.totalCents);
  assert.equal(customerView(commerce.sale(sale.id)!).status, 'cancelled');
});
test('fallo de auditoría revierte cancelación, estado, stock y movimientos', (t) => {
  const { store, commerce, checkout } = fixture(t);
  const sale = checkout.execute(editor, request()),
    before = commerce.snapshot();
  store.db.exec(
    "CREATE TRIGGER fail_status BEFORE INSERT ON audit WHEN NEW.action='order.status-changed' BEGIN SELECT RAISE(ABORT,'failure'); END",
  );
  assert.throws(() =>
    new ManageOrder(commerce).execute(editor, sale.id, {
      status: 'cancelled',
      expectedStatus: 'confirmed',
    }),
  );
  assert.deepEqual(commerce.snapshot(), before);
});
test('cancelar no puede superar el límite de existencias y conserva el pedido si falla', (t) => {
  const { store, commerce, checkout } = fixture(t);
  const sale = checkout.execute(editor, request());
  store.db.prepare('UPDATE inventory SET quantity=1000000 WHERE productId=?').run('nc1');
  const before = commerce.snapshot();
  const audit = store.audit();
  assert.throws(
    () =>
      new ManageOrder(commerce).execute(editor, sale.id, {
        status: 'cancelled',
        expectedStatus: 'confirmed',
      }),
    errorCode('STOCK_LIMIT'),
  );
  assert.deepEqual(commerce.snapshot(), before);
  assert.deepEqual(store.audit(), audit);
});
test('estados desactualizados, saltos, pedidos inexistentes y roles sin permiso se rechazan', (t) => {
  const { commerce, checkout } = fixture(t),
    sale = checkout.execute(editor, request());
  const manager = new ManageOrder(commerce);
  for (const role of ['reviewer', 'viewer', 'customer'])
    assert.throws(
      () =>
        manager.execute({ id: role, role }, sale.id, {
          status: 'prepared',
          expectedStatus: 'confirmed',
        }),
      errorCode('FORBIDDEN'),
    );
  assert.throws(
    () => manager.execute(editor, 'no-existe', { status: 'prepared', expectedStatus: 'confirmed' }),
    errorCode('ORDER_NOT_FOUND'),
  );
  assert.throws(
    () => manager.execute(editor, sale.id, { status: 'shipped', expectedStatus: 'confirmed' }),
    errorCode('INVALID_TRANSITION'),
  );
  assert.throws(
    () =>
      manager.execute(editor, sale.id, {
        status: 'prepared',
        expectedStatus: 'confirmed',
        quantity: 100,
      }),
    errorCode('INVALID_STATUS'),
  );
  manager.execute(editor, sale.id, { status: 'prepared', expectedStatus: 'confirmed' });
  assert.throws(
    () => manager.execute(editor, sale.id, { status: 'cancelled', expectedStatus: 'confirmed' }),
    errorCode('ORDER_CHANGED'),
  );
});

test('recepción incrementa stock sin modificar precio/coste ni métricas y reintento no duplica', (t) => {
  const { store, commerce } = fixture(t),
    service = new ReceiveStock(commerce, randomUUID, () => new Date().toISOString());
  const body = {
    requestId: randomUUID(),
    productId: 'nc1',
    quantity: 5,
    supplier: 'Proveedor Demo',
    reference: 'ALB-001',
  };
  const products = commerce.products(),
    metrics = commerce.snapshot().metrics;
  const receipt = service.execute(editor, body),
    audit = store.audit();
  assert.deepEqual(service.execute(editor, body), receipt);
  assert.deepEqual(store.audit(), audit);
  assert.deepEqual(commerce.products(), products);
  assert.deepEqual(commerce.snapshot().metrics, metrics);
  assert.equal(commerce.snapshot().inventory.find((row) => row.productId === 'nc1')?.quantity, 25);
  assert.equal(commerce.snapshot().movements.filter((row) => row.kind === 'receipt').length, 1);
  assert.throws(
    () =>
      service.execute(editor, {
        ...body,
        requestId: randomUUID(),
        supplier: 'proveedor demo',
        reference: 'alb-001',
      }),
    errorCode('DUPLICATE_RECEIPT'),
  );
  assert.throws(
    () => service.execute(editor, { ...body, quantity: 6 }),
    errorCode('RECEIPT_REUSED'),
  );
});
test('recepción valida rol, cantidades, producto y límite; fallo de auditoría revierte todo', (t) => {
  const { store, commerce } = fixture(t),
    service = new ReceiveStock(commerce, randomUUID, () => new Date().toISOString());
  const body = {
    requestId: randomUUID(),
    productId: 'nc1',
    quantity: 5,
    supplier: 'Proveedor Demo',
    reference: 'ALB-001',
  };
  for (const role of ['viewer', 'reviewer'])
    assert.throws(() => service.execute({ id: role, role }, body), errorCode('FORBIDDEN'));
  for (const quantity of [0, -1, 1.5, 10001])
    assert.throws(
      () => service.execute(editor, { ...body, quantity }),
      errorCode('INVALID_RECEIPT'),
    );
  assert.throws(
    () => service.execute(editor, { ...body, productId: 'missing' }),
    errorCode('PRODUCT_UNAVAILABLE'),
  );
  store.db.prepare("UPDATE inventory SET quantity=1000000 WHERE productId='nc1'").run();
  assert.throws(() => service.execute(editor, body), errorCode('STOCK_LIMIT'));
  store.db.prepare("UPDATE inventory SET quantity=20 WHERE productId='nc1'").run();
  const before = commerce.snapshot();
  store.db.exec(
    "CREATE TRIGGER fail_receipt BEFORE INSERT ON audit WHEN NEW.action='inventory.received' BEGIN SELECT RAISE(ABORT,'failure'); END",
  );
  assert.throws(() => service.execute(editor, body));
  assert.deepEqual(commerce.snapshot(), before);
});

test('borrador desglosa total con IVA incluido al céntimo sin cambiar pedido ni stock', (t) => {
  const { store, commerce, checkout } = fixture(t),
    sale = checkout.execute(editor, request(1));
  const before = commerce.snapshot(),
    body = {
      issuer: { name: 'Emisor Demo', taxId: 'DEMO-001', address: 'Calle Emisor 1' },
      recipient: { name: 'Cliente Demo', taxId: 'DEMO-002', address: 'Calle Cliente 2' },
      acceptDemoTax: true,
    };
  const service = new PrepareInvoiceDraft(commerce, randomUUID, () => new Date().toISOString());
  const draft = service.execute(editor, sale.id, body);
  assert.equal(draft.totalCents, 9668);
  assert.equal(draft.baseCents, 7990);
  assert.equal(draft.taxCents, 1678);
  assert.equal(draft.baseCents + draft.taxCents, draft.totalCents);
  assert.deepEqual(commerce.sale(sale.id), sale);
  assert.deepEqual(commerce.snapshot().inventory, before.inventory);
  assert.deepEqual(commerce.snapshot().metrics, before.metrics);
  const events = store.audit();
  assert.deepEqual(service.execute(editor, sale.id, body), draft);
  assert.deepEqual(store.audit(), events);
  assert.throws(
    () =>
      service.execute(editor, sale.id, {
        ...body,
        issuer: { ...body.issuer, name: 'Otro emisor' },
      }),
    errorCode('DRAFT_EXISTS'),
  );
  assert.equal(store.verifyAudit(), true);
});
test('borrador rechaza permisos, cancelados, datos incompletos e hipótesis fiscal no aceptada', (t) => {
  const { commerce, checkout } = fixture(t),
    sale = checkout.execute(editor, request()),
    service = new PrepareInvoiceDraft(commerce, randomUUID, () => new Date().toISOString());
  const body = {
    issuer: { name: 'Emisor Demo', taxId: 'DEMO-001', address: 'Calle Emisor 1' },
    recipient: { name: 'Cliente Demo', taxId: 'DEMO-002', address: 'Calle Cliente 2' },
    acceptDemoTax: true,
  };
  assert.throws(
    () => service.execute({ id: 'v', role: 'viewer' }, sale.id, body),
    errorCode('FORBIDDEN'),
  );
  assert.throws(
    () => service.execute(editor, sale.id, { ...body, acceptDemoTax: false }),
    errorCode('DEMO_TAX_REQUIRED'),
  );
  assert.throws(
    () => service.execute(editor, sale.id, { ...body, recipient: {} }),
    errorCode('FISCAL_DATA'),
  );
  new ManageOrder(commerce).execute(editor, sale.id, {
    status: 'cancelled',
    expectedStatus: 'confirmed',
  });
  assert.throws(() => service.execute(editor, sale.id, body), errorCode('ORDER_CANCELLED'));
});
test('fallo de auditoría no deja borrador parcial', (t) => {
  const { store, commerce, checkout } = fixture(t),
    sale = checkout.execute(editor, request()),
    before = commerce.snapshot();
  store.db.exec(
    "CREATE TRIGGER fail_draft BEFORE INSERT ON audit WHEN NEW.action='billing.draft-created' BEGIN SELECT RAISE(ABORT,'failure'); END",
  );
  assert.throws(() =>
    new PrepareInvoiceDraft(commerce, randomUUID, () => new Date().toISOString()).execute(
      editor,
      sale.id,
      {
        issuer: { name: 'Emisor Demo', taxId: 'DEMO-001', address: 'Calle Emisor 1' },
        recipient: { name: 'Cliente Demo', taxId: 'DEMO-002', address: 'Calle Cliente 2' },
        acceptDemoTax: true,
      },
    ),
  );
  assert.deepEqual(commerce.snapshot(), before);
});
test('desglose por línea conserva el total y detecta inconsistencias del pedido', (t) => {
  const { checkout } = fixture(t),
    sale = checkout.execute(editor, request());
  const { tax: ignoredTax, ...saleWithoutTax } = sale;
  const modified = {
    ...saleWithoutTax,
    lines: [
      { ...sale.lines[0]!, unitPriceCents: 1, quantity: 1 },
      { ...sale.lines[0]!, unitPriceCents: 199, quantity: 3 },
    ],
    totalCents: 598,
  };
  const result = calculateDraftLines(modified);
  assert.equal(result.totalCents, 598);
  assert.equal(result.baseCents + result.taxCents, 598);
  assert.throws(
    () => calculateDraftLines({ ...modified, totalCents: 599 }),
    errorCode('INVALID_ORDER_AMOUNT'),
  );
});

test('corregir borrador conserva versiones, motivo e importes y rechaza edición antigua', (t) => {
  const { commerce, checkout } = fixture(t),
    sale = checkout.execute(editor, request(1));
  const body = {
    issuer: { name: 'Emisor Demo', taxId: 'DEMO-001', address: 'Calle Emisor 1' },
    recipient: { name: 'Cliente Demo', taxId: 'DEMO-002', address: 'Calle Cliente 2' },
    acceptDemoTax: true,
  };
  const original = new PrepareInvoiceDraft(commerce, randomUUID, () =>
    new Date().toISOString(),
  ).execute(editor, sale.id, body);
  const service = new ReviseDraft(commerce, () => new Date().toISOString());
  const input = {
    issuer: original.issuer,
    recipient: { ...original.recipient, address: 'Calle Corregida 3' },
    expectedVersion: 1,
    reason: 'Corregir domicilio de prueba',
  };
  const revised = service.execute(editor, original.id, input);
  assert.equal(revised.version, 2);
  assert.equal(revised.totalCents, original.totalCents);
  const history = commerce.draftHistory(original.id);
  assert.equal(history.length, 2);
  assert.deepEqual(history[0]?.document, original);
  assert.equal(history[1]?.reason, input.reason);
  assert.throws(() => service.execute(editor, original.id, input), errorCode('DRAFT_CHANGED'));
  assert.throws(
    () => service.execute({ id: 'v', role: 'viewer' }, original.id, input),
    errorCode('FORBIDDEN'),
  );
  assert.throws(
    () => service.execute(editor, original.id, { ...input, expectedVersion: 2, reason: '' }),
    errorCode('INVALID_REVISION'),
  );
});
test('fallo de auditoría revierte revisión e histórico', (t) => {
  const { store, commerce, checkout } = fixture(t),
    sale = checkout.execute(editor, request());
  const body = {
    issuer: { name: 'Emisor Demo', taxId: 'DEMO-001', address: 'Calle Emisor 1' },
    recipient: { name: 'Cliente Demo', taxId: 'DEMO-002', address: 'Calle Cliente 2' },
    acceptDemoTax: true,
  };
  const original = new PrepareInvoiceDraft(commerce, randomUUID, () =>
    new Date().toISOString(),
  ).execute(editor, sale.id, body);
  store.db.exec(
    "CREATE TRIGGER fail_revision BEFORE INSERT ON audit WHEN NEW.action='billing.draft-revised' BEGIN SELECT RAISE(ABORT,'failure'); END",
  );
  assert.throws(() =>
    new ReviseDraft(commerce, () => new Date().toISOString()).execute(editor, original.id, {
      issuer: original.issuer,
      recipient: { ...original.recipient, name: 'Cliente Corregido' },
      expectedVersion: 1,
      reason: 'Corregir nombre de prueba',
    }),
  );
  assert.deepEqual(commerce.draft(original.id), original);
  assert.equal(commerce.draftHistory(original.id).length, 0);
});

test('nuevos pedidos guardan IVA; histórico se mantiene sin snapshot y no se mezcla', (t) => {
  const { store, commerce, checkout } = fixture(t);
  const sale = checkout.execute(editor, request(1));
  assert.deepEqual(sale.tax, {
    policy: 'demo-net-v1',
    rate: 21,
    baseCents: 7990,
    taxCents: 1678,
    totalCents: 9668,
  });
  assert.equal(customerView(sale).totalCents, 9668);
  assert.equal(commerce.snapshot().fiscalMetrics.grossMarginCents, 3090);
  const { tax: ignoredTax, ...saleWithoutTax } = sale;
  const historical = { ...saleWithoutTax, id: 'historical-demo', requestId: randomUUID() };
  store.db
    .prepare('INSERT INTO sales VALUES(?,?,?,?)')
    .run(historical.id, historical.actorId, historical.requestId, JSON.stringify(historical));
  assert.equal(commerce.snapshot().fiscalMetrics.historicalOrders, 1);
  assert.equal(commerce.snapshot().fiscalMetrics.totalCents, 9668);
  const legacy = calculateDraftLines(historical);
  assert.equal(legacy.baseCents, 6603);
  assert.equal(legacy.taxCents, 1387);
  new ManageOrder(commerce).execute(editor, sale.id, {
    status: 'cancelled',
    expectedStatus: 'confirmed',
  });
  assert.equal(commerce.snapshot().fiscalMetrics.totalCents, 0);
});

test('emisión demo es correlativa, fija versión y bloquea cambios posteriores', (t) => {
  const { commerce, checkout } = fixture(t);
  const body = {
    issuer: { name: 'Emisor Demo', taxId: 'DEMO-001', address: 'Calle Emisor 1' },
    recipient: { name: 'Cliente Demo', taxId: 'DEMO-002', address: 'Calle Cliente 2' },
    acceptDemoTax: true,
  };
  const draftService = new PrepareInvoiceDraft(commerce, randomUUID, () =>
    new Date().toISOString(),
  );
  const issue = new IssueDemoInvoice(commerce, randomUUID, () => '2026-10-27T12:00:00Z');
  const sale = checkout.execute(editor, request(1)),
    draft = draftService.execute(editor, sale.id, body);
  const invoice = issue.execute(editor, draft.id, { expectedVersion: 1, confirmDemo: true });
  assert.equal(invoice.number, 'DEMO-2026-000001');
  assert.deepEqual(
    issue.execute(editor, draft.id, { expectedVersion: 1, confirmDemo: true }),
    invoice,
  );
  const second = draftService.execute(editor, checkout.execute(editor, request(1)).id, body);
  assert.equal(
    issue.execute(editor, second.id, { expectedVersion: 1, confirmDemo: true }).number,
    'DEMO-2026-000002',
  );
  assert.throws(
    () =>
      new ReviseDraft(commerce, () => new Date().toISOString()).execute(editor, draft.id, {
        issuer: draft.issuer,
        recipient: { ...draft.recipient, name: 'Otro cliente' },
        expectedVersion: 1,
        reason: 'Corrección de prueba',
      }),
    errorCode('ALREADY_ISSUED'),
  );
  assert.throws(
    () =>
      new ManageOrder(commerce).execute(editor, sale.id, {
        status: 'cancelled',
        expectedStatus: 'confirmed',
      }),
    errorCode('ISSUED_ORDER'),
  );
});
test('fallo de emisión revierte número y documento; valida rol, versión y confirmación', (t) => {
  const { store, commerce, checkout } = fixture(t);
  const draft = new PrepareInvoiceDraft(commerce, randomUUID, () =>
    new Date().toISOString(),
  ).execute(editor, checkout.execute(editor, request()).id, {
    issuer: { name: 'Emisor Demo', taxId: 'DEMO-001', address: 'Calle Emisor 1' },
    recipient: { name: 'Cliente Demo', taxId: 'DEMO-002', address: 'Calle Cliente 2' },
    acceptDemoTax: true,
  });
  const issue = new IssueDemoInvoice(commerce, randomUUID, () => '2026-10-27T12:00:00Z');
  assert.throws(
    () =>
      issue.execute({ id: 'viewer', role: 'viewer' }, draft.id, {
        expectedVersion: 1,
        confirmDemo: true,
      }),
    errorCode('FORBIDDEN'),
  );
  assert.throws(
    () => issue.execute(editor, draft.id, { expectedVersion: 2, confirmDemo: true }),
    errorCode('DRAFT_CHANGED'),
  );
  assert.throws(
    () => issue.execute(editor, draft.id, { expectedVersion: 1, confirmDemo: false }),
    errorCode('INVALID_ISSUANCE'),
  );
  store.db.exec(
    "CREATE TRIGGER fail_issue BEFORE INSERT ON audit WHEN NEW.action='billing.demo-issued' BEGIN SELECT RAISE(ABORT,'failure'); END",
  );
  assert.throws(() => issue.execute(editor, draft.id, { expectedVersion: 1, confirmDemo: true }));
  assert.equal(commerce.invoiceForDraft(draft.id), undefined);
  store.db.exec('DROP TRIGGER fail_issue');
  const invoice = issue.execute(editor, draft.id, { expectedVersion: 1, confirmDemo: true });
  assert.equal(invoice.number, 'DEMO-2026-000001');
  assert.throws(() => store.db.prepare('DELETE FROM demo_invoices WHERE id=?').run(invoice.id));
});

test('rectificación total conserva original, compensa importes y no mueve stock ni pedidos', (t) => {
  const { store, commerce, checkout } = fixture(t),
    sale = checkout.execute(editor, request(1));
  const draft = new PrepareInvoiceDraft(commerce, randomUUID, () =>
    new Date().toISOString(),
  ).execute(editor, sale.id, {
    issuer: { name: 'Emisor Demo', taxId: 'DEMO-001', address: 'Calle Emisor 1' },
    recipient: { name: 'Cliente Demo', taxId: 'DEMO-002', address: 'Calle Cliente 2' },
    acceptDemoTax: true,
  });
  const invoice = new IssueDemoInvoice(commerce, randomUUID, () => '2026-10-27T12:00:00Z').execute(
    editor,
    draft.id,
    { expectedVersion: 1, confirmDemo: true },
  );
  const before = commerce.snapshot(),
    service = new RectifyDemoInvoice(commerce, randomUUID, () => '2026-10-27T12:00:00Z');
  const input = {
    reason: 'Compensación documental de prueba',
    confirmDemo: true,
    expectedNumber: invoice.number,
  };
  const credit = service.execute(editor, invoice.id, input);
  assert.equal(credit.number, 'DEMO-R-2026-000001');
  assert.equal(credit.totalCents, -9668);
  assert.equal(credit.baseCents, -7990);
  assert.equal(credit.taxCents, -1678);
  assert.deepEqual(commerce.invoice(invoice.id), invoice);
  assert.deepEqual(commerce.snapshot().inventory, before.inventory);
  assert.deepEqual(commerce.snapshot().sales, before.sales);
  assert.equal(commerce.snapshot().billingMetrics.balanceCents, 0);
  const audit = store.audit();
  assert.deepEqual(service.execute(editor, invoice.id, input), credit);
  assert.deepEqual(store.audit(), audit);
  assert.throws(
    () => service.execute(editor, invoice.id, { ...input, reason: 'Otro motivo distinto' }),
    errorCode('ALREADY_CORRECTED'),
  );
  assert.throws(
    () => service.execute({ id: 'reader', role: 'viewer' }, invoice.id, input),
    errorCode('FORBIDDEN'),
  );
});
test('fallo de auditoría revierte rectificación y contador separado', (t) => {
  const { store, commerce, checkout } = fixture(t),
    sale = checkout.execute(editor, request());
  const draft = new PrepareInvoiceDraft(commerce, randomUUID, () =>
    new Date().toISOString(),
  ).execute(editor, sale.id, {
    issuer: { name: 'Emisor Demo', taxId: 'DEMO-001', address: 'Calle Emisor 1' },
    recipient: { name: 'Cliente Demo', taxId: 'DEMO-002', address: 'Calle Cliente 2' },
    acceptDemoTax: true,
  });
  const invoice = new IssueDemoInvoice(commerce, randomUUID, () => '2026-10-27T12:00:00Z').execute(
    editor,
    draft.id,
    { expectedVersion: 1, confirmDemo: true },
  );
  const service = new RectifyDemoInvoice(commerce, randomUUID, () => '2026-10-27T12:00:00Z'),
    input = {
      reason: 'Rectificación de prueba',
      confirmDemo: true,
      expectedNumber: invoice.number,
    };
  assert.throws(
    () => service.execute(editor, invoice.id, { ...input, expectedNumber: 'OTRO' }),
    errorCode('INVOICE_CHANGED'),
  );
  assert.throws(
    () => service.execute(editor, invoice.id, { ...input, confirmDemo: false }),
    errorCode('INVALID_CORRECTION'),
  );
  store.db.exec(
    "CREATE TRIGGER fail_credit BEFORE INSERT ON audit WHEN NEW.action='billing.demo-corrected' BEGIN SELECT RAISE(ABORT,'failure'); END",
  );
  assert.throws(() => service.execute(editor, invoice.id, input));
  assert.equal(commerce.correctionForInvoice(invoice.id), undefined);
  store.db.exec('DROP TRIGGER fail_credit');
  assert.equal(service.execute(editor, invoice.id, input).number, 'DEMO-R-2026-000001');
});

test('devolución enviada repone una vez, excluye ventas y conserva pedido e importes', (t) => {
  const { store, commerce, checkout } = fixture(t),
    sale = checkout.execute(editor, request(2));
  const manager = new ManageOrder(commerce);
  manager.execute(editor, sale.id, { status: 'prepared', expectedStatus: 'confirmed' });
  manager.execute(editor, sale.id, { status: 'shipped', expectedStatus: 'prepared' });
  const warehouse = new Warehouse(commerce, () => new Date().toISOString()),
    body = { reason: 'Devolución de prueba completa', confirmReceived: true };
  warehouse.returnAll(editor, sale.id, body);
  const audit = store.audit();
  warehouse.returnAll(editor, sale.id, body);
  assert.deepEqual(store.audit(), audit);
  assert.equal(commerce.snapshot().inventory.find((row) => row.productId === 'nc1')?.quantity, 20);
  assert.equal(commerce.sale(sale.id)?.status, 'returned');
  assert.equal(commerce.sale(sale.id)?.totalCents, sale.totalCents);
  assert.equal(commerce.snapshot().fiscalMetrics.totalCents, 0);
  assert.equal(commerce.snapshot().movements.filter((row) => row.kind === 'return').length, 1);
  assert.throws(() =>
    warehouse.returnAll(editor, sale.id, { ...body, reason: 'Otro motivo distinto' }),
  );
});
test('ajuste valida stock revisado, límites, permisos y reintentos', (t) => {
  const { commerce } = fixture(t),
    warehouse = new Warehouse(commerce, () => new Date().toISOString());
  const body = {
    requestId: randomUUID(),
    productId: 'nc1',
    expectedQuantity: 20,
    delta: -2,
    reason: 'Rotura de dos garrafas de prueba',
  };
  const first = warehouse.adjust(editor, body);
  assert.deepEqual(warehouse.adjust(editor, body), first);
  assert.equal(commerce.snapshot().inventory.find((row) => row.productId === 'nc1')?.quantity, 18);
  assert.throws(() => warehouse.adjust(editor, { ...body, requestId: randomUUID() }));
  assert.throws(() =>
    warehouse.adjust(editor, {
      ...body,
      requestId: randomUUID(),
      expectedQuantity: 18,
      delta: -19,
    }),
  );
  assert.throws(() => warehouse.adjust({ id: 'reader', role: 'viewer' }, body));
});
test('fallo de auditoría revierte devolución completa y no admite devolución de no enviado', (t) => {
  const { store, commerce, checkout } = fixture(t),
    sale = checkout.execute(editor, request());
  const warehouse = new Warehouse(commerce, () => new Date().toISOString()),
    body = { reason: 'Devolución de prueba', confirmReceived: true };
  assert.throws(() => warehouse.returnAll(editor, sale.id, body));
  const manager = new ManageOrder(commerce);
  manager.execute(editor, sale.id, { status: 'prepared', expectedStatus: 'confirmed' });
  manager.execute(editor, sale.id, { status: 'shipped', expectedStatus: 'prepared' });
  const before = commerce.snapshot();
  store.db.exec(
    "CREATE TRIGGER fail_return BEFORE INSERT ON audit WHEN NEW.action='order.goods-returned' BEGIN SELECT RAISE(ABORT,'failure'); END",
  );
  assert.throws(() => warehouse.returnAll(editor, sale.id, body));
  assert.deepEqual(commerce.snapshot(), before);
  assert.equal(commerce.goodsReturn(sale.id), undefined);
});
