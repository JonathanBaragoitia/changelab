import test from 'node:test';
import assert from 'node:assert/strict';
import { auditPage } from '../public/audit.js';
test('historial fecha del hecho, límite de página y fecha local de Madrid', () => {
  const events = [
    { seq: 3, at: '2026-10-01T10:00:00Z', action: 'transport.damage-created' },
    { seq: 1, at: '2026-10-31T23:30:00Z', action: 'tariff.applied' },
    { seq: 2, at: '2026-11-02T10:00:00Z', action: 'tariff.prepared' },
  ];
  assert.equal(auditPage(events, { size: 1 }).events[0].seq, 2);
  assert.equal(auditPage(events, { page: 99, size: 1 }).page, 3);
  assert.equal(auditPage(events, { from: '2026-11-01', to: '2026-11-01' }).events[0].seq, 1);
  assert.equal(auditPage(events, { query: 'damage' }).total, 1);
  assert.deepEqual(
    events.map((e) => e.seq),
    [3, 1, 2],
  );
});
