import { validTrackingUrl } from '../application/order-delivery.ts';
import { MailFailure, type MailJob, type MailTransport, validEmail } from './mail-outbox.ts';
export class PreviewMailTransport implements MailTransport {
  provider = 'preview' as const;
  async send(_job: MailJob): Promise<{ id: string }> {
    throw new MailFailure('PREVIEW_ONLY', false);
  }
}
export class ResendMailTransport implements MailTransport {
  provider = 'resend' as const;
  private key: string;
  private from: string;
  private request: typeof fetch;
  constructor(key: string, from: string, request: typeof fetch = fetch) {
    if (!key || !validEmail(from)) throw Error('INVALID_MAIL_CONFIGURATION');
    this.key = key;
    this.from = from;
    this.request = request;
  }
  async send(job: MailJob) {
    const response = await this.request('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: 'Bearer ' + this.key,
        'Content-Type': 'application/json',
        'Idempotency-Key': job.id,
      },
      body: JSON.stringify({ from: this.from, to: [job.to], subject: job.subject, text: job.text }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new MailFailure(
        'PROVIDER_HTTP_' + response.status,
        response.status === 429 || response.status >= 500 || response.status === 409,
      );
    const result = (await response.json()) as { id?: unknown };
    if (typeof result.id !== 'string' || !result.id)
      throw new MailFailure('INVALID_PROVIDER_RESPONSE', true);
    return { id: result.id };
  }
}
export function mailConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const requested = env.CHANGELAB_MAIL_PROVIDER ?? 'preview';
  const from = env.CHANGELAB_MAIL_FROM ?? 'no-reply@example.invalid';
  let portal = env.CHANGELAB_SHOP_URL;
  let publicPortal = false;
  if (portal) {
    try {
      const u = new URL(portal);
      publicPortal = !!validTrackingUrl(portal) && !/\.(invalid|test|example)$/.test(u.hostname);
      if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) portal = undefined;
    } catch {
      portal = undefined;
    }
  }
  const enabled =
    requested === 'resend' &&
    env.CHANGELAB_MAIL_ENABLE_SEND === 'true' &&
    !!env.CHANGELAB_MAIL_API_KEY &&
    !!env.CHANGELAB_MAIL_FROM &&
    validEmail(from) &&
    !/@(.*\.)?(invalid|example|test|localhost)$|@example\.(com|org|net)$/i.test(from) &&
    publicPortal;
  return {
    transport: enabled
      ? new ResendMailTransport(env.CHANGELAB_MAIL_API_KEY!, from)
      : new PreviewMailTransport(),
    from,
    portal,
    mode: enabled ? 'resend' : 'preview',
    message: enabled
      ? 'Envío habilitado; los aceptados por el proveedor no confirman recepción en el buzón.'
      : 'Mensajes guardados para revisar. No se envía correo externo.',
  };
}
