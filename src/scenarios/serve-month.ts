import { readFileSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../infrastructure/store.ts';
import { makeServer } from '../server.ts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const metadata = JSON.parse(
  readFileSync(resolve(root, 'data/scenarios/ultimo-mes.json'), 'utf8'),
) as { database: string };
const database = resolve(metadata.database),
  scenarioRoot = resolve(root, 'data/scenarios');
if (!database.startsWith(scenarioRoot + sep))
  throw Error('La base no pertenece a los escenarios aislados.');
process.env.CHANGELAB_SCENARIO = 'MES SIMULADO · OCTUBRE 2026 · DATOS SEPARADOS';
process.env.CHANGELAB_SCENARIO_FROM = '2026-10-01';
process.env.CHANGELAB_SCENARIO_TO = '2026-10-31';
process.env.CHANGELAB_MAIL_PROVIDER = 'preview';
process.env.CHANGELAB_MAIL_ENABLE_SEND = 'false';
const store = new Store(database);
const server = makeServer(store);
server.listen(4318, '127.0.0.1', () => console.log('Mes simulado: http://localhost:4318/gestion'));
server.on('error', (error) => {
  store.close();
  console.error(error.message);
  process.exitCode = 1;
});
