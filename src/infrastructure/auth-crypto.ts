import { scrypt, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { Credentials } from '../application/auth.ts';
const OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const derive = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, OPTIONS, (error, key) => (error ? reject(error) : resolve(key)));
  });
export const credentials: Credentials = {
  async hash(password) {
    const salt = randomBytes(16),
      key = await derive(password, salt);
    return 'scrypt$131072$8$1$' + salt.toString('hex') + '$' + key.toString('hex');
  },
  async verify(password, encoded) {
    const match = /^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded);
    const salt = Buffer.from(match?.[1] ?? '0'.repeat(32), 'hex');
    const expected = Buffer.from(match?.[2] ?? '0'.repeat(128), 'hex');
    const actual = await derive(password, salt);
    return timingSafeEqual(actual, expected) && Boolean(match);
  },
  token: () => randomBytes(32).toString('hex'),
  digest: (value) => createHash('sha256').update(value).digest('hex'),
};
