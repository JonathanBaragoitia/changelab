import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Store } from '../src/infrastructure/store.ts';
import { ExpenseStore } from '../src/infrastructure/expense-store.ts';
import { CashStore } from '../src/infrastructure/cash-store.ts';
import { CommerceStore } from '../src/infrastructure/commerce-store.ts';
import { RegisterExpense, economicReport } from '../src/application/economics.ts';
import { CancelExpense } from '../src/application/expense-cancellation.ts';
import { RegisterCash } from '../src/application/cash.ts';
import { ReverseCash } from '../src/application/cash-reversal.ts';
import { makeServer } from '../src/server.ts';
import { sessions } from './auth-fixture.ts';
const actor = { id: 'editor', role: 'editor' };
function setup(t: { after: (fn: () => void) => void }) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const expenses = new ExpenseStore(store),
    cash = new CashStore(store, new CommerceStore(store), expenses);
  const original = new RegisterExpense(expenses).execute(actor, {
    requestId: randomUUID(),
    date: '2026-10-28',
    reference: 'TEST-EXPENSE',
    category: 'Servicios',
    description: 'Gasto de prueba',
    baseCents: 1000,
    vatRate: 21,
  });
  return {
    store,
    expenses,
    cash,
    original,
    cancel: new CancelExpense(expenses, (id) => cash.settled('payment', id)),
  };
}
test('anular conserva original, excluye resultados y pagos nuevos; reintento no duplica', (t) => {
  const { store, expenses, cash, original, cancel } = setup(t),
    body = { reason: 'Registro duplicado por error' };
  const first = cancel.execute(actor, original.requestId, body),
    audit = store.audit();
  assert.deepEqual(expenses.expenseByRequest(original.requestId), original);
  assert.deepEqual(cancel.execute(actor, original.requestId, body), first);
  assert.deepEqual(store.audit(), audit);
  assert.throws(() =>
    cancel.execute(actor, original.requestId, { reason: 'Otro motivo distinto' }),
  );
  const report = economicReport([], expenses.all(), '2026-10-01', '2026-10-31');
  assert.equal(report.expenseCents, 0);
  assert.equal(report.cancelledExpenses.length, 1);
  assert.equal(cash.target('payment', original.requestId)?.enabled, false);
  assert.equal(cash.report().targets.find((v) => v.id === original.requestId)?.pendingCents, 0);
  assert.equal(store.verifyAudit(), true);
});
test('pagos activos bloquean anular; reversión anotada permite corregir sin borrar caja', (t) => {
  const { expenses, cash, original, cancel } = setup(t);
  const payment = new RegisterCash(cash).execute(actor, {
    requestId: randomUUID(),
    kind: 'payment',
    targetId: original.requestId,
    amountCents: 100,
    date: '2026-10-28',
    reference: 'PAY-TEST',
    method: 'Efectivo',
  });
  assert.throws(() =>
    cancel.execute(actor, original.requestId, { reason: 'Importe incorrecto registrado' }),
  );
  assert.equal(expenses.cancellation(original.requestId), undefined);
  new ReverseCash(cash, () => new Date().toISOString()).execute(actor, payment.requestId, {
    reason: 'Anotación errónea de prueba',
  });
  cancel.execute(actor, original.requestId, { reason: 'Importe incorrecto registrado' });
  assert.equal(cash.all().length, 1);
  assert.equal(cash.active().length, 0);
  assert.throws(() =>
    new RegisterCash(cash).execute(actor, {
      ...payment,
      requestId: randomUUID(),
      reference: 'PAY-NEW',
    }),
  );
});
test('permisos, entradas y fallo de auditoría revierten anulación', (t) => {
  const { store, expenses, original, cancel } = setup(t);
  for (const role of ['reviewer', 'viewer'])
    assert.throws(() =>
      cancel.execute({ id: role, role }, original.requestId, { reason: 'Motivo de prueba' }),
    );
  for (const body of [{ reason: 'x' }, { reason: 'Motivo válido', extra: true }, null])
    assert.throws(() => cancel.execute(actor, original.requestId, body));
  const record = expenses.record;
  expenses.record = () => {
    throw Error('disk');
  };
  assert.throws(() => cancel.execute(actor, original.requestId, { reason: 'Motivo de prueba' }));
  assert.equal(expenses.cancellation(original.requestId), undefined);
  expenses.record = record;
  assert.ok(store.verifyAudit());
});
test('HTTP protege anulación y muestra original en listado de anulados', async (t) => {
  const { store, original } = setup(t),
    server = makeServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const base = 'http://127.0.0.1:' + addr.port,
    headers = sessions(store, base);
  const send = (role: string) =>
    fetch(base + '/api/expenses/' + original.requestId + '/cancel', {
      method: 'POST',
      headers: headers(role),
      body: JSON.stringify({ reason: 'Gasto registrado incorrectamente' }),
    });
  assert.equal((await send('lucia')).status, 403);
  assert.equal((await send('marcos')).status, 403);
  assert.equal((await send('elena')).status, 200);
  assert.equal((await send('elena')).status, 200);
  const report = await (
    await fetch(base + '/api/economics?from=2026-10-01&to=2026-10-31', {
      headers: headers('elena'),
    })
  ).json();
  assert.equal(report.expenses.length, 0);
  assert.equal(report.cancelledExpenses[0].reference, original.reference);
});
