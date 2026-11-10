import { canApprove, canApproveOwn } from './company-roles.ts';
import { reviewChanges, calculateScenario } from '../domain/impact.ts';
import { checkChanges, fail, simulate } from '../domain/catalog.ts';
import type { Proposal } from '../domain/catalog.ts';
import type { ChangeRepository, Digest, Clock, Ids } from './ports.ts';
export const actors = [
  { id: 'elena', name: 'Elena Martín', role: 'editor', initials: 'EM' },
  { id: 'marcos', name: 'Marcos Vidal', role: 'reviewer', initials: 'MV' },
  { id: 'lucia', name: 'Lucía Costa', role: 'viewer', initials: 'LC' },
] as const;
export type Actor = {
  permissions?: readonly string[];
  profile?: 'warehouse';
  businessRole?: 'owner' | 'office';
  ownerApprovalRequired?: boolean;
  id: string;
  name: string;
  role: 'editor' | 'reviewer' | 'viewer';
  initials: string;
};
export function actorFor(id: string | undefined): Actor {
  return (
    actors.find((a) => a.id === id) ??
    fail(401, 'UNKNOWN_ACTOR', 'Selecciona una identidad de demostración.')
  );
}
function requireRole(actor: Actor, role: Actor['role']) {
  if (role === 'reviewer' ? !canApprove(actor) : actor.role !== role)
    fail(403, 'FORBIDDEN', 'Esta acción requiere el rol ' + role + '.');
}
export class ProposalService {
  repo: ChangeRepository;
  digest: Digest;
  clock: Clock;
  ids: Ids;
  constructor(repo: ChangeRepository, digest: Digest, clock: Clock, ids: Ids) {
    this.repo = repo;
    this.digest = digest;
    this.clock = clock;
    this.ids = ids;
  }
  create(actor: Actor, body: Record<string, unknown>): Proposal {
    requireRole(actor, 'editor');
    if (
      typeof body.instruction !== 'string' ||
      !body.instruction.trim() ||
      body.instruction.length > 1000
    )
      return fail(
        400,
        'INVALID_INSTRUCTION',
        'Escribe el motivo del cambio (máximo 1.000 caracteres).',
      );
    const result = simulate(this.repo.products(), body.plan),
      digest = this.digest.hash({
        instruction: body.instruction.trim(),
        createdBy: actor.id,
        plan: result.plan,
        changes: result.changes,
      });
    const p: Proposal = {
      ...result,
      id: this.ids.next(),
      instruction: body.instruction.trim(),
      createdBy: actor.id,
      createdAt: this.clock.now(),
      digest,
      status: result.findings.length ? 'blocked' : 'ready',
    };
    this.repo.transaction(() => {
      this.repo.save(p);
      this.repo.record(actor.id, 'proposal.simulated', {
        id: p.id,
        digest,
        findings: p.findings,
        plan: p.plan,
        instruction: p.instruction,
        createdBy: p.createdBy,
        actorName: actor.name,
        changes: p.changes,
      });
    });
    return p;
  }
  review(id: string) {
    const p = this.repo.proposal(id) ?? fail(404, 'NOT_FOUND', 'No existe esa propuesta.');
    return { proposalId: p.id, digest: p.digest, status: p.status, ...reviewChanges(p.changes) };
  }
  scenario(id: string, body: Record<string, unknown>) {
    const p = this.repo.proposal(id) ?? fail(404, 'NOT_FOUND', 'No existe esa propuesta.');
    if (
      typeof body.digest !== 'string' ||
      body.digest !== p.digest ||
      this.digest.hash({
        instruction: p.instruction,
        createdBy: p.createdBy,
        plan: p.plan,
        changes: p.changes,
      }) !== body.digest
    ) {
      fail(409, 'REVIEW_MISMATCH', 'La propuesta no coincide con la versión revisada.');
    }
    if (Object.keys(body).some((key) => !['digest', 'quantities'].includes(key))) {
      fail(400, 'INVALID_SCENARIO', 'El escenario contiene campos no permitidos.');
    }
    return { proposalId: p.id, digest: p.digest, ...calculateScenario(p.changes, body.quantities) };
  }
  publish(actor: Actor, id: string, digest: unknown): Proposal {
    requireRole(actor, 'reviewer');
    return this.repo.transaction(() => {
      const p = this.repo.proposal(id) ?? fail(404, 'NOT_FOUND', 'No existe esa propuesta.');
      if (p.status !== 'ready')
        fail(409, 'INVALID_STATE', 'Solo se pueden publicar propuestas listas para revisión.');
      if (p.createdBy === actor.id && !canApproveOwn(actor))
        fail(403, 'SELF_APPROVAL', 'El autor no puede aprobar su propia propuesta.');
      if (
        typeof digest !== 'string' ||
        digest !== p.digest ||
        this.digest.hash({
          instruction: p.instruction,
          createdBy: p.createdBy,
          plan: p.plan,
          changes: p.changes,
        }) !== digest
      )
        fail(409, 'REVIEW_MISMATCH', 'La propuesta no coincide con la versión revisada.');
      const findings = checkChanges(this.repo.products(), p.changes);
      const firstFinding = findings[0];
      if (firstFinding)
        fail(409, firstFinding.code, firstFinding.message + ' Crea una nueva simulación.');
      for (const c of p.changes)
        if (!this.repo.updatePrice(c)) fail(409, 'STALE_DATA', 'Se detectó un cambio concurrente.');
      const applied: Proposal = {
        ...p,
        status: 'applied',
        appliedBy: actor.id,
        appliedAt: this.clock.now(),
      };
      this.repo.save(applied);
      this.repo.record(actor.id, 'proposal.applied', {
        id,
        digest,
        changes: p.changes,
        plan: p.plan,
        instruction: p.instruction,
        createdBy: p.createdBy,
        actorName: actor.name,
      });
      return applied;
    });
  }
}
