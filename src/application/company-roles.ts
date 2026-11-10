export type CompanyActor = {
  id: string;
  role: string;
  businessRole?: 'owner' | 'office';
  ownerApprovalRequired?: boolean;
};
/** Once direction is configured, legacy reviewer accounts cannot bypass its authority. */
export function canApprove(actor: CompanyActor) {
  return actor.businessRole
    ? actor.businessRole === 'owner'
    : !actor.ownerApprovalRequired && actor.role === 'reviewer';
}
export function canApproveOwn(actor: CompanyActor) {
  return actor.businessRole === 'owner';
}
export function needsOwnerDecision(actor: CompanyActor) {
  return (
    actor.businessRole === 'office' ||
    (actor.ownerApprovalRequired === true && actor.businessRole !== 'owner')
  );
}
