import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { stdin, stdout } from 'node:process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './infrastructure/store.ts';
import { AuthStore } from './infrastructure/auth-store.ts';
import { credentials } from './infrastructure/auth-crypto.ts';
import { AuthService } from './application/auth.ts';

if (!stdin.isTTY) {
  console.error(
    'Ejecuta esta utilidad en una terminal interactiva. No pases contraseñas como argumentos.',
  );
  process.exitCode = 1;
} else {
  let hidden = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!hidden) stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: stdin, output, terminal: true });
  let store: Store | undefined;
  try {
    const username = (await rl.question('Usuario (minúsculas, sin espacios): '))
      .trim()
      .toLowerCase();
    const name = await rl.question('Nombre: ');
    const role = (
      await rl.question(
        'Rol (owner (dirección), office (oficina), warehouse (almacén), editor, reviewer o viewer): ',
      )
    ).trim();
    stdout.write('Contraseña (9–128 caracteres; escritura oculta): ');
    hidden = true;
    const password = await rl.question('');
    hidden = false;
    stdout.write('\n');
    stdout.write('Repite la contraseña: ');
    hidden = true;
    const confirmation = await rl.question('');
    hidden = false;
    stdout.write('\n');
    if (password !== confirmation) throw new Error('Las contraseñas no coinciden.');
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    store = new Store(process.env.CHANGELAB_DB ?? resolve(root, 'data', 'changelab.sqlite'));
    const auth = new AuthService(new AuthStore(store.db), credentials);
    const actor = await auth.createAccount(username, name, role, password);
    store.record('local-admin', 'account.created', {
      userId: actor.id,
      username,
      role: actor.role,
    });
    console.log(
      'Cuenta creada. Inicia sesión en Norte Gestión. Reparto empresarial: owner para Dirección, office para Oficina y warehouse para Almacén.',
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'No se pudo crear la cuenta.');
    process.exitCode = 1;
  } finally {
    hidden = false;
    rl.close();
    store?.close();
  }
}
