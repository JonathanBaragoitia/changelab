/** Isolated, synthetic month. All business writes use the same application services as the UI. */
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { Store, sha } from '../infrastructure/store.ts';
import { CommerceStore } from '../infrastructure/commerce-store.ts';
import { AuthStore } from '../infrastructure/auth-store.ts';
import { SupplierOfferStore } from '../infrastructure/supplier-offer-store.ts';
import { OperationStore } from '../infrastructure/operation-store.ts';
import { Checkout, type Sale } from '../application/commerce.ts';
import { ManageOrder } from '../application/order-management.ts';
import { Purchases, Incidents, type Purchase, type Incident } from '../application/operations.ts';
import { ReceiveStock } from '../application/receiving.ts';
import { Warehouse } from '../application/warehouse.ts';
import { PartialReturns, type PartialReturn } from '../application/partial-returns.ts';
import { ExpenseStore } from '../infrastructure/expense-store.ts';
import { RegisterExpense, economicReport } from '../application/economics.ts';
import { CashStore } from '../infrastructure/cash-store.ts';
import { RegisterCash } from '../application/cash.ts';
import { RegisterRefund } from '../application/refunds.ts';
import { PrepareInvoiceDraft } from '../application/billing.ts';
import { IssueDemoInvoice } from '../application/issuance.ts';
import { reconcileOrders } from '../application/reconciliation.ts';
import { ProposalService, type Actor } from '../application/proposals.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const target = join(root, 'data', 'scenarios', 'octubre-2026-' + randomUUID().slice(0, 8));
mkdirSync(target, { recursive: true });
const dbPath = join(target, 'changelab.sqlite');
if (existsSync(dbPath)) throw Error('El escenario requiere una base nueva.');
let day = 1,
  sequence = 0;
const now = () =>
  `2026-10-${String(day).padStart(2, '0')}T10:${String(Math.floor(sequence / 60) % 60).padStart(2, '0')}:${String(sequence % 60).padStart(2, '0')}.000Z`;
const store = new Store(dbPath, now);
const commerce = new CommerceStore(store);
const offers = new SupplierOfferStore(store);
const accounts = new AuthStore(store.db);
const source = new DatabaseSync(join(root, 'data', 'changelab.sqlite'), { readOnly: true });
try {
  for (const row of source.prepare('SELECT * FROM users WHERE active=1').all())
    accounts.add({
      actor: {
        id: String(row.id),
        name: String(row.name),
        role: row.role as Actor['role'],
        initials: String(row.initials),
      },
      username: String(row.username),
      passwordHash: String(row.passwordHash),
      active: true,
    });
} finally {
  source.close();
}
const employeeRows = store.db.prepare('SELECT * FROM users WHERE active=1').all();
const actor = (role: Actor['role']): Actor => {
  const row = employeeRows.find((row) => row.role === role);
  if (!row) throw Error('Se necesita una cuenta ' + role + ' en el entorno habitual.');
  return { id: String(row.id), name: String(row.name), role, initials: String(row.initials) };
};
const editor = actor('editor'),
  reviewer = actor('reviewer');
const purchaseRepo = new OperationStore<Purchase>(store, 'purchase'),
  incidentRepo = new OperationStore<Incident>(store, 'incident'),
  returnRepo = new OperationStore<PartialReturn>(store, 'partial-return');
const receiving = new ReceiveStock(commerce, randomUUID, now);
const purchases = new Purchases(
  purchaseRepo,
  () => store.products(),
  (id) => commerce.receiptSupplier(id),
  (actor, p, reference, deliveryId) => {
    for (const line of p.lines)
      receiving.execute(actor, {
        requestId: sha({
          purchaseId: p.id,
          productId: line.productId,
          ...(deliveryId ? { deliveryId } : {}),
        }),
        supplierId: p.supplierId,
        supplier: p.supplierName,
        reference,
        productId: line.productId,
        quantity: line.quantity,
      });
  },
  randomUUID,
  now,
  (s, p) => offers.get(s, p),
);
const checkout = new Checkout(commerce, randomUUID, now),
  orders = new ManageOrder(commerce, now),
  warehouse = new Warehouse(commerce, now);
const incidents = new Incidents(incidentRepo, (id) => !!commerce.sale(id), randomUUID, now);
const returns = new PartialReturns(
  returnRepo,
  (id) => commerce.sale(id),
  (value, sale) => commerce.applyPartialReturn(value, sale),
  now,
);
const expenses = new ExpenseStore(store),
  expenseService = new RegisterExpense(expenses),
  cash = new CashStore(store, commerce, expenses),
  cashService = new RegisterCash(cash),
  refunds = new RegisterRefund(cash);
