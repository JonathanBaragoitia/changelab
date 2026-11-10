import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { OllamaGenerator, PROMPT_VERSION, GENERATION_OPTIONS } from '../infrastructure/ollama.ts';
import { PreparePlan } from '../application/planning.ts';
import { Store } from '../infrastructure/store.ts';
import { cases, CASES_VERSION } from './cases.ts';

const generator = new OllamaGenerator(process.env.CHANGELAB_MODEL);
const status = await generator.status();
if (!status.available) {
  console.error(status.message);
  process.exitCode = 1;
} else {
  const store = new Store(':memory:');
  const prepare = new PreparePlan(store, generator);
  const results = [];
  try {
    for (const item of cases) {
      const start = performance.now();
      try {
        const result = await prepare.execute(item.instruction);
        const passed =
          result.kind === item.expected.kind &&
          (item.expected.kind !== 'plan' ||
            (result.kind === 'plan' &&
              result.plan.category === item.expected.plan.category &&
              result.plan.basisPoints === item.expected.plan.basisPoints));
        results.push({
          id: item.id,
          passed,
          elapsedMs: Math.round(performance.now() - start),
          expected: item.expected,
          result,
        });
        console.log(item.id + ': ' + (passed ? 'PASS' : 'FAIL'));
      } catch {
        results.push({
          id: item.id,
          passed: false,
          elapsedMs: Math.round(performance.now() - start),
          error: 'GENERATION_FAILED',
        });
        console.log(item.id + ': ERROR');
      }
    }
  } finally {
    store.close();
  }
  const output = resolve('data', 'evaluations');
  mkdirSync(output, { recursive: true });
  const path = resolve(output, new Date().toISOString().replaceAll(':', '-') + '.json');
  const passed = results.filter((result) => result.passed).length;
  writeFileSync(
    path,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        model: generator.model,
        modelDigest: status.modelDigest,
        runtime: process.version,
        generationOptions: GENERATION_OPTIONS,
        promptVersion: PROMPT_VERSION,
        casesVersion: CASES_VERSION,
        passed,
        total: cases.length,
        results,
      },
      null,
      2,
    ),
  );
  console.log(passed + '/' + cases.length + ' · ' + path);
  if (passed !== cases.length) process.exitCode = 1;
}
