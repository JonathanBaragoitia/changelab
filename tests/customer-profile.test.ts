import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/infrastructure/store.ts';
import { CustomerAccountStore } from '../src/infrastructure/customer-account-store.ts';
import { CustomerAccounts } from '../src/application/customer-accounts.ts';
import { credentials } from '../src/infrastructure/auth-crypto.ts';

test('editar cuenta requiere contraseña, impide correo duplicado y persiste credenciales nuevas', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const repo = new CustomerAccountStore(store.db);
  const service = new CustomerAccounts(repo, credentials);
  await service.execute(
    'register',
    'one',
    { name: 'Cliente Uno', email: 'one@example.com', password: 'original123' },
    'one',
  );
  await service.execute(
    'register',
    'two',
    { name: 'Cliente Dos', email: 'two@example.com', password: 'original123' },
    'two',
  );
  const payload = {
    name: 'Nuevo Nombre',
    email: 'nuevo@example.com',
    currentPassword: 'original123',
    newPassword: 'renovada123',
  };
  await assert.rejects(service.updateProfile('guest', payload));
  await assert.rejects(service.updateProfile('one', { ...payload, currentPassword: 'incorrecta' }));
  await assert.rejects(service.updateProfile('one', { ...payload, email: 'two@example.com' }));
  assert.equal(service.profile('one')?.email, 'one@example.com');
  await service.updateProfile('one', payload);
  assert.equal(service.profile('one')?.name, 'Nuevo Nombre');
  assert.equal(service.profile('two')?.email, 'two@example.com');
  await assert.rejects(
    service.execute('login', 'guest', { email: payload.email, password: 'original123' }, 'login'),
  );
  assert.equal(
    await service.execute(
      'login',
      'guest',
      { email: payload.email, password: 'renovada123' },
      'login',
    ),
    'one',
  );
});

test('cambio atómico: revoca sesiones propias y rechaza escrituras antiguas sin perder datos', async (t) => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const repo = new CustomerAccountStore(store.db);
  const service = new CustomerAccounts(repo, credentials);
  await service.execute(
    'register',
    'one',
    { name: 'Cliente Uno', email: 'one@example.com', password: 'original123' },
    'one',
  );
  const { CustomerSessions } = await import('../src/infrastructure/customer-sessions.ts');
  const sessions = new CustomerSessions(store.db);
  const own = sessions.create('one'),
    other = sessions.create('other');
  const original = repo.byId('one')!;
  repo.update({ ...original, name: 'Nombre actualizado' }, original);
  assert.equal(sessions.current(own.token), undefined);
  assert.ok(sessions.current(other.token));
  assert.throws(() => repo.update({ ...original, email: 'stale@example.com' }, original));
  assert.equal(repo.byId('one')?.name, 'Nombre actualizado');
  assert.equal(repo.byId('one')?.email, original.email);
  const valid = sessions.create('one');
  store.db.exec(
    "CREATE TRIGGER reject_profile BEFORE DELETE ON customer_sessions BEGIN SELECT RAISE(ABORT, 'simulated failure'); END",
  );
  const current = repo.byId('one')!;
  assert.throws(() => repo.update({ ...current, name: 'No guardar' }, current));
  assert.equal(repo.byId('one')?.name, 'Nombre actualizado');
  assert.ok(sessions.current(valid.token));
});
