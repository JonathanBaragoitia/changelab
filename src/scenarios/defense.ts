import { randomBytes } from 'node:crypto';
import { AuthService } from '../application/auth.ts';
import { credentials } from '../infrastructure/auth-crypto.ts';
import { AuthStore } from '../infrastructure/auth-store.ts';
import { Store } from '../infrastructure/store.ts';
import { makeServer } from '../server.ts';

const store = new Store(':memory:');
const auth = new AuthService(new AuthStore(store.db), credentials);
const accounts = [
  { username: 'demo-ana', name: 'Ana · Oficina', role: 'office' },
  { username: 'demo-antonio', name: 'Antonio · Dirección', role: 'owner' },
  { username: 'demo-mario', name: 'Mario · Almacén', role: 'warehouse' },
].map((account) => ({ ...account, password: randomBytes(12).toString('base64url') }));

try {
  for (const account of accounts)
    await auth.createAccount(account.username, account.name, account.role, account.password);
  // La demo puede arrancar desde un entorno con correo configurado. Aquí siempre se queda en vista previa.
  process.env.CHANGELAB_MAIL_PROVIDER = 'preview';
  process.env.CHANGELAB_MAIL_ENABLE_SEND = 'false';
  process.env.CHANGELAB_SCENARIO = 'DEMO TFM · DATOS FICTICIOS EN MEMORIA';
  const server = makeServer(store);
  server.once('error', (error) => {
    store.close();
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(4323, '127.0.0.1', () => {
    console.log('Demo TFM · http://127.0.0.1:4323/gestion');
    console.log('Cuentas temporales. Inicia sesión antes de mostrar la pantalla.');
    for (const account of accounts) console.log(account.username + '  ' + account.password);
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => server.close(() => store.close()));
} catch (error) {
  store.close();
  console.error(error instanceof Error ? error.message : 'No se pudo iniciar la demo.');
  process.exitCode = 1;
}
