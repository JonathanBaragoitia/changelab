import test from 'node:test';
import assert from 'node:assert/strict';
import { OllamaGenerator } from '../src/infrastructure/ollama.ts';
import { validateDecision } from '../src/application/planning.ts';

const input = { instruction: 'Sube Lavado exterior un 5 %', categories: ['Lavado exterior'] };
const decision = {
  kind: 'plan',
  plan: { category: 'Lavado exterior', basisPoints: 500 },
  explanation: 'Subida del 5 %',
};
const wireDecision = {
  action: 'plan',
  category: 'Lavado exterior',
  basisPoints: 500,
  message: 'Subida del 5 %',
};
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('adaptador Ollama usa loopback, esquema, contexto mínimo y respuesta no streaming', async () => {
  const generator = new OllamaGenerator('test-local', async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal instanceof AbortSignal);
    assert.equal(typeof options?.body, 'string');
    const body: unknown = JSON.parse(String(options?.body));
    assert.ok(
      body &&
        typeof body === 'object' &&
        'stream' in body &&
        'messages' in body &&
        'format' in body,
    );
    assert.equal(body.stream, false);
    assert.ok(
      body.format &&
        typeof body.format === 'object' &&
        'type' in body.format &&
        'properties' in body.format,
    );
    assert.equal(body.format.type, 'object');
    assert.ok(!('anyOf' in body.format));
    assert.ok(body.format.properties && typeof body.format.properties === 'object');
    assert.equal(Object.keys(body.format.properties)[0], 'action');
    assert.ok(!('tools' in body));
    assert.ok(Array.isArray(body.messages));
    const user: unknown = body.messages.at(-1);
    assert.ok(user && typeof user === 'object' && 'content' in user);
    assert.deepEqual(JSON.parse(String(user.content)), input);
    return answer({
      done: true,
      done_reason: 'stop',
      message: { content: JSON.stringify(wireDecision) },
    });
  });
  assert.deepEqual(validateDecision(await generator.generate(input)), decision);
});

test('respuestas incompletas, JSON roto, error HTTP y exceso de tamaño fallan de forma cerrada', async () => {
  for (const response of [
    answer({ done: false, message: { content: JSON.stringify(wireDecision) } }),
    answer({
      done: true,
      done_reason: 'length',
      message: { content: JSON.stringify(wireDecision) },
    }),
    answer({ done: true, message: { content: 'no es JSON' } }),
    answer({ error: 'private detail' }, 500),
    new Response('x'.repeat(65537)),
  ]) {
    await assert.rejects(new OllamaGenerator('test-local', async () => response).generate(input));
  }
});

test('la señal de tiempo límite cancela un transporte que no responde', async () => {
  const generator = new OllamaGenerator(
    'test-local',
    async (_url, options) => {
      return new Promise<Response>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('test guard')), 500);
        options?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          },
          { once: true },
        );
      });
    },
    10,
  );
  await assert.rejects(generator.generate(input), /aborted/);
});

test('estado distingue modelo ausente, disponible y servicio caído', async () => {
  assert.equal(
    (await new OllamaGenerator('test-local', async () => answer({ models: [] })).status())
      .available,
    false,
  );
  assert.equal(
    (
      await new OllamaGenerator('test-local', async () =>
        answer({ models: [{ name: 'test-local' }] }),
      ).status()
    ).available,
    true,
  );
  assert.equal(
    (
      await new OllamaGenerator('test-local', async () => {
        throw new Error('private');
      }).status()
    ).available,
    false,
  );
});

test('el adaptador rechaza modelos cloud', () => {
  assert.throws(() => new OllamaGenerator('model:cloud'));
});

test('decisiones planas se convierten y rechazan campos incompatibles o adicionales', async () => {
  for (const wire of [
    { action: 'clarification', category: null, basisPoints: null, message: '¿Qué categoría?' },
    { action: 'refusal', category: null, basisPoints: null, message: 'No publico cambios' },
  ]) {
    const generator = new OllamaGenerator('test-local', async () =>
      answer({ done: true, message: { content: JSON.stringify(wire) } }),
    );
    const result = validateDecision(await generator.generate(input));
    assert.equal(result.kind, wire.action);
  }
  for (const wire of [
    { action: 'refusal', category: 'Lavado exterior', basisPoints: 500, message: 'No' },
    { action: 'plan', category: null, basisPoints: 500, message: 'Plan' },
    {
      action: 'plan',
      category: 'Lavado exterior',
      basisPoints: 500,
      message: 'Plan',
      sql: 'UPDATE products',
    },
    { action: 'execute', category: null, basisPoints: null, message: 'Ejecutar' },
  ]) {
    await assert.rejects(
      new OllamaGenerator('test-local', async () =>
        answer({ done: true, message: { content: JSON.stringify(wire) } }),
      ).generate(input),
    );
  }
});
