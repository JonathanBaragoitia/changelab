import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OllamaGenerator, GENERATION_OPTIONS } from '../infrastructure/ollama.ts';
import { rankOpportunities } from '../application/business.ts';
import { BUSINESS_PROMPT_VERSION } from '../application/business-runs.ts';
import { businessCases, BUSINESS_CASES_VERSION } from './business-cases.ts';
import { baselineIds, coverage, agreement } from './business-metrics.ts';
import { AppError } from '../domain/catalog.ts';
import { sha } from '../infrastructure/store.ts';

const model = new OllamaGenerator(process.env.CHANGELAB_MODEL, fetch, 45000);
const status = await model.status();
if (!status.available) {
  console.error(status.message);
  process.exitCode = 1;
} else {
  const at = new Date().toISOString(),
    output = resolve('data', 'evaluations');
  mkdirSync(output, { recursive: true });
  const stem = resolve(output, 'business-' + at.replaceAll(':', '-'));
  const results: {
    caseId: string;
    repeat: number;
    valid: boolean;
    ids: string[];
    modelUsed: boolean;
    elapsedMs: number;
    errorCode?: string;
    coverage: number;
    complete: boolean;
  }[] = [];
  const meta = {
    at,
    model: model.model,
    modelDigest: status.modelDigest,
    promptVersion: BUSINESS_PROMPT_VERSION,
    casesVersion: BUSINESS_CASES_VERSION,
    casesHash: sha(businessCases),
    adapterHash: sha(OllamaGenerator.prototype.rank.toString()),
    runtime: process.version,
    options: { ...GENERATION_OPTIONS, num_predict: 300 },
    timeoutMs: 45000,
    repetitions: 2,
    scope:
      'Casos sintéticos de diagnóstico, definidos por el desarrollador. No evaluación independiente ni prueba de utilidad empresarial.',
    cases: businessCases,
  };
  const save = () => writeFileSync(stem + '.json', JSON.stringify({ ...meta, results }, null, 2));
  for (const item of businessCases)
    for (let repeat = 1; repeat <= 2; repeat++) {
      const start = performance.now();
      try {
        const result = await rankOpportunities(item.context, model),
          score = coverage(item.context, result.ids);
        results.push({
          caseId: item.id,
          repeat,
          valid: true,
          ids: result.ids,
          modelUsed: result.modelUsed,
          elapsedMs: Math.round(performance.now() - start),
          coverage: score.coverage,
          complete: score.complete,
        });
      } catch (error) {
        results.push({
          caseId: item.id,
          repeat,
          valid: false,
          ids: [],
          modelUsed: true,
          elapsedMs: Math.round(performance.now() - start),
          errorCode: error instanceof AppError ? error.code : 'EVALUATION_FAILED',
          coverage: 0,
          complete: false,
        });
      }
      save();
      console.log(item.id + ' #' + repeat + ': ' + JSON.stringify(results.at(-1)));
    }
  const valid = results.filter((r) => r.valid).length,
    complete = results.filter((r) => r.valid && r.complete).length;
  const rows = businessCases.map((item) => {
    const runs = results.filter((r) => r.caseId === item.id);
    return (
      '| ' +
      item.id +
      ' | ' +
      runs
        .map((r) =>
          r.valid
            ? 'válida ' + r.ids.length + '/' + Math.min(5, item.context.opportunities.length)
            : r.errorCode,
        )
        .join(' | ') +
      ' | ' +
      (runs.every((r) => r.valid)
        ? agreement(runs[0]!.ids, runs[1]!.ids).toFixed(2)
        : 'no comparable') +
      ' |'
    );
  });
  const report =
    '# Evaluación comercial IA\n\n' +
    meta.scope +
    '\n\nModelo ' +
    model.model +
    '; prompt ' +
    meta.promptVersion +
    '; dataset ' +
    meta.casesVersion +
    '. Dos repeticiones, sin modificar prompt durante esta evaluación. Digest y configuración en JSON adjunto.\n\n' +
    valid +
    '/' +
    results.length +
    ' salidas aceptadas por el validador; ' +
    complete +
    '/' +
    results.length +
    ' completas según rúbrica de cobertura (seleccionar min(5,señales)). Esta rúbrica es más exigente que el contrato actual, que permite listas parciales o vacías. No confundir incompletitud con vulneración del contrato.\n\n| Caso | Repetición 1 | Repetición 2 | Coincidencia de selección (Jaccard) |\n| --- | --- | --- | --- |\n' +
    rows.join('\n') +
    '\n\nReferencia determinista: ordenar por prioridad explícita y seleccionar hasta cinco; ' +
    businessCases.length +
    '/' +
    businessCases.length +
    ' casos con cobertura completa por construcción. No usa modelo ni acredita prioridad comercial adecuada. En empates se permiten diferentes señales; Jaccard no mide calidad. Los casos vacíos no invocan el modelo. Fallos se mantienen en denominadores; latencias individuales y selecciones están en JSON.\n\nCon prioridades ya fijadas por reglas, el LLM no ha demostrado valor adicional frente a ordenar directamente. Este diagnóstico permite justificar mantener señales deterministas y revisión humana. La utilidad de la IA requerirá una tarea con juicio contextual y evaluación separada; no añadir autonomía por estos resultados.\n';
  writeFileSync(stem + '.md', report);
  save();
  console.log('Informe: ' + stem + '.md');
  if (valid !== results.length) process.exitCode = 1;
}