const drafts = new PrepareInvoiceDraft(commerce, randomUUID, now),
  issuance = new IssueDemoInvoice(commerce, randomUUID, now);
const proposals = new ProposalService(store, { hash: sha }, { now }, { next: randomUUID });
const queue = new Map<number, { label: string; run: () => void }[]>(),
  timeline: { date: string; event: string }[] = [],
  checks: string[] = [];
const later = (date: number, label: string, run: () => void) => {
  if (date <= 31) queue.set(date, [...(queue.get(date) ?? []), { label, run }]);
};
const event = (label: string, run: () => void) => {
  sequence++;
  run();
  timeline.push({ date: now(), event: label });
};
const blocked = (label: string, run: () => void) => {
  assert.throws(run);
  checks.push(label);
};
const stockInvariant = () => {
  for (const product of store.products()) {
    const actual = Number(
      store.db.prepare('SELECT quantity FROM inventory WHERE productId=?').get(product.id)
        ?.quantity,
    );
    const movements = Number(
      store.db
        .prepare(
          'SELECT COALESCE(SUM(quantity),0) total FROM inventory_movements WHERE productId=?',
        )
        .get(product.id)?.total,
    );
    assert.equal(actual, 20 + movements, product.sku + ' no concilia');
    assert.ok(actual >= 0);
  }
};
function shipPurchase(p: Purchase, delayed = false) {
  const approved = purchases.transition(reviewer, p.id, {
    action: 'approve',
    expectedVersion: p.version,
  });
  blocked('Autor no puede aprobar su compra', () =>
    purchases.transition({ ...reviewer, id: p.createdBy }, p.id, {
      action: 'approve',
      expectedVersion: p.version,
    }),
  );
  const sent = purchases.transition(editor, p.id, {
    action: 'send',
    expectedVersion: approved.version,
  });
  const dispatchDay = day;
  later(day + 2, 'Recepción parcial de ' + p.supplierName, () => {
    const current = purchaseRepo.get(sent.id)!;
    const lines = current.lines.map((line) => ({
      productId: line.productId,
      quantity: Math.max(1, Math.floor(line.quantity / 2)),
    }));
    const payload = {
      action: 'receive-partial',
      expectedVersion: current.version,
      requestId: randomUUID(),
      reference: 'ALB-' + p.id.slice(0, 8) + '-1',
      confirmReceived: true,
      lines,
    };
    purchases.transition(editor, p.id, payload);
    const before = JSON.stringify(commerce.snapshot().inventory);
    purchases.transition(editor, p.id, payload);
    assert.equal(JSON.stringify(commerce.snapshot().inventory), before);
    checks.push('Entrega repetida no duplica stock');
  });
  later(dispatchDay + (delayed ? 8 : 4), 'Completar recepción de ' + p.supplierName, () => {
    const current = purchaseRepo.get(p.id)!;
    const lines = current.lines
      .map((line) => ({
        productId: line.productId,
        quantity:
          line.quantity -
          (current.deliveries ?? [])
            .flatMap((d) => d.lines)
            .filter((l) => l.productId === line.productId)
            .reduce((sum, l) => sum + l.quantity, 0),
      }))
      .filter((line) => line.quantity > 0);
    if (lines.length)
      purchases.transition(editor, p.id, {
        action: 'receive-partial',
        expectedVersion: current.version,
        requestId: randomUUID(),
        reference: 'ALB-' + p.id.slice(0, 8) + '-2',
        confirmReceived: true,
        lines,
      });
  });
}
function replenish(products: string[], delayed = false) {
  const lines = products.map((productId) => {
    const available = offers
      .all()
      .filter((o) => o.productId === productId)
      .sort((a, b) => a.costCents - b.costCents);
    const offer = available[0]!;
    return {
      productId,
      supplierId: offer.supplierId,
      quantity: Math.ceil(24 / offer.packUnits) * offer.packUnits,
    };
  });
  const created = purchases.createReplenishment(editor, {
    requestId: randomUUID(),
    reason: 'Reposición mensual por ventas y stock bajo',
    lines,
  });
  created.forEach((p) => shipPurchase(p, delayed));
}
const party = {
  name: 'Norte AutoCare · escenario ficticio',
  taxId: 'DEMO-001',
  address: 'Dirección ficticia, no postal',
};
for (day = 1; day <= 31; day++) {
  sequence = 0;
  for (const task of queue.get(day) ?? []) event(task.label, task.run);
  if ([2, 12, 22, 28].includes(day))
    event('Reposición conjunta de champú y accesorios', () =>
      replenish(['nc1', 'nc4', 'nc16'], day === 22),
    );
  if (day === 10)
    event('Propuesta rechazada y alternativa pendiente', () => {
      const p = purchases.create(editor, {
        supplierId: 'demo-general',
        reason: 'Reponer cera, revisar cantidad',
        lines: [{ productId: 'nc13', quantity: 18 }],
      });
      const changed = purchases.transition(reviewer, p.id, {
        action: 'request-changes',
        expectedVersion: p.version,
        reason:
          'Hay stock suficiente; cambiar a proveedor especializado y reducir a seis unidades.',
      });
      const alternative = purchases.create(editor, {
        replacesId: changed.id,
        supplierId: 'demo-acabado',
        reason: 'Alternativa revisada: seis unidades de cera',
        lines: [{ productId: 'nc13', quantity: 6 }],
      });
      shipPurchase(alternative);
    });
  if (day === 18)
    event('Rechazo de compra innecesaria', () => {
      const p = purchases.create(editor, {
        supplierId: 'demo-general',
        reason: 'Compra preventiva sin demanda registrada',
        lines: [{ productId: 'nc12', quantity: 30 }],
      });
      purchases.transition(reviewer, p.id, {
        action: 'reject',
        expectedVersion: p.version,
        reason: 'Stock suficiente y demanda limitada; no comprar por ahora.',
      });
    });
  if ([1, 8, 15, 22].includes(day))
    event('Gasto operativo y pago registrado', () => {
      const amount = day === 1 ? 65000 : 12500;
      const expense = expenseService.execute(editor, {
        requestId: randomUUID(),
        date: now().slice(0, 10),
        reference: 'MES-GASTO-' + day,
        category: day === 1 ? 'Alquiler' : 'Servicios',
        description:
          day === 1 ? 'Alquiler del local de octubre' : 'Servicios y mantenimiento semanal',
        baseCents: amount,
        vatRate: 21,
      });
      cashService.execute(editor, {
        requestId: randomUUID(),
        kind: 'payment',
        targetId: expense.requestId,
        amountCents: expense.totalCents,
        date: now().slice(0, 10),
        reference: 'MES-PAGO-' + day,
        method: 'Transferencia',
      });
    });
  for (let n = 0; n < 4; n++)
    event('Compra de cliente ' + day + '/' + (n + 1), () => {
      const preferred = ['nc1', 'nc4', 'nc16', ...store.products().map((p) => p.id)];
      const productId = preferred[(day + n) % preferred.length]!;
      const ids = [...new Set([productId, ['nc1', 'nc4', 'nc16'][n % 3]!])];
      const lines = ids
        .map((id) => ({
          productId: id,
          quantity: 1 + (n % 2),
          expectedPriceCents: store.products().find((p) => p.id === id)!.priceCents,
        }))
        .filter(
          (line) =>
            Number(
              store.db
                .prepare('SELECT quantity FROM inventory WHERE productId=?')
                .get(line.productId)?.quantity,
            ) >= line.quantity,
        );
      if (!lines.length) {
        blocked('Stock agotado impide venta', () =>
          checkout.customerCheckout('scenario-client', {
            requestId: randomUUID(),
            lines: [
              {
                productId: 'nc1',
                quantity: 100,
                expectedPriceCents: store.products().find((p) => p.id === 'nc1')!.priceCents,
              },
            ],
            customer: {
              name: 'Cliente sintético',
              email: 'cliente@example.invalid',
              address: 'Dirección ficticia de prueba',
            },
          }),
        );
        return;
      }
      const request = {
        requestId: randomUUID(),
        lines,
        customer: {
          name: 'Cliente ficticio ' + (n + 1),
          email: 'cliente' + (n + 1) + '@example.invalid',
          address: 'Dirección ficticia de prueba ' + (n + 1),
        },
      };
      const sale = checkout.customerCheckout('scenario-customer-' + n, request);
      const needsIncident = (day + n) % 9 === 0;
      const repeated = checkout.customerCheckout('scenario-customer-' + n, request);
      assert.equal(repeated.id, sale.id);
      if ((day + n) % 11 === 0) {
        later(day + 1, 'Cancelación solicitada por cliente', () => {
          orders.cancelByCustomer(sale.actorId, sale.id, { expectedStatus: 'confirmed' });
        });
        return;
      }
      later(day + 1, 'Preparar pedido de cliente', () => {
        orders.execute(editor, sale.id, { status: 'prepared', expectedStatus: 'confirmed' });
      });
      later(day + 2, 'Enviar pedido y registrar cobro simulado', () => {
        orders.execute(editor, sale.id, { status: 'shipped', expectedStatus: 'prepared' });
        cashService.execute(editor, {
          requestId: randomUUID(),
          kind: 'collection',
          targetId: sale.id,
          amountCents: sale.tax!.totalCents,
          date: now().slice(0, 10),
          reference: 'MES-COBRO-' + sale.id,
          method: 'Tarjeta',
        });
        blocked('Pedido enviado no se cancela', () =>
          orders.cancelByCustomer(sale.actorId, sale.id, { expectedStatus: 'prepared' }),
        );
        if (!needsIncident) {
          const draft = drafts.execute(editor, sale.id, {
            issuer: party,
            recipient: { ...party, name: sale.customer!.name },
            acceptDemoTax: true,
          });
          issuance.execute(editor, draft.id, {
            expectedVersion: draft.version ?? 1,
            confirmDemo: true,
          });
        }
      });
      if (needsIncident)
        later(day + 3, 'Incidencia por entrega parcial del cliente', () => {
          const incident = incidents.create(editor, {
            orderId: sale.id,
            kind: 'wrong-item',
            description:
              'Cliente comunica un artículo incorrecto. Se revisa la preparación y el justificante.',
          });
          incidents.update(editor, incident.id, {
            expectedVersion: 1,
            status: 'investigating',
            resolution: 'Se contrasta la referencia enviada con las líneas originales.',
          });
          later(day + 2, 'Resolver incidencia con devolución parcial y reembolso', () => {
            const returned = returns.execute(editor, {
              requestId: randomUUID(),
              orderId: sale.id,
              productId: sale.lines[0]!.productId,
              quantity: 1,
              expectedReturned: 0,
              reason: 'Artículo incorrecto devuelto y recibido en buen estado',
              confirmReceived: true,
            });
            refunds.execute(editor, {
              requestId: randomUUID(),
              orderId: sale.id,
              amountCents: returned.grossCents,
              date: now().slice(0, 10),
              reference: 'MES-REEMBOLSO-' + sale.id,
              reason: 'Reembolso del artículo devuelto en incidencia',
            });
            incidents.update(editor, incident.id, {
              expectedVersion: 2,
              status: 'resolved',
              resolution:
                'Mercancía recibida y reembolso registrado. Se revisó el procedimiento de preparación.',
            });
          });
        });
    });
  if (day === 20)
    event('Rotura detectada en inventario', () => {
      const productId = 'nc10';
      const quantity = Number(
        store.db.prepare('SELECT quantity FROM inventory WHERE productId=?').get(productId)
          ?.quantity,
      );
      if (quantity > 0)
        warehouse.adjust(editor, {
          requestId: randomUUID(),
          productId,
          delta: -1,
          expectedQuantity: quantity,
          reason: 'Unidad dañada en recuento físico del escenario',
        });
    });
  if (day === 16)
    event('Cambio de precios revisado y publicado', () => {
      const p = proposals.create(editor, {
        instruction: 'Ajuste de precios de octubre tras revisar márgenes',
        plan: { category: 'Protección de pintura', basisPoints: 300 },
      });
      const stale = proposals.create(editor, {
        instruction: 'Propuesta anterior sobre la misma versión',
        plan: { category: 'Protección de pintura', basisPoints: 200 },
      });
      blocked('El autor no puede publicar su propuesta', () =>
        proposals.publish({ ...reviewer, id: editor.id }, p.id, p.digest),
      );
      proposals.publish(reviewer, p.id, p.digest);
      blocked('Propuesta obsoleta no se publica', () =>
        proposals.publish(reviewer, stale.id, stale.digest),
      );
      const unsafe = proposals.create(editor, {
        instruction: 'Prueba de margen insuficiente',
        plan: { category: 'Lavado exterior', basisPoints: -5000 },
      });
      assert.equal(unsafe.status, 'blocked');
      checks.push('Margen insuficiente bloqueado');
    });
  stockInvariant();
  checks.push('Stock conciliado al cierre del día ' + day);
}
day = 31;
sequence = 59;
blocked('Ventas con precio manipulado rechazadas', () =>
  checkout.customerCheckout('scenario-client', {
    requestId: randomUUID(),
    lines: [{ productId: 'nc1', quantity: 1, expectedPriceCents: 1 }],
    customer: {
      name: 'Cliente ficticio',
      email: 'test@example.invalid',
      address: 'Dirección ficticia de prueba',
    },
  }),
);
assert.ok(store.verifyAudit());
stockInvariant();
assert.equal(store.db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
const snapshot = commerce.snapshot(),
  allPurchases = purchaseRepo.all(),
  allIncidents = incidentRepo.all();
const countBy = (values: { status?: string }[]) =>
  values.reduce<Record<string, number>>((counts, value) => {
    const key = value.status ?? 'confirmed';
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
const cashReport = cash.report();
assert.ok(cashReport.targets.every((target) => target.pendingCents >= 0));
const reconciliation = reconcileOrders(
  snapshot.sales,
  snapshot.invoices,
  snapshot.corrections,
  cash.active(),
  cash.activeRefunds(),
);
const reconciliationFindings: Record<string, number> = {};
for (const row of reconciliation)
  for (const finding of row.findings) {
    assert.ok(
      ['NO_DOCUMENT', 'PENDING_COLLECTION'].includes(finding.code),
      'Diferencia no prevista: ' + finding.code,
    );
    reconciliationFindings[finding.code] = (reconciliationFindings[finding.code] ?? 0) + 1;
  }
const report = {
  period: '2026-10-01 a 2026-10-31',
  mode: 'Escenario sintético aislado, sin pagos ni envíos reales',
  database: dbPath,
  sales: snapshot.sales.length,
  ordersByStatus: countBy(snapshot.sales),
  purchases: allPurchases.length,
  purchasesByStatus: countBy(allPurchases),
  incidents: allIncidents.length,
  incidentsByStatus: countBy(allIncidents),
  receipts: Number(store.db.prepare('SELECT COUNT(*) n FROM stock_receipts').get()?.n),
  auditEvents: Number(store.db.prepare('SELECT COUNT(*) n FROM audit').get()?.n),
  invoices: snapshot.invoices.length,
  refunds: cash.activeRefunds().length,
  checks: checks.length,
  stockBalanced: true,
  auditValid: true,
  reconciliationFindings,
  cash: {
    collectedCents: cashReport.collectedCents,
    paidCents: cashReport.paidCents,
    refundedCents: cashReport.refundedCents,
    balanceCents: cashReport.balanceCents,
  },
  economics: economicReport(snapshot.sales, expenses.all(), '2026-10-01', '2026-10-31'),
};
writeFileSync(join(target, 'resumen.json'), JSON.stringify(report, null, 2));
const markdown =
  '# Octubre de 2026 · Mes simulado\n\nDatos sintéticos en una base separada. Sin cargos ni envíos externos. No es prueba de rendimiento ni validación con datos reales.\n\n## Resultado\n\n```json\n' +
  JSON.stringify(
    {
      ...report,
      economics: {
        revenueCents: report.economics.revenueCents,
        expenseCents: report.economics.expenseCents,
        operatingResultCents: report.economics.operatingResultCents,
      },
    },
    null,
    2,
  ) +
  '\n```\n\n## Cómo revisarlo\n\n- Pedidos: filtrar fechas1–31octubre; cancelados, preparados y enviados.\n- Compras: grupos de reposición, alternativa y rechazo, envíos, recepciones parciales y pendientes.\n- Incidencias: abiertas/en estudio y resueltas; comprobar motivo y devolución asociada.\n- Almacén: stock actual y movimientos agrupados.\n- Cobros y pagos: cobros simulados y reembolsos registrados.\n- Control económico: seleccionar octubre de2026.\n- Historial: secuencia fechada de operaciones.\n\n## Cronología\n\n' +
  timeline.map((item) => '- ' + item.date + ' · ' + item.event).join('\n') +
  '\n\n## Comprobaciones\n\n' +
  checks.map((check) => '- ' + check).join('\n');
writeFileSync(join(target, 'LEEME.md'), markdown);
writeFileSync(
  join(root, 'data', 'scenarios', 'ultimo-mes.json'),
  JSON.stringify({ directory: target, database: dbPath }, null, 2),
);
store.close();
console.log(JSON.stringify({ directory: target, ...report, economics: undefined }, null, 2));
