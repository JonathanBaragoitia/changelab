import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, unlinkSync } from 'node:fs';
import {
  readCashEntry,
  readRefund,
  readCashReversal,
  readRefundReversal,
} from '../src/infrastructure/cash-records.ts';
import { Store } from '../src/infrastructure/store.ts';
import { CommerceStore } from '../src/infrastructure/commerce-store.ts';
import { CashStore } from '../src/infrastructure/cash-store.ts';
import { ExpenseStore } from '../src/infrastructure/expense-store.ts';
const entry = {
  requestId: randomUUID(),
  kind: 'collection' as const,
  targetId: 'order',
  amountCents: 100,
  date: '2026-10-28',
  reference: 'CASH-PERSIST',
  method: 'Efectivo',
  actorId: 'editor',
};
const refund = {
  requestId: randomUUID(),
  orderId: 'order',
  amountCents: 50,
  date: '2026-10-28',
  reference: 'REFUND-PERSIST',
  reason: 'Registro de prueba',
  actorId: 'editor',
};
test('lecturas rechazan importes inválidos, JSON incorrecto, claves extra e identidad distinta', () => {
  for (const [read, value] of [
    [readCashEntry, entry],
    [readRefund, refund],
  ] as const) {
    assert.deepEqual(read(JSON.stringify(value), value.requestId), value);
    for (const amountCents of [-1, 0, 1.5, '100', Number.MAX_SAFE_INTEGER])
      assert.throws(() => read(JSON.stringify({ ...value, amountCents })));
    assert.throws(() => read(JSON.stringify({ ...value, date: '2026-02-30' })));
    assert.throws(() => read(JSON.stringify({ ...value, sql: 'secret' })));
    assert.throws(() => read(JSON.stringify(value), 'wrong'));
    for (const data of ['{', null, '[]', 'null']) assert.throws(() => read(data));
  }
});
test('anulaciones persistidas exigen motivo, fecha e identidad coherentes', () => {
  const cash = {
      entryId: entry.requestId,
      reason: 'Corrección de prueba',
      actorId: 'editor',
      at: '2026-10-28T12:00:00Z',
    },
    r = {
      refundId: refund.requestId,
      reason: 'Corrección de prueba',
      actorId: 'editor',
      at: '2026-10-28T12:00:00Z',
    };
  assert.deepEqual(readCashReversal(JSON.stringify(cash), cash.entryId), cash);
  assert.deepEqual(readRefundReversal(JSON.stringify(r), r.refundId), r);
  assert.throws(() => readCashReversal(JSON.stringify({ ...cash, at: 'bad' })));
  assert.throws(() => readRefundReversal(JSON.stringify({ ...r, reason: 'x' })));
  assert.throws(() => readRefundReversal(JSON.stringify(r), 'other'));
});
test('adaptador falla ante documento de caja manipulado sin modificar registros', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const cash = new CashStore(store, new CommerceStore(store), new ExpenseStore(store));
  cash.save(entry);
  store.db
    .prepare('UPDATE cash_entries SET document=? WHERE requestId=?')
    .run(JSON.stringify({ ...entry, requestId: 'different' }), entry.requestId);
  const audit = store.audit();
  assert.throws(() => cash.entry(entry.requestId));
  assert.throws(() => cash.report());
  assert.deepEqual(store.audit(), audit);
});
test('cobro, reembolso y corrección se conservan tras cerrar y reabrir SQLite', (t) => {
  const path = join(tmpdir(), 'changelab-cash-' + randomUUID() + '.sqlite');
  let store = new Store(path);
  t.after(() => {
    store.close();
    for (const file of [path, path + '-wal', path + '-shm']) if (existsSync(file)) unlinkSync(file);
  });
  let cash = new CashStore(store, new CommerceStore(store), new ExpenseStore(store));
  cash.save(entry);
  cash.saveRefund(refund);
  const correction = {
    refundId: refund.requestId,
    reason: 'Reembolso de prueba erróneo',
    actorId: 'editor',
    at: new Date().toISOString(),
  };
  cash.saveRefundReversal(correction);
  store.close();
  store = new Store(path);
  cash = new CashStore(store, new CommerceStore(store), new ExpenseStore(store));
  assert.deepEqual(cash.entry(entry.requestId), entry);
  assert.deepEqual(cash.refund(refund.requestId), refund);
  assert.deepEqual(cash.refundReversal(refund.requestId), correction);
  assert.equal(cash.activeRefunds().length, 0);
  assert.equal(cash.report().balanceCents, 100);
  assert.equal(cash.report().refunds[0]!.reversal?.reason, correction.reason);
});
