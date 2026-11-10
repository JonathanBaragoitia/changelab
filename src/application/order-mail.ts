import { customerView, type Sale } from './commerce.ts';
export type OrderMailEvent = 'confirmed' | 'shipped' | 'cancelled';
export type MailContent = { to: string; subject: string; text: string };
export function composeOrderMail(
  sale: Sale,
  event: OrderMailEvent,
  portal?: string,
): MailContent | null {
  if (!sale.customer) return null;
  const short = sale.id.slice(0, 8),
    view = customerView(sale);
  const title = {
    confirmed: 'Pedido confirmado',
    shipped: 'Tu pedido ha sido enviado',
    cancelled: 'Pedido cancelado',
  }[event];
  const format = (at: string) =>
    new Date(at).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
  const money = (n: number) =>
    new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n / 100);
  const shipping = view.shipping;
  const lines = [
    `Hola, ${sale.customer.name}.`,
    '',
    `${title}: ${short}.`,
    `Fecha del pedido: ${format(sale.createdAt)}.`,
    '',
    ...sale.lines.map((l) => `${l.quantity} × ${l.name}`),
    '',
    `Total con IVA: ${money(view.totalCents)}.`,
  ];
  if (event === 'shipped') {
    if (shipping) {
      lines.push(
        '',
        `Transportista: ${shipping.carrier}`,
        `Referencia de expedición: ${shipping.reference}`,
      );
      if (shipping.pickedUpAt) lines.push(`Recogida: ${format(shipping.pickedUpAt)}`);
      if (shipping.trackingUrl) lines.push(`Seguimiento: ${shipping.trackingUrl}`);
      if (shipping.estimatedDelivery?.from && shipping.estimatedDelivery.to)
        lines.push(
          `Entrega orientativa: ${shipping.estimatedDelivery.from} a ${shipping.estimatedDelivery.to}. Estimación de la tienda, sin festivos; no es confirmación del transportista.`,
        );
    } else lines.push('La oficina todavía no ha registrado los datos del transportista.');
  }
  if (event === 'cancelled')
    lines.push(
      'El pedido está cancelado. Si procede reembolso, se tramita y confirma por separado.',
    );
  else lines.push(`Dirección de entrega: ${sale.customer.address}`);
  lines.push(
    '',
    portal
      ? `Consulta tus pedidos: ${portal}`
      : 'Puedes consultar los detalles desde Mis pedidos en tu cuenta.',
    '',
    'Norte AutoCare',
  );
  return { to: sale.customer.email, subject: `${title} · ${short}`, text: lines.join('\n') };
}
