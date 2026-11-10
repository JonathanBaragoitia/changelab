import { fail } from '../domain/catalog.ts';
import {
  editor,
  fields,
  text,
  type Actor,
  type Purchases,
  type Incidents,
  type Incident,
  type DocumentRepository,
} from '../application/operations.ts';
import type { PartialReturns } from '../application/partial-returns.ts';
import {
  validateExtracted,
  type DocumentImports,
  type DocumentImport,
} from '../application/document-imports.ts';
import {
  dailyBrief,
  explainFollowUp,
  incidentReply,
  type CommercialAI,
} from '../application/shopping-assistance.ts';
import type { dailyWork, followUp } from '../application/workbench.ts';
type Dependencies = {
  purchases: Purchases;
  incidents: Incidents;
  partialReturns: PartialReturns;
  imports: DocumentImports;
  incidentStore: DocumentRepository<Incident>;
  importStore: DocumentRepository<DocumentImport>;
  tasks: () => ReturnType<typeof dailyWork>;
  report: () => unknown;
  followUp: () => ReturnType<typeof followUp>;
  process: (actor: Actor, id: string, body: Record<string, unknown>) => unknown;
  extractText: (body: Record<string, unknown>) => Promise<string>;
  ai: CommercialAI;
};
/** Authentication and CSRF run in the outer HTTP boundary before this router is called. */
export function operationsRoutes(d: Dependencies) {
  return async (
    method: string,
    path: string,
    body: Record<string, unknown>,
    actor: Actor,
  ): Promise<{ status: number; value: unknown } | undefined> => {
    const ok = (value: unknown, status = 200) => ({ status, value });
    const source = /^\/api\/document-imports\/([\w-]+)$/.exec(path);
    if (method === 'GET') {
      if (path === '/api/operations') return ok(d.report());
      if (source?.[1]) {
        const value = d.importStore.get(source[1]);
        if (!value) fail(404, 'IMPORT_MISSING', 'Documento no encontrado.');
        return ok(value);
      }
      return;
    }
    if (method !== 'POST') return;
    if (path === '/api/purchases') return ok(d.purchases.create(actor, body), 201);
    if (path === '/api/replenishments')
      return ok(d.purchases.createReplenishment(actor, body), 201);
    const purchase = /^\/api\/purchases\/([\w-]+)$/.exec(path);
    if (purchase?.[1]) return ok(d.purchases.transition(actor, purchase[1], body));
    if (path === '/api/partial-returns') return ok(d.partialReturns.execute(actor, body), 201);
    if (path === '/api/incidents') return ok(d.incidents.create(actor, body), 201);
    if (path === '/api/daily/brief') {
      fields(body, []);
      return ok(await dailyBrief(d.ai, d.tasks()));
    }
    if (path === '/api/incidents/draft') {
      editor(actor);
      fields(body, ['id']);
      const incident = d.incidentStore.get(text(body.id, 1, 80));
      if (!incident) fail(404, 'INCIDENT_MISSING', 'Incidencia no encontrada.');
      return ok(
        await incidentReply(d.ai, {
          kind: incident.kind,
          description: incident.description,
          status: incident.status,
          resolution: incident.resolution,
        }),
      );
    }
    const incident = /^\/api\/incidents\/([\w-]+)$/.exec(path);
    if (incident?.[1]) return ok(d.incidents.update(actor, incident[1], body));
    if (path === '/api/follow-up/brief') {
      fields(body, ['id']);
      const id = text(body.id, 1, 80),
        report = d.followUp().find((r) => r.id === id);
      if (!report) fail(404, 'FOLLOWUP_MISSING', 'Cambio publicado no encontrado.');
      return ok(explainFollowUp(report));
    }
    if (path === '/api/document-imports/extract') {
      editor(actor);
      fields(body, ['format', 'source', 'useAI']);
      if (typeof body.useAI !== 'boolean')
        fail(400, 'INVALID_MODE', 'Selecciona extracción IA o revisión manual.');
      const source = await d.extractText(body),
        rows = body.useAI ? validateExtracted(await d.ai.extract(source), source) : [];
      return ok(d.imports.save(actor, source, rows, body.useAI), 201);
    }
    const process = /^\/api\/document-imports\/([\w-]+)\/process$/.exec(path);
    if (process?.[1]) return ok(d.process(actor, process[1], body));
    return;
  };
}
