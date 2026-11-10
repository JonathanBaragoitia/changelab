// Indicative shop policy, not a carrier promise or a live tracking integration.
export const deliveryEstimate =
  'Entrega orientativa: 2–4 días laborables desde la confirmación. No incluye fines de semana ni festivos; el destino puede ampliar el plazo.';
export function orderProgress(status) {
  const steps = ['Pedido recibido', 'En preparación', 'Enviado'];
  const active = { confirmed: 0, prepared: 1, shipped: 2 }[status];
  if (active === undefined) return [];
  return steps.map((label, index) => ({
    label,
    current: index === active,
    complete: index < active,
  }));
}
