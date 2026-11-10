import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/infrastructure/store.ts';
import { CommerceStore } from '../src/infrastructure/commerce-store.ts';
import { CashStore } from '../src/infrastructure/cash-store.ts';
import { ExpenseStore } from '../src/infrastructure/expense-store.ts';
import { Checkout } from '../src/application/commerce.ts';
import { ManageOrder } from '../src/application/order-management.ts';
import { Warehouse } from '../src/application/warehouse.ts';
import { RegisterCash } from '../src/application/cash.ts';
import { ReverseCash } from '../src/application/cash-reversal.ts';
import { RegisterRefund } from '../src/application/refunds.ts';
import { reconcileOrders } from '../src/application/reconciliation.ts';
const actor = { id: 'editor', role: 'editor' };
function setup(t: { after: (fn: () => void) => void }) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store),
    cash = new CashStore(store, commerce, new ExpenseStore(store));
  const sale = new Checkout(commerce, randomUUID, () => new Date().toISOString()).execute(actor, {
    requestId: randomUUID(),
    lines: [{ productId: 'nc1', quantity: 1, expectedPriceCents: 7990 }],
  });
  const payment = new RegisterCash(cash).execute(actor, {
    requestId: randomUUID(),
    kind: 'collection',
    targetId: sale.id,
    amountCents: 9668,
    date: '2026-10-28',
    reference: 'CASH-REFUND',
    method: 'Efectivo',
  });
  const manager = new ManageOrder(commerce);
  manager.execute(actor, sale.id, { status: 'prepared', expectedStatus: 'confirmed' });
  manager.execute(actor, sale.id, { status: 'shipped', expectedStatus: 'prepared' });
  const close = () =>
    new Warehouse(commerce, () => new Date().toISOString()).returnAll(actor, sale.id, {
      reason: 'Devolución completa de prueba',
      confirmReceived: true,
    });
  const input = {
    requestId: randomUUID(),
    orderId: sale.id,
    amountCents: 3000,
    date: '2026-10-28',
    reference: 'REFUND-TEST',
    reason: 'Devolución ficticia de prueba',
  };
  return { store, commerce, cash, sale, payment, close, input, service: new RegisterRefund(cash) };
}
test('reembolso parcial y total conserva cobro, recalcula caja y conciliación; reintento no duplica', (t) => {
  const { store, commerce, cash, payment, close, input, service } = setup(t);
  close();
  const first = service.execute(actor, input),
    audit = store.audit();
  assert.deepEqual(service.execute(actor, input), first);
  assert.deepEqual(store.audit(), audit);
  assert.deepEqual(cash.entry(payment.requestId), payment);
  assert.equal(cash.refundable(input.orderId), 6668);
  assert.equal(cash.report().balanceCents, 6668);
  service.execute(actor, {
    ...input,
    requestId: randomUUID(),
    reference: 'REFUND-REST',
    amountCents: 6668,
  });
  assert.equal(cash.refundable(input.orderId), 0);
  assert.equal(cash.report().balanceCents, 0);
  const s = commerce.snapshot(),
    row = reconcileOrders(s.sales, s.invoices, s.corrections, cash.active(), cash.refunds())[0]!;
  assert.equal(row.pendingCents, 0);
  assert.equal(row.refundedCents, 9668);
  assert.equal(row.collectedCents, 9668);
  assert.equal(row.netCollectedCents, 0);
  assert.deepEqual(row.findings, []);
  assert.throws(() =>
    new ReverseCash(cash, () => new Date().toISOString()).execute(actor, payment.requestId, {
      reason: 'Intento de anular cobro reembolsado',
    }),
  );
  assert.equal(store.verifyAudit(), true);
});
test('rechaza pedido activo, exceso, referencia duplicada, reutilización y roles', (t) => {
  const { cash, close, input, service } = setup(t);
  assert.throws(() => service.execute(actor, input));
  close();
  for (const role of ['viewer', 'reviewer'])
    assert.throws(() => service.execute({ id: role, role }, input));
  for (const change of [
    { amountCents: 9669 },
    { amountCents: 0 },
    { amountCents: 1.5 },
    { date: '2026-02-30' },
    { reason: 'x' },
    { extra: true },
    { reference: 'cash-refund' },
  ])
    assert.throws(() => service.execute(actor, { ...input, ...change }));
  service.execute(actor, input);
  assert.throws(() => service.execute(actor, { ...input, amountCents: 2000 }));
  assert.throws(() => service.execute(actor, { ...input, requestId: randomUUID() }));
  assert.equal(cash.refunds().length, 1);
});
test('fallo de auditoría revierte reembolso y no cambia saldo ni originales', (t) => {
  const { cash, store, close, input, service } = setup(t);
  close();
  const before = cash.report();
  cash.record = () => {
    throw Error('disk');
  };
  assert.throws(() => service.execute(actor, input));
  assert.deepEqual(cash.report(), before);
  assert.equal(store.verifyAudit(), true);
});
import { ReverseRefund } from '../src/application/refund-reversal.ts';
test('corregir reembolso conserva original, restaura pendiente y admite anotación nueva sin reactivar anterior', (t) => {
  const { store, commerce, cash, close, input, service } = setup(t);
  close();
  const refund = service.execute(actor, input);
  const reverse = new ReverseRefund(cash),
    body = { reason: 'Reembolso anotado por error de prueba' };
  const reversal = reverse.execute(actor, refund.requestId, body),
    audit = store.audit();
  assert.deepEqual(reverse.execute(actor, refund.requestId, body), reversal);
  assert.deepEqual(store.audit(), audit);
  assert.deepEqual(cash.refund(refund.requestId), refund);
  assert.equal(cash.refunds().length, 1);
  assert.equal(cash.activeRefunds().length, 0);
  assert.equal(cash.refundable(input.orderId), 9668);
  assert.equal(cash.report().balanceCents, 9668);
  const s = commerce.snapshot();
  assert.equal(
    reconcileOrders(s.sales, s.invoices, s.corrections, cash.active(), cash.activeRefunds())[0]!
      .pendingCents,
    -9668,
  );
  assert.deepEqual(service.execute(actor, input), refund);
  assert.equal(cash.activeRefunds().length, 0);
  service.execute(actor, { ...input, requestId: randomUUID(), reference: 'REFUND-CORREGIDO' });
  assert.equal(cash.activeRefunds().length, 1);
  assert.throws(() =>
    reverse.execute(actor, refund.requestId, { reason: 'Otro motivo diferente' }),
  );
  assert.equal(store.verifyAudit(), true);
});
test('corregir reembolso exige edición, valida motivo y revierte si falla el evento', (t) => {
  const { cash, close, input, service } = setup(t);
  close();
  const refund = service.execute(actor, input),
    reverse = new ReverseRefund(cash);
  for (const role of ['viewer', 'reviewer'])
    assert.throws(() =>
      reverse.execute({ id: role, role }, refund.requestId, { reason: 'Motivo válido' }),
    );
  for (const body of [null, { reason: 'x' }, { reason: 'Motivo válido', extra: true }])
    assert.throws(() => reverse.execute(actor, refund.requestId, body));
  assert.throws(() => reverse.execute(actor, 'missing', { reason: 'Motivo válido' }));
  cash.record = () => {
    throw Error('disk');
  };
  assert.throws(() => reverse.execute(actor, refund.requestId, { reason: 'Motivo válido' }));
  assert.equal(cash.refundReversal(refund.requestId), undefined);
  assert.equal(cash.activeRefunds().length, 1);
  assert.equal(cash.report().refundedCents, 3000);
});
