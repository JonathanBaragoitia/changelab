import { fail, simulate, validatePlan } from '../domain/catalog.ts';
import type { Plan } from '../domain/catalog.ts';
import type { ChangeRepository } from './ports.ts';

/** The adapter receives minimal context and returns untrusted data, never database access. */
export interface PlanGenerator {
  generate(input: { instruction: string; categories: readonly string[] }): Promise<unknown>;
}

export type PlanDecision =
  | { kind: 'plan'; plan: Plan; explanation: string }
  | { kind: 'clarification'; question: string }
  | { kind: 'refusal'; reason: string };

function invalid(): never {
  return fail(502, 'INVALID_GENERATION', 'El generador devolvió una respuesta no permitida.');
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) return invalid();
  return value.trim();
}

export function validateDecision(value: unknown): PlanDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(',');
  switch (record.kind) {
    case 'plan': {
      if (keys !== 'explanation,kind,plan') return invalid();
      // Schema errors from a provider are upstream failures, not errors by the user.
      let plan: Plan;
      try {
        plan = validatePlan(record.plan);
      } catch {
        return invalid();
      }
      return { kind: 'plan', plan, explanation: text(record.explanation) };
    }
    case 'clarification':
      if (keys !== 'kind,question') return invalid();
      return { kind: 'clarification', question: text(record.question) };
    case 'refusal':
      if (keys !== 'kind,reason') return invalid();
      return { kind: 'refusal', reason: text(record.reason) };
    default:
      return invalid();
  }
}

export class PreparePlan {
  private catalog: Pick<ChangeRepository, 'products'>;
  private generator: PlanGenerator;

  constructor(catalog: Pick<ChangeRepository, 'products'>, generator: PlanGenerator) {
    this.catalog = catalog;
    this.generator = generator;
  }

  async execute(instruction: unknown) {
    if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 1000) {
      return fail(400, 'INVALID_INSTRUCTION', 'Escribe una instrucción de hasta 1.000 caracteres.');
    }
    const categories = [...new Set(this.catalog.products().map((product) => product.category))];
    let raw: unknown;
    try {
      raw = await this.generator.generate({ instruction: instruction.trim(), categories });
    } catch {
      return fail(502, 'GENERATION_FAILED', 'No se pudo obtener una propuesta del generador.');
    }
    const decision = validateDecision(raw);
    if (decision.kind !== 'plan') return decision;

    // Read again after the asynchronous call; no persistence or approval is available here.
    const products = this.catalog.products();
    if (!products.some((product) => product.category === decision.plan.category)) return invalid();
    const simulation = simulate(products, decision.plan);
    return {
      ...decision,
      simulation,
      status: simulation.findings.length ? ('blocked' as const) : ('ready' as const),
    };
  }
}
