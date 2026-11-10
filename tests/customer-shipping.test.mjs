import test from 'node:test';
import assert from 'node:assert/strict';
import { shippingDetails } from '../public/customer-shipping.js';
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
test('datos de transporte visibles, con escape y enlace seguro; pendiente sin afirmar enviado', () => {
  const html = shippingDetails(
    {
      status: 'prepared',
      shipping: {
        carrier: '<img onerror=bad>',
        reference: 'REF-123',
        arrangedAt: '2026-11-05T12:00:00Z',
        pickedUpAt: null,
        trackingUrl: 'javascript:alert(1)',
      },
    },
    esc,
  );
  assert.match(html, /REF-123/);
  assert.match(html, /Pendiente de recogida/);
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('href="javascript:'));
  const sent = shippingDetails(
    {
      status: 'shipped',
      shipping: {
        carrier: 'Transportista',
        reference: 'REF-123',
        arrangedAt: '2026-11-05T12:00:00Z',
        pickedUpAt: '2026-11-05T12:10:00Z',
        trackingUrl: 'https://transportista.es/track',
        estimatedDelivery: { from: '2026-11-09', to: '2026-11-11' },
      },
    },
    esc,
  );
  assert.match(sent, /Recogido por el transportista/);
  assert.match(sent, /noopener noreferrer/);
  assert.match(sent, /Entrega orientativa/);
});
