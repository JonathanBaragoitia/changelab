import { AppError, fail } from '../domain/catalog.ts';
import { rankOpportunities } from './business.ts';
import type { BusinessContext, OpportunityRanker } from './business.ts';

export const BUSINESS_PROMPT_VERSION = 'business-priority-v3-stock';
export type BusinessRun = {
  id: string;
  createdAt: string;
  actorId: string;
  model: string;
  promptVersion: string;
  contextHash: string;
  context: BusinessContext;
  status: 'running' | 'accepted' | 'rejected' | 'failed' | 'stale' | 'skipped';
  durationMs: number | null;
  ids: string[];
  errorCode: string | null;
};
export interface BusinessRunRepository {
  start(run: BusinessRun): void;
  finish(run: BusinessRun): void;
  latest(): BusinessRun[];
}
export class TrackBusinessRanking {
  repo: BusinessRunRepository;
  constructor(repo: BusinessRunRepository) {
    this.repo = repo;
  }
  async execute(
    actorId: string,
    snapshot: { context: BusinessContext; contextHash: string },
    ranker: OpportunityRanker,
    currentHash: () => string,
  ) {
    const run: BusinessRun = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      actorId,
      model: ranker.model ?? 'Modelo no identificado',
      promptVersion: BUSINESS_PROMPT_VERSION,
      contextHash: snapshot.contextHash,
      context: snapshot.context,
      status: 'running',
      durationMs: null,
      ids: [],
      errorCode: null,
    };
    // Save before invoking the model: an interruption remains visible as unfinished.
    this.repo.start(run);
    const started = performance.now();
    let result: Awaited<ReturnType<typeof rankOpportunities>>;
    try {
      result = await rankOpportunities(snapshot.context, ranker);
      if (currentHash() !== snapshot.contextHash)
        fail(409, 'CONTEXT_CHANGED', 'Los datos cambiaron durante el análisis. Actualiza.');
      run.status = result.modelUsed ? 'accepted' : 'skipped';
      run.ids = result.ids;
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'ANALYSIS_FAILED';
      run.errorCode = code;
      run.status =
        code === 'CONTEXT_CHANGED'
          ? 'stale'
          : ['INVALID_RANKING', 'INVALID_PRIORITY'].includes(code)
            ? 'rejected'
            : 'failed';
      run.durationMs = Math.round(performance.now() - started);
      this.repo.finish(run);
      throw error;
    }
    run.durationMs = Math.round(performance.now() - started);
    // If persistence fails, do not return an unrecorded success.
    this.repo.finish(run);
    return {
      ...result,
      runId: run.id,
      contextHash: run.contextHash,
      promptVersion: run.promptVersion,
    };
  }
}
