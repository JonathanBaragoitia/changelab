import { createHash, randomUUID } from 'node:crypto';
import type { Store } from './store.ts';
import type { Sale } from '../application/commerce.ts';
import {
  composeOrderMail,
  type OrderMailEvent,
  type MailContent,
} from '../application/order-mail.ts';
import { fail } from '../domain/catalog.ts';
export type MailStatus =
  'pending' | 'preview' | 'sending' | 'sent' | 'failed' | 'blocked' | 'uncertain';
export type MailJob = MailContent & {
  id: string;
  orderId: string;
  event: OrderMailEvent;
  status: MailStatus;
  attempts: number;
  createdAt: string;
  nextAttempt: number;
  firstAttempt: number | null;
  lockedUntil: number;
  providerId: string | null;
  error: string | null;
  previewOnly: number;
};
export interface MailTransport {
  provider: 'preview' | 'resend';
  send(job: MailJob): Promise<{ id: string }>;
}
export class MailFailure extends Error {
  retryable: boolean;
  constructor(code: string, retryable: boolean) {
    super(code);
    this.retryable = retryable;
  }
}
export function validEmail(value: string) {
  return value.length <= 150 && /^[^\s<>";,\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(value);
}
export class MailOutbox {
  private store: Store;
  private portal: string | undefined;
  constructor(store: Store, portal?: string) {
    this.store = store;
    this.portal = portal;
    store.db.exec(
      `CREATE TABLE IF NOT EXISTS mail_outbox(id TEXT PRIMARY KEY,orderId TEXT NOT NULL,event TEXT NOT NULL CHECK(event IN ('confirmed','shipped','cancelled')),recipient TEXT NOT NULL,subject TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','preview','sending','sent','failed','blocked','uncertain')),attempts INTEGER NOT NULL DEFAULT 0,createdAt TEXT NOT NULL,nextAttempt INTEGER NOT NULL DEFAULT 0,firstAttempt INTEGER,lockedUntil INTEGER NOT NULL DEFAULT 0,providerId TEXT,error TEXT,previewOnly INTEGER NOT NULL DEFAULT 0,UNIQUE(orderId,event));CREATE INDEX IF NOT EXISTS mail_pending ON mail_outbox(status,nextAttempt);`,
    );
  }
  queue(sale: Sale, event: OrderMailEvent, previewOnly = false) {
    return this.store.transaction(() => {
      const content = composeOrderMail(sale, event, this.portal);
      if (!content) return null;
      const id = createHash('sha256')
        .update(sale.id + '/' + event)
        .digest('hex');
      const inserted = this.store.db
        .prepare(
          'INSERT OR IGNORE INTO mail_outbox(id,orderId,event,recipient,subject,body,status,createdAt,previewOnly,error) VALUES(?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          sale.id,
          event,
          content.to,
          content.subject,
          content.text,
          validEmail(content.to) ? (previewOnly ? 'preview' : 'pending') : 'blocked',
          this.store.timestamp(),
          previewOnly ? 1 : 0,
          validEmail(content.to) ? null : 'INVALID_RECIPIENT',
        );
      if (inserted.changes)
        this.store.record('mail-service', 'mail.queued', {
          id,
          orderId: sale.id,
          event,
          previewOnly,
        });
      return id;
    });
  }
  private row(row: Record<string, unknown>): MailJob {
    return { ...row, to: row.recipient, text: row.body } as MailJob;
  }
  get(id: string) {
    const row = this.store.db.prepare('SELECT * FROM mail_outbox WHERE id=?').get(id);
    return row ? this.row(row) : undefined;
  }
  list() {
    return this.store.db
      .prepare('SELECT * FROM mail_outbox ORDER BY rowid DESC LIMIT 100')
      .all()
      .map((r) => this.row(r));
  }
  claim(now: number): MailJob | undefined {
    return this.store.transaction(() => {
      // An expired lease can be retried with the same provider idempotency key for at most 23 hours.
      this.store.db
        .prepare(
          "UPDATE mail_outbox SET status=CASE WHEN firstAttempt<? THEN 'uncertain' ELSE 'pending' END,error='INTERRUPTED_DELIVERY',lockedUntil=0 WHERE status='sending' AND lockedUntil<=?",
        )
        .run(now - 23 * 3600000, now);
      const row = this.store.db
        .prepare(
          "SELECT * FROM mail_outbox WHERE status='pending' AND nextAttempt<=? ORDER BY rowid LIMIT 1",
        )
        .get(now);
      if (!row) return;
      if (typeof row.firstAttempt === 'number' && row.firstAttempt < now - 23 * 3600000) {
        this.store.db
          .prepare(
            "UPDATE mail_outbox SET status='uncertain',error='IDEMPOTENCY_WINDOW_EXPIRED' WHERE id=?",
          )
          .run(row.id!);
        return;
      }
      const lease = randomUUID();
      this.store.db
        .prepare(
          "UPDATE mail_outbox SET status='sending',attempts=attempts+1,firstAttempt=COALESCE(firstAttempt,?),lockedUntil=?,providerId=? WHERE id=?",
        )
        .run(now, now + 60000, lease, row.id!);
      return this.get(String(row.id));
    });
  }
  finish(
    job: MailJob,
    status: MailStatus,
    error: string | null,
    providerId: string | null,
    nextAttempt = 0,
  ) {
    return this.store.transaction(() => {
      const result = this.store.db
        .prepare(
          "UPDATE mail_outbox SET status=?,error=?,providerId=?,nextAttempt=?,lockedUntil=0 WHERE id=? AND status='sending' AND providerId=?",
        )
        .run(status, error, providerId, nextAttempt, job.id, job.providerId);
      if (result.changes)
        this.store.record('mail-service', 'mail.' + status, {
          id: job.id,
          orderId: job.orderId,
          attempts: job.attempts,
          error,
        });
    });
  }
  retry(id: string, now: number, actorId: string) {
    return this.store.transaction(() => {
      const job = this.get(id);
      if (!job) fail(404, 'MAIL_MISSING', 'Correo no encontrado.');
      if (!['failed'].includes(job.status))
        fail(409, 'MAIL_STATE', 'Este mensaje no admite reintento manual.');
      if (job.firstAttempt !== null && job.firstAttempt < now - 23 * 3600000)
        fail(
          409,
          'MAIL_REVIEW_REQUIRED',
          'Revisa el estado en el proveedor antes de reenviar; ha vencido la ventana de protección contra duplicados.',
        );
      this.store.db
        .prepare(
          "UPDATE mail_outbox SET status='pending',nextAttempt=?,error=NULL WHERE id=? AND status='failed'",
        )
        .run(now, id);
      this.store.record(actorId, 'mail.retry-requested', {
        id,
        orderId: job.orderId,
        previousStatus: 'failed',
      });
    });
  }

  eml(id: string, from: string) {
    const job = this.get(id);
    if (!job) fail(404, 'MAIL_MISSING', 'Correo no encontrado.');
    if (!validEmail(job.to) || !validEmail(from))
      fail(400, 'INVALID_RECIPIENT', 'Dirección de correo no válida.');
    const body =
      Buffer.from(job.text, 'utf8')
        .toString('base64')
        .match(/.{1,76}/g)
        ?.join('\r\n') ?? '';
    return [
      'From: ' + from,
      'To: ' + job.to,
      'Subject: =?UTF-8?B?' + Buffer.from(job.subject).toString('base64') + '?=',
      'Date: ' + new Date(job.createdAt).toUTCString(),
      'Message-ID: <' + job.id + '@changelab.local>',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      '' + body,
      '',
    ].join('\r\n');
  }
}
export class MailPump {
  private repo: MailOutbox;
  private transport: MailTransport;
  private now: () => number;
  private active = false;
  constructor(repo: MailOutbox, transport: MailTransport, now: () => number = Date.now) {
    this.repo = repo;
    this.transport = transport;
    this.now = now;
  }
  async run(limit = 10) {
    if (this.active) return;
    this.active = true;
    try {
      for (let i = 0; i < limit; i++) {
        const job = this.repo.claim(this.now());
        if (!job) break;
        if (this.transport.provider === 'preview' || job.previewOnly) {
          this.repo.finish(job, 'preview', null, null);
          continue;
        }
        if (
          !validEmail(job.to) ||
          /@(.*\.)?(invalid|example|test|localhost)$|@example\.(com|org|net)$/i.test(job.to)
        ) {
          this.repo.finish(job, 'blocked', 'RESERVED_OR_INVALID_RECIPIENT', null);
          continue;
        }
        try {
          const result = await this.transport.send(job);
          this.repo.finish(job, 'sent', null, result.id);
        } catch (e) {
          const retry = e instanceof MailFailure ? e.retryable : true;
          const code = e instanceof MailFailure ? e.message : 'PROVIDER_UNAVAILABLE';
          this.repo.finish(
            job,
            retry && job.attempts < 5 ? 'pending' : retry ? 'failed' : 'blocked',
            code,
            null,
            this.now() + Math.min(3600000, 60000 * 5 ** (job.attempts - 1)),
          );
        }
      }
    } finally {
      this.active = false;
    }
  }
}
