import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyWork } from '../src/application/workbench.ts';
import type { TransportDamage } from '../src/application/transport-damage.ts';
test('bandeja incluye roturas abiertas y separa pendientes normales de incidencias', () => {
  const tasks = dailyWork({
    products: [],
    sales: [],
    purchases: [],
    incidents: [],
    proposals: [],
    stock: [],
    transportDamages: [
      { id: 'damage-open', reference: 'ROT-1', status: 'open', quantity: 2, inStock: true },
      { id: 'damage-closed', status: 'resolved' },
    ] as TransportDamage[],
    reconciliation: [
      {
        orderId: 'pending',
        status: 'confirmed',
        findings: [
          { code: 'NO_DOCUMENT', message: '' },
          { code: 'PENDING_COLLECTION', message: '' },
        ],
      },
      {
        orderId: 'error',
        status: 'prepared',
        findings: [{ code: 'COLLECTION_EXCESS', message: '' }],
      },
      {
        orderId: 'shipped',
        status: 'shipped',
        findings: [{ code: 'PENDING_COLLECTION', message: '' }],
      },
    ],
  });
  assert.ok(tasks.some((t) => t.id === 'transport-damage-open'));
  assert.ok(
    !tasks.some((t) => t.id === 'transport-damage-closed' || t.id === 'reconciliation-pending'),
  );
  assert.ok(tasks.some((t) => t.id === 'reconciliation-error'));
  assert.ok(tasks.some((t) => t.id === 'reconciliation-shipped'));
});
