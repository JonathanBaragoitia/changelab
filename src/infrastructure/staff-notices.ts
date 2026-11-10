import type { Store } from './store.ts';
import type { Actor } from '../application/proposals.ts';
import { fail } from '../domain/catalog.ts';
export class StaffNotices {
  private store: Store;
  constructor(store: Store) {
    this.store = store;
    store.db.exec(
      'CREATE TABLE IF NOT EXISTS staff_notice_reads(recipient TEXT NOT NULL,eventId TEXT NOT NULL,readAt TEXT NOT NULL,PRIMARY KEY(recipient,eventId))',
    );
  }
  list(actor: Actor) {
    const roles =
      actor.businessRole === 'owner'
        ? ['owner', 'office', 'warehouse']
        : actor.businessRole === 'office'
          ? ['office']
          : actor.profile === 'warehouse'
            ? ['warehouse']
            : [];
    const names = this.store.identityNames();
    const readIds = new Set(
      this.store.db
        .prepare('SELECT eventId FROM staff_notice_reads WHERE recipient=?')
        .all(actor.id)
        .map((row) => String(row.eventId)),
    );
    return this.store.db
      .prepare(
        "SELECT id,at,actor,action,detail FROM audit WHERE seq > COALESCE((SELECT MIN(seq) FROM audit WHERE action='account.company-roles-configured'),0) ORDER BY seq DESC LIMIT 5000",
      )
      .all()
      .flatMap((event) => {
        let d: Record<string, unknown>;
        try {
          d = JSON.parse(String(event.detail));
        } catch {
          return [];
        }
        let target = '',
          section = '',
          message = '';
        const short = String(d.orderId ?? d.id ?? '').slice(0, 8);
        if (event.action === 'order.status-changed' && d.after === 'prepared') {
          target = 'office';
          section = 'shipping';
          message = 'Almacén ha preparado el pedido ' + short + '. Ya puedes tramitar el envío.';
        }
        if (event.action === 'order.status-changed' && d.after === 'shipped') {
          target = 'office';
          section = 'shipping';
          message =
            'El transportista ha recogido el pedido ' + short + '. El cliente ya lo ve enviado.';
        }
        if (event.action === 'order.dispatch-arranged') {
          target = 'warehouse';
          section = 'warehouse';
          message =
            'Oficina ha tramitado el pedido ' +
            short +
            '. Confirma la recogida cuando se lleve el paquete el transportista.';
        }
        if (event.action === 'transport.damage-created') {
          target = 'office';
          section = 'transport';
          message =
            'Almacén ha comunicado una rotura. Revisa la incidencia y tramita la reclamación.';
        }
        if (
          event.action === 'proposal.simulated' &&
          (!Array.isArray(d.findings) || d.findings.length === 0)
        ) {
          target = 'owner';
          section = 'proposals';
          message = 'Propuesta de cambio ' + short + ' preparada para tu decisión.';
        }
        if (event.action === 'tariff.prepared') {
          target = 'owner';
          section = 'tariffs';
          message = 'Tarifa ' + short + ' preparada. Revisa los cambios antes de aplicarlos.';
        }
        if (event.action === 'tariff.decision-prepared') {
          target = 'owner';
          section = 'tariffs';
          message =
            'Hay una propuesta comercial para la tarifa ' +
            short +
            '. Consulta los escenarios en Importar y revisar tarifas.';
        }
        if (event.action === 'purchase.created') {
          target = 'owner';
          section = 'purchases';
          message = 'Compra ' + short + ' preparada. Autoriza o pide cambios antes de tramitarla.';
        }
        if (event.action === 'approval.created') {
          target = 'owner';
          section = 'approvals';
          message = 'Solicitud de gasto ' + short + ' pendiente de tu decisión.';
          if (d.status !== 'pending') return [];
        }
        if (event.action === 'approval.resolved') {
          target = 'office';
          section = 'approvals';
          message =
            'Dirección ha resuelto la solicitud ' + short + '. Consulta la decisión y su motivo.';
        }
        if (
          event.action === 'purchase.approved' ||
          event.action === 'purchase.rejected' ||
          event.action === 'purchase.changes_requested'
        ) {
          target = 'office';
          section = 'purchases';
          message =
            'Dirección ha revisado la compra ' +
            short +
            '. Consulta la decisión antes de tramitarla.';
        }
        if (event.action === 'tariff.applied' || event.action === 'proposal.applied') {
          target = 'office';
          section = event.action === 'tariff.applied' ? 'tariffs' : 'proposals';
          message =
            'Dirección ha aprobado y aplicado el cambio ' +
            short +
            '. Ya puedes continuar la gestión.';
        }
        if (event.action === 'order.partial-returned') {
          target = 'office';
          section = 'returns';
          message =
            (d.condition === 'damaged'
              ? 'Almacén ha recibido mercancía dañada del pedido '
              : 'Almacén ha recibido una devolución del pedido ') +
            short +
            (d.condition === 'damaged' ? '. Está separada del stock vendible.' : '.') +
            ' Revisa con dirección si corresponde reembolso o rectificación.';
        }
        if (event.action === 'order.damaged-return-disposed') {
          target = 'office';
          section = 'returns';
          message =
            'Almacén ha registrado la baja física de las unidades dañadas del pedido ' +
            short +
            '. Consulta el historial de la devolución.';
        }
        if (!roles.includes(target)) return [];
        const read = readIds.has(String(event.id));
        return [
          {
            id: String(event.id),
            at: String(event.at),
            by: names[String(event.actor)] ?? String(event.actor),
            message,
            section,
            read,
          },
        ];
      })
      .slice(0, 100);
  }
  read(actor: Actor, id: string) {
    if (!this.list(actor).some((n) => n.id === id))
      fail(404, 'NOTICE_NOT_FOUND', 'Aviso no encontrado.');
    this.store.db
      .prepare('INSERT OR IGNORE INTO staff_notice_reads VALUES(?,?,?)')
      .run(actor.id, id, this.store.timestamp());
  }
}
