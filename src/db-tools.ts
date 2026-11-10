import { mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createSnapshot, restoreSnapshot } from './operations/db-snapshots.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'backup' && args.length <= 1) {
    const source = process.env.CHANGELAB_DB ?? join(root, 'data', 'changelab.sqlite');
    if (!existsSync(source))
      throw Error('No existe la base de origen; no se creará una base vacía.');
    const parent = join(root, 'data', 'backups');
    mkdirSync(parent, { recursive: true });
    const target =
      args[0] ??
      join(parent, new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8));
    const result = await createSnapshot(source, target);
    console.log('Copia local verificada: ' + result.path);
  } else if (command === 'restore' && args.length === 2) {
    const result = await restoreSnapshot(args[0]!, args[1]!);
    console.log(
      'Restauración en base nueva: ' +
        result.path +
        '\nLa aplicación actual conserva su configuración. No se ha sustituido la base activa.',
    );
  } else
    throw Error(
      'Uso: db:backup [carpeta nueva] o db:restore <carpeta de copia> <carpeta nueva de destino>.',
    );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'No se pudo completar la operación.');
  process.exitCode = 1;
}
