import { opportunityPriority } from '../application/business.ts';
import type { BusinessContext } from '../application/business.ts';
export function baselineIds(context: BusinessContext) {
  const priority = opportunityPriority;
  return [...context.opportunities]
    .sort((a, b) => priority(a.code) - priority(b.code) || a.id.localeCompare(b.id))
    .slice(0, 5)
    .map((o) => o.id);
}
export function coverage(context: BusinessContext, ids: string[]) {
  const target = Math.min(5, context.opportunities.length);
  return {
    selected: ids.length,
    target,
    coverage: target ? ids.length / target : 1,
    complete: ids.length === target,
  };
}
export function agreement(a: string[], b: string[]) {
  const union = new Set([...a, ...b]),
    intersection = a.filter((id) => b.includes(id));
  return union.size ? intersection.length / union.size : 1;
}
