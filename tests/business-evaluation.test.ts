import test from 'node:test';
import assert from 'node:assert/strict';
import { businessCases } from '../src/evaluation/business-cases.ts';
import { baselineIds, coverage, agreement } from '../src/evaluation/business-metrics.ts';
import { rankOpportunities } from '../src/application/business.ts';

test('referencia determinista cumple prioridad y cobertura de todos los casos fijados', async () => {
  for (const item of businessCases) {
    const ids = baselineIds(item.context);
    assert.equal(coverage(item.context, ids).complete, true);
    const result = await rankOpportunities(item.context, { rank: async () => ({ ids }) });
    assert.deepEqual(result.ids, ids);
  }
});
test('métrica distingue formato válido de selección incompleta y omisión sin señales', () => {
  const context = businessCases.find((c) => c.id === 'mixed-three')!.context;
  assert.equal(coverage(context, []).coverage, 0);
  assert.equal(coverage(context, ['signal-1']).complete, false);
  assert.equal(coverage(businessCases.find((c) => c.id === 'empty')!.context, []).coverage, 1);
});
test('coincidencia de selección ignora orden y mide desacuerdo sin dividir entre cero', () => {
  assert.equal(agreement([], []), 1);
  assert.equal(agreement(['a', 'b'], ['b', 'a']), 1);
  assert.equal(agreement(['a'], ['b']), 0);
  assert.equal(agreement(['a', 'b'], ['b', 'c']), 1 / 3);
});
