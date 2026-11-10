import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/infrastructure/store.ts';
import { CommerceStore } from '../src/infrastructure/commerce-store.ts';
import { ExpenseStore } from '../src/infrastructure/expense-store.ts';
import { Checkout } from '../src/application/commerce.ts';
import {
  RegisterExpense,
  economicReport,
  period,
  businessDate,
} from '../src/application/economics.ts';
const editor = { id: 'editor-test', role: 'editor' };
const input = () => ({
  requestId: randomUUID(),
  date: '2026-10-27',
  reference: 'GASTO-001',
  category: 'Servicios',
  description: 'Servicio de prueba',
  baseCents: 1000,
  vatRate: 21,
});
test('gasto guarda importes, reintentos no duplican y referencia es única', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const repo = new ExpenseStore(store),
    service = new RegisterExpense(repo),
    body = input();
  const expense = service.execute(editor, body),
    audit = store.audit();
  assert.equal(expense.taxCents, 210);
  assert.equal(expense.totalCents, 1210);
  assert.deepEqual(service.execute(editor, body), expense);
  assert.deepEqual(store.audit(), audit);
  assert.throws(() => service.execute(editor, { ...body, requestId: randomUUID() }));
  assert.throws(() => service.execute(editor, { ...body, baseCents: 2000 }));
  assert.equal(repo.all().length, 1);
  assert.equal(store.verifyAudit(), true);
});
test('valida roles, fechas y cantidades; fallo de auditoría revierte gasto', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const repo = new ExpenseStore(store),
    service = new RegisterExpense(repo);
  for (const role of ['viewer', 'reviewer'])
    assert.throws(() => service.execute({ id: role, role }, input()));
  for (const patch of [
    { date: '2026-02-30' },
    { baseCents: 0 },
    { baseCents: 1.1 },
    { vatRate: 99 },
    { category: 'Existencias' },
  ])
    assert.throws(() => service.execute(editor, { ...input(), ...patch }));
  store.db.exec(
    "CREATE TRIGGER fail_expense BEFORE INSERT ON audit WHEN NEW.action='expense.registered' BEGIN SELECT RAISE(ABORT,'failure'); END",
  );
  assert.throws(() => service.execute(editor, input()));
  assert.equal(repo.all().length, 0);
});
test('periodo calcula margen menos gastos sin incluir históricos ni cancelados y respeta Madrid', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store),
    repo = new ExpenseStore(store);
  const sale = new Checkout(commerce, randomUUID, () => '2026-10-26T23:30:00Z').execute(editor, {
    requestId: randomUUID(),
    lines: [{ productId: 'nc1', quantity: 1, expectedPriceCents: 7990 }],
  });
  const expense = new RegisterExpense(repo).execute(editor, input());
  const { tax, ...historical } = sale;
  const result = economicReport(
    [sale, { ...historical, id: 'old' }, { ...sale, id: 'cancelled', status: 'cancelled' }],
    [expense],
    '2026-10-27',
    '2026-10-27',
  );
  assert.equal(result.revenueCents, 7990);
  assert.equal(result.costCents, 4900);
  assert.equal(result.grossMarginCents, 3090);
  assert.equal(result.operatingResultCents, 2090);
  assert.equal(result.excludedHistoricalOrders, 1);
  assert.equal(economicReport([sale], [expense], '2026-10-26', '2026-10-26').orders, 0);
  assert.equal(businessDate('2026-10-26T23:30:00Z'), '2026-10-27');
  assert.throws(() => period('2026-10-28', '2026-10-27'));
});
