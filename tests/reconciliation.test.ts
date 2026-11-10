import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { reconcileOrders } from '../src/application/reconciliation.ts';
import type { Sale } from '../src/application/commerce.ts';
import type { DemoInvoice } from '../src/application/issuance.ts';
import type { DemoCorrection } from '../src/application/rectification.ts';
import type { CashEntry } from '../src/application/cash.ts';
import { Store } from '../src/infrastructure/store.ts';
import { makeServer } from '../src/server.ts';
import { sessions } from './auth-fixture.ts';
const sale: Sale = {
  id: 'sale',
  actorId: 'a',
  requestId: 'request',
  createdAt: '2026-10-28T10:00:00Z',
  totalCents: 1000,
  costCents: 500,
  lines: [],
  status: 'confirmed',
  tax: { policy: 'demo-net-v1', rate: 21, baseCents: 1000, taxCents: 210, totalCents: 1210 },
};
const party = { name: 'Demo', taxId: 'DEMO', address: 'Calle ficticia' };
const invoice: DemoInvoice = {
  id: 'invoice',
  number: 'DEMO-1',
  issuedAt: sale.createdAt,
  issuedBy: 'a',
  draftVersion: 1,
  mode: 'demo-not-fiscal',
  draft: {
    id: 'draft',
    orderId: sale.id,
    createdAt: sale.createdAt,
    createdBy: 'a',
    issuer: party,
    recipient: party,
    vatRate: 21,
    pricing: 'demo-net-v1',
    lines: [],
    baseCents: 1000,
    taxCents: 210,
    totalCents: 1210,
  },
};
const cash: CashEntry = {
  requestId: 'cash',
  kind: 'collection',
  targetId: 'sale',
  amountCents: 1210,
  date: '2026-10-28',
  reference: 'CASH',
  method: 'Efectivo',
  actorId: 'a',
};
const correction: DemoCorrection = {
  id: 'correction',
  number: 'DEMO-R1',
  invoiceId: 'invoice',
  originalNumber: 'DEMO-1',
  reason: 'Prueba de corrección',
  at: sale.createdAt,
  actorId: 'a',
  baseCents: -1000,
  taxCents: -210,
  totalCents: -1210,
  mode: 'demo-not-fiscal',
};
test('conciliación usa total con IVA, ignora pagos de gastos y no muta entradas', () => {
  const entries = [cash, { ...cash, requestId: 'expense', kind: 'payment' as const }];
  const before = JSON.stringify({ sale, invoice, entries });
  const result = reconcileOrders([sale], [invoice], [], entries)[0]!;
  assert.equal(result.expectedCents, 1210);
  assert.equal(result.collectedCents, 1210);
  assert.equal(result.pendingCents, 0);
  assert.deepEqual(result.findings, []);
  assert.equal(JSON.stringify({ sale, invoice, entries }), before);
});
test('devolución exige revisar documento y cobro; rectificar no devuelve dinero', () => {
  const closed = { ...sale, status: 'returned' as const };
  let row = reconcileOrders([closed], [invoice], [], [cash])[0]!;
  assert.equal(row.expectedCents, 0);
  assert.equal(row.pendingCents, -1210);
  assert.deepEqual(
    row.findings.map((f) => f.code),
    ['DOCUMENT_DIFFERENCE', 'COLLECTION_EXCESS'],
  );
  row = reconcileOrders([closed], [invoice], [correction], [cash])[0]!;
  assert.equal(row.documentCents, 0);
  assert.deepEqual(
    row.findings.map((f) => f.code),
    ['COLLECTION_EXCESS'],
  );
  const active = reconcileOrders([sale], [invoice], [correction], [])[0]!;
  assert.ok(active.findings.some((f) => f.code === 'DOCUMENT_DIFFERENCE'));
});
test('sin emisión no inventa documento; histórico señala falta de desglose', () => {
  const { tax, ...legacy } = sale;
  const row = reconcileOrders([legacy], [], [], [])[0]!;
  assert.equal(row.expectedCents, 1000);
  assert.deepEqual(row.documents, []);
  assert.deepEqual(
    row.findings.map((f) => f.code),
    ['LEGACY_TAX', 'NO_DOCUMENT', 'PENDING_COLLECTION'],
  );
  assert.equal(
    reconcileOrders([{ ...sale, status: 'cancelled' }], [], [], [])[0]!.findings.length,
    0,
  );
});
test('consulta HTTP solo interna, solo lectura y todos los roles de empleados', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const server = makeServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const base = 'http://127.0.0.1:' + addr.port,
    headers = sessions(store, base),
    before = store.audit();
  assert.equal((await fetch(base + '/api/reconciliation')).status, 401);
  for (const actor of ['elena', 'marcos', 'lucia']) {
    const res = await fetch(base + '/api/reconciliation', { headers: headers(actor) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { rows: [] });
  }
  assert.deepEqual(store.audit(), before);
});
