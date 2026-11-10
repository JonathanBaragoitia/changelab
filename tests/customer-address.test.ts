import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/infrastructure/store.ts';
import { CustomerAccountStore } from '../src/infrastructure/customer-account-store.ts';
import { CustomerAccounts } from '../src/application/customer-accounts.ts';
import { credentials } from '../src/infrastructure/auth-crypto.ts';
import { CommerceStore } from '../src/infrastructure/commerce-store.ts';
import { Checkout } from '../src/application/commerce.ts';
import { randomUUID } from 'node:crypto';
test('direcciones separadas por cuenta y pedido conserva instantánea al cambiar dirección', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const repo = new CustomerAccountStore(store.db),
    service = new CustomerAccounts(repo, credentials);
  for (const id of ['one', 'two'])
    repo.add({
      id,
      email: id + '@example.com',
      name: 'Cliente ' + id,
      passwordHash: 'test-placeholder',
    });
  service.updateAddress('one', { address: 'Calle de Prueba 1' });
  assert.equal(service.profile('two')?.address, '');
  const commerce = new CommerceStore(store);
  const sale = new Checkout(commerce, randomUUID, () => new Date().toISOString()).customerCheckout(
    'one',
    {
      requestId: randomUUID(),
      lines: [{ productId: 'nc1', quantity: 1, expectedPriceCents: 7990 }],
      customer: {
        name: 'Cliente one',
        email: 'one@example.com',
        address: service.profile('one')!.address,
      },
    },
  );
  service.updateAddress('one', { address: 'Calle de Prueba 22' });
  assert.equal(commerce.sale(sale.id)?.customer?.address, 'Calle de Prueba 1');
  assert.equal(service.profile('one')?.address, 'Calle de Prueba 22');
  service.updateAddress('one', { address: '' });
  assert.equal(service.profile('one')?.address, '');
});
test('invitado, campos de otra cuenta y dirección inválida se rechazan', (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const repo = new CustomerAccountStore(store.db),
    service = new CustomerAccounts(repo, credentials);
  repo.add({
    id: 'one',
    email: 'one@example.com',
    name: 'Cliente',
    passwordHash: 'test-placeholder',
  });
  assert.throws(() => service.updateAddress('guest', { address: 'Calle de Prueba 1' }));
  for (const body of [
    { address: 'x' },
    { address: 'x'.repeat(301) },
    { address: 'Calle de Prueba 1', customerId: 'two' },
  ])
    assert.throws(() => service.updateAddress('one', body));
});
