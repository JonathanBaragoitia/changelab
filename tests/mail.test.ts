import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Store } from '../src/infrastructure/store.ts';
import { CommerceStore } from '../src/infrastructure/commerce-store.ts';
import { Checkout, customerView } from '../src/application/commerce.ts';
import { ManageOrder } from '../src/application/order-management.ts';
import {
  MailOutbox,
  MailPump,
  MailFailure,
  type MailTransport,
} from '../src/infrastructure/mail-outbox.ts';
import {
  PreviewMailTransport,
  ResendMailTransport,
  mailConfiguration,
} from '../src/infrastructure/mail-transport.ts';
import { makeServer } from '../src/server.ts';
import { sessions } from './auth-fixture.ts';
function setup(t: test.TestContext) {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const commerce = new CommerceStore(store),
    mail = new MailOutbox(store);
  commerce.setMailQueue((s, e) => {
    mail.queue(s, e);
  });
  const checkout = new Checkout(commerce, randomUUID, () => '2026-11-05T12:00:00Z');
  const buy = () =>
    checkout.customerCheckout('customer', {
      requestId: randomUUID(),
      customer: {
        name: 'Cliente de prueba',
        email: 'cliente@tiendapruebas.es',
        address: 'Dirección de ejemplo 123',
      },
      lines: [{ productId: 'nc1', quantity: 1, expectedPriceCents: 7990 }],
    });
  const manager = new ManageOrder(commerce, () => '2026-11-05T12:30:00Z');
  return { store, commerce, mail, buy, manager };
}
test('pedido y correo se guardan atómicamente, una vez por hito, y no se avisa enviado al tramitar', (t) => {
  const { commerce, mail, buy, manager } = setup(t);
  const sale = buy();
  assert.equal(mail.list().length, 1);
  assert.equal(mail.list()[0]!.event, 'confirmed');
  const actor = { id: 'staff', role: 'editor' };
  manager.execute(actor, sale.id, { status: 'prepared', expectedStatus: 'confirmed' });
  manager.execute(actor, sale.id, {
    status: 'dispatch_ready',
    expectedStatus: 'prepared',
    carrier: 'Transportista',
    reference: 'EXP-001',
    trackingUrl: 'https://transportista.es/track?ref=EXP-001',
  });
  assert.equal(mail.list().length, 1);
  manager.execute(actor, sale.id, { status: 'shipped', expectedStatus: 'prepared' });
  manager.execute(actor, sale.id, { status: 'shipped', expectedStatus: 'prepared' });
  assert.equal(mail.list().length, 2);
  assert.equal(mail.list()[0]!.event, 'shipped');
  assert.match(mail.list()[0]!.text, /Transportista/);
  assert.match(mail.list()[0]!.text, /EXP-001/);
  const visible = customerView(commerce.sale(sale.id)!);
  assert.equal(visible.shipping?.carrier, 'Transportista');
  assert.equal(visible.shipping?.pickedUpAt, '2026-11-05T12:30:00Z');
  assert.equal(visible.shipping?.estimatedDelivery?.from, '2026-11-09');
  assert.equal(visible.shipping?.estimatedDelivery?.to, '2026-11-11');
  assert.ok(!JSON.stringify(visible.shipping).includes('staff'));
  assert.ok(!JSON.stringify(visible).includes('costCents'));
});
test('un fallo al guardar el correo revierte pedido, stock y auditoría', (t) => {
  const { store, mail, buy } = setup(t);
  const before = store.audit().length;
  store.db.exec(
    "CREATE TRIGGER reject_mail BEFORE INSERT ON mail_outbox BEGIN SELECT RAISE(ABORT,'test mail failure'); END",
  );
  assert.throws(buy);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM sales').get()?.n, 0);
  assert.equal(
    store.db.prepare("SELECT quantity FROM inventory WHERE productId='nc1'").get()?.quantity,
    20,
  );
  assert.equal(mail.list().length, 0);
  assert.equal(store.audit().length, before);
});
test('sin proveedor los correos quedan en captura y una copia histórica nunca se convierte en envío real', async (t) => {
  const { mail, buy } = setup(t);
  buy();
  await new MailPump(mail, new PreviewMailTransport()).run();
  assert.equal(mail.list()[0]!.status, 'preview');
  const second = buy();
  mail.queue(second, 'shipped', true);
  let calls = 0;
  const transport: MailTransport = {
    provider: 'resend',
    async send() {
      calls++;
      return { id: 'provider' };
    },
  };
  await new MailPump(mail, transport).run();
  assert.equal(calls, 1);
  assert.equal(
    mail.list().find((j) => j.orderId === second.id && j.event === 'shipped')?.status,
    'preview',
  );
});
test('HTTP: un pedido confirmado en modo revisión no se envía tras habilitar un trabajador', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const previous = process.env.CHANGELAB_MAIL_PROVIDER;
  process.env.CHANGELAB_MAIL_PROVIDER = 'preview';
  let server: ReturnType<typeof makeServer>;
  try {
    server = makeServer(store);
  } finally {
    if (previous === undefined) delete process.env.CHANGELAB_MAIL_PROVIDER;
    else process.env.CHANGELAB_MAIL_PROVIDER = previous;
  }
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  const guest = await fetch(base + '/api/shop');
  const { csrf } = await guest.json();
  const order = await fetch(base + '/api/shop/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: base,
      Cookie: guest.headers.get('set-cookie')!.split(';')[0]!,
      'X-CSRF-Token': csrf,
    },
    body: JSON.stringify({
      requestId: randomUUID(),
      lines: [{ productId: 'nc1', quantity: 1, expectedPriceCents: 7990 }],
      customer: {
        name: 'Cliente de prueba',
        email: 'cliente@tiendapruebas.es',
        address: 'Dirección de ejemplo 123',
      },
    }),
  });
  assert.equal(order.status, 201);
  const { id } = await order.json();
  const outbox = new MailOutbox(store);
  assert.equal(outbox.list().find((job) => job.orderId === id)?.previewOnly, 1);
  let sends = 0;
  await new MailPump(outbox, {
    provider: 'resend',
    async send() {
      sends++;
      return { id: 'fake-provider-id' };
    },
  }).run();
  assert.equal(sends, 0);
  const message = outbox.list().find((job) => job.orderId === id);
  assert.equal(message?.status, 'preview');
  assert.equal(message?.attempts, 0);
});
test('reintentos con espera y misma clave de idempotencia; un aceptado no se reenvía', async (t) => {
  const { mail, buy } = setup(t);
  buy();
  let now = Date.parse('2026-11-05T12:00:00Z');
  const keys: string[] = [];
  const transport: MailTransport = {
    provider: 'resend',
    async send(job) {
      keys.push(job.id);
      if (keys.length === 1) throw new MailFailure('PROVIDER_HTTP_429', true);
      return { id: 'accepted' };
    },
  };
  const pump = new MailPump(mail, transport, () => now);
  await pump.run();
  assert.equal(mail.list()[0]!.status, 'pending');
  await pump.run();
  assert.equal(keys.length, 1);
  now += 60000;
  await pump.run();
  assert.equal(mail.list()[0]!.status, 'sent');
  assert.equal(keys[0], keys[1]);
  await pump.run();
  assert.equal(keys.length, 2);
});
test('dos procesos no reclaman simultáneamente el mismo correo', async (t) => {
  const { mail, buy } = setup(t);
  buy();
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  let calls = 0;
  const transport: MailTransport = {
    provider: 'resend',
    async send() {
      calls++;
      await wait;
      return { id: 'accepted' };
    },
  };
  const first = new MailPump(mail, transport).run();
  await new MailPump(mail, transport).run();
  assert.equal(calls, 1);
  release();
  await first;
  assert.equal(mail.list()[0]!.status, 'sent');
});
test('una entrega interrumpida fuera de la ventana de idempotencia queda para revisión, sin reenvío', async (t) => {
  const { mail, buy } = setup(t);
  buy();
  const start = Date.parse('2026-11-05T12:00:00Z');
  mail.claim(start);
  let calls = 0;
  await new MailPump(
    mail,
    {
      provider: 'resend',
      async send() {
        calls++;
        return { id: 'bad' };
      },
    },
    () => start + 24 * 3600000,
  ).run();
  assert.equal(calls, 0);
  assert.equal(mail.list()[0]!.status, 'uncertain');
});
test('destinatarios de ejemplo no salen a proveedores y configuración incompleta falla cerrada', async (t) => {
  const { mail, buy } = setup(t);
  const sale = buy();
  mail.queue(
    { ...sale, id: 'reserved', customer: { ...sale.customer!, email: 'qa@example.invalid' } },
    'shipped',
  );
  let calls = 0;
  await new MailPump(mail, {
    provider: 'resend',
    async send() {
      calls++;
      return { id: 'accepted' };
    },
  }).run();
  assert.equal(calls, 1);
  assert.equal(mail.list().find((j) => j.orderId === 'reserved')?.status, 'blocked');
  assert.equal(mailConfiguration({ CHANGELAB_MAIL_PROVIDER: 'resend' }).mode, 'preview');
  assert.equal(
    mailConfiguration({
      CHANGELAB_MAIL_PROVIDER: 'resend',
      CHANGELAB_MAIL_ENABLE_SEND: 'true',
      CHANGELAB_MAIL_API_KEY: 'test-key',
      CHANGELAB_SHOP_URL: 'https://localhost/mis-pedidos',
    }).mode,
    'preview',
  );
});
test('adaptador envía JSON al endpoint fijo con clave idempotente y no expone errores del proveedor', async (t) => {
  const { mail, buy } = setup(t);
  buy();
  const job = mail.list()[0]!;
  let observed = false;
  const request: typeof fetch = async (input, init) => {
    assert.equal(input, 'https://api.resend.com/emails');
    assert.equal(new Headers(init?.headers).get('Idempotency-Key'), job.id);
    assert.equal(init?.redirect, 'error');
    assert.equal(JSON.parse(String(init?.body)).to[0], job.to);
    observed = true;
    return new Response(JSON.stringify({ id: 'provider-id' }), { status: 200 });
  };
  const result = await new ResendMailTransport(
    'test-key',
    'pedidos@tiendapruebas.es',
    request,
  ).send(job);
  assert.equal(result.id, 'provider-id');
  assert.ok(observed);
  const bad: typeof fetch = async () => new Response('private provider response', { status: 400 });
  await assert.rejects(
    () => new ResendMailTransport('test-key', 'pedidos@tiendapruebas.es', bad).send(job),
    { message: 'PROVIDER_HTTP_400' },
  );
});
test('vista de envío rechaza enlaces peligrosos y no inventa datos en pedidos históricos', (t) => {
  const { buy, manager } = setup(t);
  const sale = buy();
  assert.equal(customerView(sale).shipping, null);
  manager.execute({ id: 'staff', role: 'editor' }, sale.id, {
    status: 'prepared',
    expectedStatus: 'confirmed',
  });
  for (const trackingUrl of [
    'javascript:alert(1)',
    'https://user:pass@example.com/',
    'https://127.0.0.1/',
  ])
    assert.throws(
      () =>
        manager.execute({ id: 'staff', role: 'editor' }, sale.id, {
          status: 'dispatch_ready',
          expectedStatus: 'prepared',
          carrier: 'Transportista',
          reference: 'REF',
          trackingUrl,
        }),
      { code: 'INVALID_TRACKING_URL' },
    );
});
test('HTTP: correos solo para oficina/dirección, EML descargable y un ID inexistente no rompe el servidor', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const server = makeServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port,
    staff = sessions(store, base);
  const commerce = new CommerceStore(store);
  const sale = new Checkout(commerce, randomUUID, () => new Date().toISOString()).customerCheckout(
    'customer',
    {
      requestId: randomUUID(),
      customer: { name: 'Cliente', email: 'qa@example.invalid', address: 'Dirección de prueba' },
      lines: [{ productId: 'nc1', quantity: 1, expectedPriceCents: 7990 }],
    },
  );
  const post = () =>
    fetch(base + '/api/mail/capture', {
      method: 'POST',
      headers: staff('elena'),
      body: JSON.stringify({ orderId: sale.id }),
    });
  assert.equal((await fetch(base + '/api/mail', { headers: staff('lucia') })).status, 403);
  assert.equal((await fetch(base + '/api/mail')).status, 401);
  const capture = await post();
  assert.equal(capture.status, 201);
  const { id } = await capture.json();
  store.db
    .prepare("UPDATE mail_outbox SET status='failed',firstAttempt=? WHERE id=?")
    .run(Date.now(), id);
  const retried = await fetch(base + '/api/mail/' + id + '/retry', {
    method: 'POST',
    headers: staff('elena'),
    body: '{}',
  });
  assert.equal(retried.status, 200);
  const retryEvent = store.audit().find((event) => event.action === 'mail.retry-requested');
  assert.ok(retryEvent);
  assert.equal(retryEvent.actor, 'elena');
  const eml = await fetch(base + '/api/mail/' + id + '/preview', { headers: staff('elena') });
  assert.equal(eml.status, 200);
  assert.match(await eml.text(), /MIME-Version: 1.0/);
  assert.equal(
    (await fetch(base + '/api/mail/' + '0'.repeat(64) + '/preview', { headers: staff('elena') }))
      .status,
    404,
  );
  assert.equal((await fetch(base + '/api/health')).status, 200);
});

test('reintento manual registra responsable y revierte si falla auditoría', (t) => {
  const { store, mail, buy } = setup(t);
  buy();
  const job = mail.list()[0]!;
  store.db
    .prepare("UPDATE mail_outbox SET status='failed',firstAttempt=? WHERE id=?")
    .run(1000, job.id);
  mail.retry(job.id, 2000, 'ana');
  assert.equal(mail.get(job.id)!.status, 'pending');
  const event = store.audit()[0]!;
  assert.equal(event.actor, 'ana');
  assert.equal(event.action, 'mail.retry-requested');
  assert.equal(store.verifyAudit(), true);
  store.db.prepare("UPDATE mail_outbox SET status='failed' WHERE id=?").run(job.id);
  store.db.exec(
    "CREATE TRIGGER reject_retry_audit BEFORE INSERT ON audit WHEN NEW.action='mail.retry-requested' BEGIN SELECT RAISE(ABORT, 'test'); END;",
  );
  assert.throws(() => mail.retry(job.id, 3000, 'antonio'));
  assert.equal(mail.get(job.id)!.status, 'failed');
});
