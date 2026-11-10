import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Store, sha } from '../infrastructure/store.ts';
import { TariffStore } from '../infrastructure/tariff-store.ts';
import { ManageTariffs } from '../application/tariffs.ts';

// Amplía exclusivamente el mes sintético. No reescribe pedidos ni auditorías anteriores.
const metadata = JSON.parse(readFileSync('data/scenarios/ultimo-mes.json', 'utf8'));
const database = resolve(metadata.database);
if (!database.startsWith(resolve('data/scenarios') + sep)) throw Error('Base no aislada.');
let date = '2026-10-05T09:00:00.000Z';
const store = new Store(database, () => date);
const repo = new TariffStore(store);
const tariffs = new ManageTariffs(repo, sha, randomUUID, () => date);
const account = (role: string) => {
  const row = store.db.prepare('SELECT id FROM users WHERE role=? AND active=1 LIMIT 1').get(role);
  if (!row) throw Error('Falta cuenta ' + role);
  return { id: String(row.id), role };
};
const editor = account('editor'),
  reviewer = account('reviewer');
const cases = [
  {
    day: '05',
    supplier: 'demo-lavado',
    rows: 'NA-001;54.00\nNA-002;27.00',
    reason: 'Subida de costes de envases y transporte comunicada por Bruma.',
    apply: true,
  },
  {
    day: '12',
    supplier: 'demo-lavado',
    rows: 'NA-001;50.50\nNA-002;25.80',
    reason: 'Descuento negociado por volumen para la reposición de octubre.',
    apply: true,
  },
  {
    day: '16',
    supplier: 'demo-acabado',
    rows: 'NA-013;14.50\nNA-014;18.00',
    reason: 'Actualización del proveedor por incremento del coste de materias primas.',
    apply: true,
  },
  {
    day: '22',
    supplier: 'demo-lavado',
    rows: 'NA-001;51.20\nNA-002;26.10',
    reason: 'Fin del descuento temporal y nuevo acuerdo de suministro.',
    apply: true,
  },
  {
    day: '29',
    supplier: 'demo-acabado',
    rows: 'NA-013;13.90\nNA-014;17.50',
    reason: 'Oferta de cierre de mes pendiente de comprobación antes de aprobar.',
    apply: false,
  },
];
try {
  const ordersBefore = JSON.stringify(store.db.prepare('SELECT * FROM orders ORDER BY id').all());
  store.transaction(() => {
    for (const item of cases) {
      const reference = `MES-OCT26-${item.day}-${item.supplier}`;
      if (repo.existing(item.supplier, reference)) continue;
      date = `2026-10-${item.day}T09:00:00.000Z`;
      const text = 'sku;coste\n' + item.rows;
      const original = Buffer.from(text);
      const sourceId = randomUUID();
      repo.saveSource(
        {
          id: sourceId,
          filename: reference + '.csv',
          format: 'csv',
          origin:
            'Documento sintético del mes de pruebas; incorporado el 03/11/2026 con fecha de escenario.',
          uploadedBy: editor.id,
          uploadedAt: date,
          sha256: createHash('sha256').update(original).digest('hex'),
          text,
          modelUsed: false,
        },
        original,
      );
      const batch = tariffs.preview(editor, {
        supplierId: item.supplier,
        reference,
        target: 'supplier-offer',
        sourceId,
        csv: text,
        reason: item.reason,
      });
      assert.equal(batch.status, 'ready');
      assert.equal(batch.changes.length, 2);
      const before = batch.changes.map((c) => repo.offer(item.supplier, c.productId)?.costCents);
      if (item.apply) {
        date = `2026-10-${item.day}T11:00:00.000Z`;
        tariffs.apply(reviewer, batch.id, { digest: batch.digest });
        assert.equal(repo.batch(batch.id)?.appliedAt, date);
        for (const change of batch.changes)
          assert.equal(
            repo.offer(item.supplier, change.productId)?.costCents,
            change.afterCostCents,
          );
      } else {
        assert.deepEqual(
          batch.changes.map((c) => repo.offer(item.supplier, c.productId)?.costCents),
          before,
        );
      }
    }
    assert.equal(
      JSON.stringify(store.db.prepare('SELECT * FROM orders ORDER BY id').all()),
      ordersBefore,
    );
    assert.ok(store.verifyAudit());
    assert.equal(store.db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
  });
  console.log(
    JSON.stringify(
      repo
        .latest()
        .filter((b) => b.reference.startsWith('MES-OCT26'))
        .map((b) => ({
          reference: b.reference,
          status: b.status,
          date: b.appliedAt ?? b.createdAt,
          changes: b.changes.length,
        })),
      null,
      2,
    ),
  );
} finally {
  store.close();
}
