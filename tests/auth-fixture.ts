import assert from 'node:assert/strict';
import { actors } from '../src/application/proposals.ts';
import { AuthStore } from '../src/infrastructure/auth-store.ts';
import { credentials } from '../src/infrastructure/auth-crypto.ts';
import type { Store } from '../src/infrastructure/store.ts';

/** Pre-existing authenticated sessions for business API tests. Login itself is tested separately. */
export function sessions(store: Store, origin: string) {
  const repo = new AuthStore(store.db),
    headers = new Map<string, Record<string, string>>();
  for (const actor of actors) {
    repo.add({
      actor,
      username: actor.id,
      passwordHash: 'fixture-not-valid-for-login',
      active: true,
    });
    const token = credentials.token(),
      csrf = credentials.token();
    repo.saveSession(credentials.digest(token), actor.id, csrf, Date.now() + 60000);
    headers.set(actor.id, {
      'Content-Type': 'application/json',
      Cookie: 'changelab_session=' + token,
      'X-CSRF-Token': csrf,
      Origin: origin,
    });
  }
  return (id: string) => {
    const value = headers.get(id);
    assert.ok(value);
    return value;
  };
}
