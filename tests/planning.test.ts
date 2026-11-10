import test from 'node:test';
import assert from 'node:assert/strict';
import { PreparePlan, validateDecision } from '../src/application/planning.ts';
import type { PlanGenerator } from '../src/application/planning.ts';
import { AppError } from '../src/domain/catalog.ts';
import { Store } from '../src/infrastructure/store.ts';

const plan = (basisPoints = 500) => ({
  kind: 'plan',
  plan: { category: 'Lavado exterior', basisPoints },
  explanation: 'Ajuste solicitado',
});
const code = (expected: string) => (error: unknown) =>
  error instanceof AppError && error.code === expected;

test('el generador recibe solo instrucción y categorías; preparar no escribe ni publica', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const before = {
    products: store.products(),
    orders: store.orders(),
    proposals: store.proposals(),
    audit: store.audit(),
  };
  let received: unknown;
  const generator: PlanGenerator = {
    async generate(input) {
      received = input;
      return plan();
    },
  };
  const result = await new PreparePlan(store, generator).execute('  Sube Lavado exterior un 5 %  ');
  assert.deepEqual(received, {
    instruction: 'Sube Lavado exterior un 5 %',
    categories: [
      'Lavado exterior',
      'Interior',
      'Llantas y neumáticos',
      'Cristales',
      'Protección de pintura',
      'Accesorios de limpieza',
    ],
  });
  assert.equal(result.kind, 'plan');
  if (result.kind === 'plan') {
    assert.equal(result.status, 'ready');
    assert.equal(result.simulation.changes.length, 3);
  }
  assert.deepEqual(
    {
      products: store.products(),
      orders: store.orders(),
      proposals: store.proposals(),
      audit: store.audit(),
    },
    before,
  );
});

test('la validación independiente bloquea un plan generado que viola el margen', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const result = await new PreparePlan(store, {
    async generate() {
      return plan(-2500);
    },
  }).execute('Rebaja');
  assert.equal(result.kind, 'plan');
  if (result.kind === 'plan') {
    assert.equal(result.status, 'blocked');
    assert.ok(result.simulation.findings.some((finding) => finding.code === 'MIN_MARGIN'));
  }
  assert.equal(store.proposals().length, 0);
});

test('el contrato permite pedir aclaración o rechazar, sin inventar un plan', () => {
  assert.deepEqual(validateDecision({ kind: 'clarification', question: '¿Qué categoría?' }), {
    kind: 'clarification',
    question: '¿Qué categoría?',
  });
  assert.deepEqual(validateDecision({ kind: 'refusal', reason: 'No puedo eliminar pedidos.' }), {
    kind: 'refusal',
    reason: 'No puedo eliminar pedidos.',
  });
});

test('las salidas desconocidas, SQL, autoaprobación y planes inválidos se rechazan', () => {
  for (const output of [
    null,
    [],
    'texto libre',
    { kind: 'execute', sql: 'DELETE FROM products' },
    { ...plan(), approved: true },
    { ...plan(), plan: { category: 'Lavado exterior', basisPoints: 500, sql: 'UPDATE products' } },
    plan(5001),
    plan(0),
    { kind: 'clarification', question: '' },
    { kind: 'refusal', reason: 'x', plan: plan().plan },
    { ...plan(), explanation: 'x'.repeat(1001) },
  ])
    assert.throws(() => validateDecision(output), code('INVALID_GENERATION'));
});

test('categoría inventada por el generador se rechaza', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  await assert.rejects(
    new PreparePlan(store, {
      async generate() {
        return { ...plan(), plan: { category: 'Inventada', basisPoints: 500 } };
      },
    }).execute('Cambio'),
    code('INVALID_GENERATION'),
  );
});

test('fallos del proveedor quedan acotados y no revelan su mensaje interno', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  await assert.rejects(
    new PreparePlan(store, {
      async generate() {
        throw new Error('detalle privado');
      },
    }).execute('Cambio'),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'GENERATION_FAILED');
      assert.doesNotMatch(error.message, /detalle privado/);
      return true;
    },
  );
});

test('instrucciones inválidas no invocan al generador', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  let calls = 0;
  const prepare = new PreparePlan(store, {
    async generate() {
      calls++;
      return plan();
    },
  });
  for (const input of [null, '', '  ', 'x'.repeat(1001)]) {
    await assert.rejects(prepare.execute(input), code('INVALID_INSTRUCTION'));
  }
  assert.equal(calls, 0);
});

test('tras esperar al generador se simula contra los datos actuales', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const result = await new PreparePlan(store, {
    async generate() {
      store.db.prepare('UPDATE products SET costCents=8000 WHERE id=?').run('nc1');
      return plan();
    },
  }).execute('Sube Lavado exterior');
  assert.equal(result.kind, 'plan');
  if (result.kind === 'plan') assert.equal(result.status, 'blocked');
});
