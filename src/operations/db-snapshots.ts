import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
export async function fileDigest(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
function verifyDatabase(path: string) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const result = database.prepare('PRAGMA quick_check').all();
    if (result.length !== 1 || Object.values(result[0]!)[0] !== 'ok')
      throw Error('La copia no supera la comprobación de integridad SQLite.');
    if (database.prepare('PRAGMA foreign_key_check').all().length)
      throw Error('La copia tiene referencias SQLite inconsistentes.');
  } finally {
    database.close();
  }
}
export async function createSnapshot(sourcePath: string, targetDirectory: string) {
  const source = resolve(sourcePath),
    directory = resolve(targetDirectory);
  if (!statSync(source).isFile()) throw Error('La base de origen no es un archivo.');
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    // Exclusive directory creation prevents the backup API overwriting an existing file.
    mkdirSync(directory);
    writeFileSync(
      join(directory, 'manifest.json'),
      JSON.stringify({ format: 'changelab-sqlite-v1', status: 'incomplete' }, null, 2),
      { flag: 'wx' },
    );
    const path = join(directory, 'changelab.sqlite');
    await backup(db, path);
    verifyDatabase(path);
    const manifest = {
      format: 'changelab-sqlite-v1',
      status: 'complete',
      createdAt: new Date().toISOString(),
      node: process.version,
      sha256: await fileDigest(path),
      bytes: statSync(path).size,
    };
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return { path, manifest };
  } finally {
    db.close();
  }
}
export async function restoreSnapshot(sourceDirectory: string, targetDirectory: string) {
  const dir = resolve(sourceDirectory),
    path = join(dir, 'changelab.sqlite');
  const value: unknown = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Manifiesto no válido.');
  const manifest = value as Record<string, unknown>;
  if (
    manifest.format !== 'changelab-sqlite-v1' ||
    manifest.status !== 'complete' ||
    typeof manifest.sha256 !== 'string' ||
    manifest.sha256 !== (await fileDigest(path))
  )
    throw Error('La copia está incompleta o su hash no coincide.');
  verifyDatabase(path);
  return createSnapshot(path, targetDirectory);
}
