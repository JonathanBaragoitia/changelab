import { ReverseCash } from '../src/application/cash-reversal.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/infrastructure/store.ts';
import { CommerceStore } from '../src/infrastructure/commerce-store.ts';
import { ExpenseStore } from '../src/infrastructure/expense-store.ts';
import { CashStore } from '../src/infrastructure/cash-store.ts';
import { RegisterCash } from '../src/application/cash.ts';
import { Checkout } from '../src/application/commerce.ts';
import { RegisterExpense } from '../src/application/economics.ts';
const editor = { id: 'editor', role: 'editor' };
function setup(t: test.TestContext) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store),
    expenses = new ExpenseStore(store),
    cash = new CashStore(store, commerce, expenses);
  const sale = new Checkout(commerce, randomUUID, () => new Date().toISOString()).execute(editor, {
    requestId: randomUUID(),
    lines: [{ productId: 'nc1', quantity: 1, expectedPriceCents: 7990 }],
  });
  return { store, commerce, expenses, cash, sale, service: new RegisterCash(cash) };
}
test('cobro parcial y completo no duplican; exceso se rechaza sin alterar ventas', (t) => {
  const { cash, service, sale, commerce } = setup(t),
    before = commerce.snapshot().metrics;
  const body = {
    requestId: randomUUID(),
    kind: 'collection',
    targetId: sale.id,
    amountCents: 1000,
    date: '2026-10-27',
    reference: 'COBRO-001',
    method: 'Transferencia',
  };
  const first = service.execute(editor, body);
  assert.deepEqual(service.execute(editor, body), first);
  assert.equal(cash.report().targets[0]?.pendingCents, 8668);
  assert.throws(() =>
    service.execute(editor, {
      ...body,
      requestId: randomUUID(),
      reference: 'COBRO-002',
      amountCents: 8669,
    }),
  );
  service.execute(editor, {
    ...body,
    requestId: randomUUID(),
    reference: 'COBRO-002',
    amountCents: 8668,
  });
  assert.equal(cash.report().targets[0]?.pendingCents, 0);
  assert.equal(cash.report().collectedCents, 9668);
  assert.deepEqual(commerce.snapshot().metrics, before);
});
test('pago de gasto usa total con IVA; valida roles y no acredita otro pago', (t) => {
  const { cash, service, expenses } = setup(t);
  const expense = new RegisterExpense(expenses).execute(editor, {
    requestId: randomUUID(),
    date: '2026-10-27',
    reference: 'GASTO',
    category: 'Servicios',
    description: 'Servicio demo',
    baseCents: 1000,
    vatRate: 21,
  });
  const body = {
    requestId: randomUUID(),
    kind: 'payment',
    targetId: expense.requestId,
    amountCents: 1210,
    date: '2026-10-27',
    reference: 'PAGO-001',
    method: 'Tarjeta',
  };
  assert.throws(() => service.execute({ id: 'v', role: 'viewer' }, body));
  service.execute(editor, body);
  assert.equal(cash.report().paidCents, 1210);
  assert.equal(cash.report().targets.find((t) => t.kind === 'payment')?.pendingCents, 0);
  assert.throws(() => service.execute(editor, { ...body, requestId: randomUUID() }));
});
test('fallo de auditoría revierte anotación y pedidos cancelados no admiten nuevos cobros', (t) => {
  const { store, cash, service, sale, commerce } = setup(t);
  const body = {
    requestId: randomUUID(),
    kind: 'collection',
    targetId: sale.id,
    amountCents: 1000,
    date: '2026-10-27',
    reference: 'COBRO',
    method: 'Efectivo',
  };
  store.db.exec(
    "CREATE TRIGGER fail_cash BEFORE INSERT ON audit WHEN NEW.action='cash.registered' BEGIN SELECT RAISE(ABORT,'failure'); END",
  );
  assert.throws(() => service.execute(editor, body));
  assert.equal(cash.all().length, 0);
  store.db.exec('DROP TRIGGER fail_cash');
  service.execute(editor, body);
  commerce.replaceSale({ ...sale, status: 'cancelled' });
  assert.equal(cash.report().targets[0]?.pendingCents, -1000);
  assert.throws(() =>
    service.execute(editor, { ...body, requestId: randomUUID(), reference: 'OTRA' }),
  );
});

test('anular cobro conserva original y recalcula pendiente una sola vez', (t) => {
  const { store, cash, service, sale } = setup(t);
  const original = service.execute(editor, {
    requestId: randomUUID(),
    kind: 'collection',
    targetId: sale.id,
    amountCents: 2000,
    date: '2026-10-27',
    reference: 'COBRO',
    method: 'Transferencia',
  });
  const reverse = new ReverseCash(cash, () => new Date().toISOString()),
    body = { reason: 'Importe anotado por error' };
  reverse.execute(editor, original.requestId, body);
  assert.deepEqual(cash.entry(original.requestId), original);
  assert.equal(cash.report().collectedCents, 0);
  assert.equal(cash.report().targets[0]?.pendingCents, 9668);
  const audit = store.audit();
  reverse.execute(editor, original.requestId, body);
  assert.deepEqual(store.audit(), audit);
  assert.throws(() =>
    reverse.execute(editor, original.requestId, { reason: 'Otro motivo diferente' }),
  );
  assert.throws(() => reverse.execute({ id: 'v', role: 'viewer' }, original.requestId, body));
  assert.equal(store.verifyAudit(), true);
});
test('anular pago revierte pendiente y un fallo no deja anulación parcial', (t) => {
  const { store, cash, expenses, service } = setup(t);
  const expense = new RegisterExpense(expenses).execute(editor, {
    requestId: randomUUID(),
    date: '2026-10-27',
    reference: 'GASTO',
    category: 'Servicios',
    description: 'Servicio demo',
    baseCents: 1000,
    vatRate: 21,
  });
  const entry = service.execute(editor, {
    requestId: randomUUID(),
    kind: 'payment',
    targetId: expense.requestId,
    amountCents: 1210,
    date: '2026-10-27',
    reference: 'PAGO',
    method: 'Tarjeta',
  });
  const reverse = new ReverseCash(cash, () => new Date().toISOString()),
    body = { reason: 'Pago anotado por error' };
  store.db.exec(
    "CREATE TRIGGER fail_reversal BEFORE INSERT ON audit WHEN NEW.action='cash.reversed' BEGIN SELECT RAISE(ABORT,'failure'); END",
  );
  assert.throws(() => reverse.execute(editor, entry.requestId, body));
  assert.equal(cash.reversal(entry.requestId), undefined);
  assert.equal(cash.report().paidCents, 1210);
  store.db.exec('DROP TRIGGER fail_reversal');
  reverse.execute(editor, entry.requestId, body);
  assert.equal(cash.report().paidCents, 0);
  assert.equal(
    cash.report().targets.find((target) => target.kind === 'payment')?.pendingCents,
    1210,
  );
});
