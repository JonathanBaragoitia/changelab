import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from './infrastructure/store.ts';
import { MailOutbox, MailPump } from './infrastructure/mail-outbox.ts';
import { mailConfiguration } from './infrastructure/mail-transport.ts';
const database = process.env.CHANGELAB_DB ?? resolve('data/changelab.sqlite');
if (!existsSync(database)) throw Error('No existe la base de datos de correo configurada.');
const store = new Store(database);
const config = mailConfiguration();
const pump = new MailPump(new MailOutbox(store, config.portal), config.transport);
let stop = false;
let wake: (() => void) | undefined;
const shutdown = () => {
  stop = true;
  wake?.();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
console.log(config.message);
try {
  do {
    await pump.run();
    if (process.argv.includes('--once') || stop) break;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 10000);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  } while (!stop);
} finally {
  store.close();
}
