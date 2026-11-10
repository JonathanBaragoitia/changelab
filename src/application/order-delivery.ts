import { deliveryBusinessDate } from './business-calendar.ts';
import type { Sale } from './commerce.ts';
export function validTrackingUrl(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 2000) throw Error('INVALID_TRACKING_URL');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw Error('INVALID_TRACKING_URL');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    /^(localhost|127\.|0\.|\[|10\.|192\.168\.)/i.test(url.hostname) ||
    url.hostname.endsWith('.local') ||
    url.hostname.endsWith('.localhost') ||
    url.hostname.endsWith('.internal') ||
    !url.hostname.includes('.') ||
    /^[0-9.]+$/.test(url.hostname)
  )
    throw Error('INVALID_TRACKING_URL');
  return url.href;
}
/** Indicative shop policy, not a carrier ETA or a delivery confirmation. */
export function orderDelivery(sale: Sale) {
  const dispatch = sale.dispatch;
  if (!dispatch) return null;
  let trackingUrl: string | undefined;
  try {
    trackingUrl = validTrackingUrl(dispatch.trackingUrl);
  } catch {}
  const pickedUpAt = sale.shippedBy?.at ?? null;
  return {
    carrier: dispatch.carrier,
    reference: dispatch.reference,
    arrangedAt: dispatch.at,
    pickedUpAt,
    trackingUrl: trackingUrl ?? null,
    deliveryAddress: sale.customer?.address ?? null,
    estimatedDelivery: pickedUpAt
      ? {
          from: deliveryBusinessDate(pickedUpAt, 2),
          to: deliveryBusinessDate(pickedUpAt, 4),
          basis: 'shop-policy',
        }
      : null,
  };
}
