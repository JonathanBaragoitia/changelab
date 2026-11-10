export type OrderPermission =
  | 'warehouse.prepare'
  | 'orders.ship'
  | 'warehouse.receive'
  | 'warehouse.damage'
  | 'warehouse.handover';
export type OperationalActor = {
  id: string;
  role: string;
  name?: string;
  profile?: 'warehouse';
  businessRole?: 'owner' | 'office';
  ownerApprovalRequired?: boolean;
  permissions?: readonly string[];
};
export function canOperate(actor: OperationalActor, permission: OrderPermission) {
  if (actor.businessRole === 'owner') return true;
  if (actor.businessRole === 'office' && permission.startsWith('warehouse.')) return false;
  // Older local callers retain editor behaviour; authenticated HTTP actors always carry explicit grants.
  return (
    (['editor', 'reviewer'].includes(actor.role) || actor.profile === 'warehouse') &&
    (actor.permissions ? actor.permissions.includes(permission) : actor.role === 'editor')
  );
}
