export function shippingDetails(order, esc) {
  const shipping = order.shipping;
  const date = (v) => esc(new Date(v).toLocaleString('es-ES'));
  if (['cancelled', 'returned'].includes(order.status))
    return '<p>Este pedido no tiene una entrega pendiente.</p>';
  if (!shipping)
    return '<p>El transportista y la referencia estarán disponibles cuando oficina tramite la expedición.</p>';
  let link = '';
  try {
    const url = new URL(shipping.trackingUrl);
    if (url.protocol === 'https:' && !url.username && !url.password)
      link =
        '<p><a class="chip" target="_blank" rel="noopener noreferrer" href="' +
        esc(url.href) +
        '">Consultar seguimiento del transportista</a></p>';
  } catch {}
  const eta = shipping.estimatedDelivery;
  return (
    '<section class="shipping-details" aria-label="Datos del envío"><h4>Datos del envío</h4><dl><dt>Transportista</dt><dd>' +
    esc(shipping.carrier) +
    '</dd><dt>Referencia de expedición</dt><dd>' +
    esc(shipping.reference) +
    '</dd><dt>Envío tramitado</dt><dd>' +
    date(shipping.arrangedAt) +
    '</dd>' +
    (shipping.pickedUpAt
      ? '<dt>Recogido por el transportista</dt><dd>' + date(shipping.pickedUpAt) + '</dd>'
      : '<dt>Recogida</dt><dd>Pendiente de recogida del transportista.</dd>') +
    (shipping.deliveryAddress
      ? '<dt>Dirección de entrega</dt><dd>' + esc(shipping.deliveryAddress) + '</dd>'
      : '') +
    '</dl>' +
    link +
    (eta?.from && eta?.to
      ? '<p>Entrega orientativa: entre el ' +
        esc(new Date(eta.from + 'T12:00:00').toLocaleDateString('es-ES')) +
        ' y el ' +
        esc(new Date(eta.to + 'T12:00:00').toLocaleDateString('es-ES')) +
        '. Estimación de la tienda desde la recogida; no contempla festivos ni confirma la entrega.</p>'
      : '<p>Plazo orientativo de transporte: 2–4 días laborables desde la recogida. No es una fecha confirmada por el transportista.</p>') +
    (!link
      ? '<p>No se ha facilitado un enlace de seguimiento. Conserva la referencia para consultar con el transportista.</p>'
      : '') +
    '</section>'
  );
}
