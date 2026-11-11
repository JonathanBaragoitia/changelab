import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  mkdtempSync,
  existsSync,
  unlinkSync,
  rmdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSnapshot, restoreSnapshot, fileDigest } from '../src/operations/db-snapshots.ts';
function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), 'changelab-snapshot-')),
    source = join(root, 'source.sqlite'),
    copy = join(root, 'copy'),
    restore = join(root, 'restored');
  const db = new DatabaseSync(source);
  t.after(() => {
    db.close();
    for (const base of [source, join(copy, 'changelab.sqlite'), join(restore, 'changelab.sqlite')])
      for (const f of [base, base + '-wal', base + '-shm', base + '-journal'])
        if (existsSync(f)) unlinkSync(f);
    for (const dir of [copy, restore]) {
      const manifest = join(dir, 'manifest.json');
      if (existsSync(manifest)) unlinkSync(manifest);
      if (existsSync(dir)) rmdirSync(dir);
    }
    rmdirSync(root);
  });
  db.exec(
    "CREATE TABLE records(id INTEGER PRIMARY KEY,value TEXT NOT NULL);INSERT INTO records VALUES(1,'original')",
  );
  return { root, source, copy, restore, db };
}
test('copia online y restauración en destino nuevo conservan datos; cambios posteriores no alteran snapshot', async (t) => {
  const { source, copy, restore, db } = fixture(t);
  db.exec('PRAGMA journal_mode=WAL');
  const saved = await createSnapshot(source, copy);
  assert.equal(saved.manifest.sha256, await fileDigest(saved.path));
  db.prepare('INSERT INTO records VALUES(?,?)').run(2, 'posterior');
  const recovered = await restoreSnapshot(copy, restore),
    check = new DatabaseSync(recovered.path, { readOnly: true });
  if (process.platform !== 'win32') {
    for (const directory of [copy, restore]) {
      assert.equal(statSync(directory).mode & 0o077, 0);
      assert.equal(statSync(join(directory, 'manifest.json')).mode & 0o077, 0);
      assert.equal(statSync(join(directory, 'changelab.sqlite')).mode & 0o077, 0);
    }
  }
  try {
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM records').get()!.n, 1);
    assert.equal(check.prepare('SELECT value FROM records').get()!.value, 'original');
  } finally {
    check.close();
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get()!.n, 2);
});
test('destino existente se rechaza sin sobrescribir archivos ni origen', async (t) => {
  const { source, copy, db } = fixture(t);
  mkdirSync(copy);
  writeFileSync(join(copy, 'manifest.json'), 'sentinel');
  await assert.rejects(createSnapshot(source, copy));
  assert.equal(readFileSync(join(copy, 'manifest.json'), 'utf8'), 'sentinel');
  assert.equal(db.prepare('SELECT value FROM records').get()!.value, 'original');
});
test('restauración rechaza hash alterado o manifiesto incompleto antes de crear destino', async (t) => {
  const { source, copy, restore } = fixture(t);
  const saved = await createSnapshot(source, copy);
  writeFileSync(
    join(copy, 'manifest.json'),
    JSON.stringify({ ...saved.manifest, sha256: 'wrong' }),
  );
  await assert.rejects(restoreSnapshot(copy, restore));
  assert.equal(existsSync(restore), false);
  writeFileSync(
    join(copy, 'manifest.json'),
    JSON.stringify({ ...saved.manifest, status: 'incomplete' }),
  );
  await assert.rejects(restoreSnapshot(copy, restore));
  assert.equal(existsSync(restore), false);
});
test('copia con referencias SQLite rotas queda incompleta y no se ofrece como válida', async (t) => {
  const { source, copy, db } = fixture(t);
  db.exec(
    'PRAGMA foreign_keys=OFF;CREATE TABLE children(id INTEGER,parent INTEGER REFERENCES records(id));INSERT INTO children VALUES(1,999)',
  );
  await assert.rejects(createSnapshot(source, copy));
  assert.equal(JSON.parse(readFileSync(join(copy, 'manifest.json'), 'utf8')).status, 'incomplete');
});
