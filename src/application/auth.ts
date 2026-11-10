import { fail } from '../domain/catalog.ts';
import type { Actor } from './proposals.ts';

export const LOGIN_WINDOW_MS = 60_000;

export type Account = { actor: Actor; username: string; passwordHash: string; active: boolean };
export type Session = { actor: Actor; csrf: string; expiresAt: number };
export interface AuthRepository {
  count(): number;
  account(username: string): Account | undefined;
  add(account: Account): void;
  session(hash: string): Session | undefined;
  saveSession(hash: string, userId: string, csrf: string, expiresAt: number): void;
  removeSession(hash: string): void;
  hit(key: string, now: number): number;
}
export interface Credentials {
  hash(password: string): Promise<string>;
  verify(password: string, encoded: string): Promise<boolean>;
  token(): string;
  digest(value: string): string;
}
export class AuthService {
  private repo: AuthRepository;
  private credentials: Credentials;
  private now: () => number;
  private checking = false;
  constructor(repo: AuthRepository, credentials: Credentials, now: () => number = Date.now) {
    this.repo = repo;
    this.credentials = credentials;
    this.now = now;
  }
  hasAccounts() {
    return this.repo.count() > 0;
  }
  async createAccount(username: unknown, name: unknown, role: unknown, password: unknown) {
    if (
      typeof username !== 'string' ||
      !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(username) ||
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 80 ||
      typeof role !== 'string' ||
      !['editor', 'reviewer', 'viewer', 'warehouse', 'owner', 'office'].includes(role) ||
      typeof password !== 'string' ||
      password.length < 9 ||
      password.length > 128
    ) {
      fail(
        400,
        'INVALID_ACCOUNT',
        'Usa un usuario de 3–64 caracteres, nombre, rol válido y contraseña de 9–128 caracteres.',
      );
    }
    if (this.repo.account(username)) fail(409, 'ACCOUNT_EXISTS', 'Ese usuario ya existe.');
    const actor: Actor = {
      id: 'user_' + this.credentials.token(),
      name: name.trim(),
      role:
        role === 'warehouse'
          ? 'viewer'
          : ['owner', 'office'].includes(role)
            ? 'editor'
            : (role as Actor['role']),
      ...(['owner', 'office'].includes(role) ? { businessRole: role as 'owner' | 'office' } : {}),
      ...(role === 'warehouse' ? { profile: 'warehouse' as const } : {}),
      initials: name
        .trim()
        .split(/\s+/u)
        .slice(0, 2)
        .map((word) => word[0])
        .join('')
        .toUpperCase(),
    };
    const passwordHash = await this.credentials.hash(password);
    this.repo.add({ actor, username, passwordHash, active: true });
    return actor;
  }
  async login(username: unknown, password: unknown, remote: string) {
    if (
      typeof username !== 'string' ||
      username.length > 64 ||
      typeof password !== 'string' ||
      password.length > 128
    ) {
      fail(401, 'INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.');
    }
    if (this.checking) fail(429, 'LOGIN_BUSY', 'Hay un acceso en curso. Inténtalo de nuevo.');
    const normalized = username.trim().toLowerCase();
    const now = this.now();
    const userKey = this.credentials.digest('user:' + normalized);
    if (
      this.repo.hit(this.credentials.digest('ip:' + remote), now) > 20 ||
      this.repo.hit(userKey, now) > 5
    ) {
      fail(
        429,
        'LOGIN_LIMIT',
        'Demasiados intentos. Espera 1 minuto antes de volver a intentarlo.',
      );
    }
    this.checking = true;
    try {
      const account = this.repo.account(normalized);
      const valid = await this.credentials.verify(password, account?.passwordHash ?? '');
      if (!account || !valid || !account.active)
        fail(401, 'INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.');
      const token = this.credentials.token(),
        csrf = this.credentials.token(),
        expiresAt = now + 8 * 60 * 60 * 1000;
      this.repo.saveSession(this.credentials.digest(token), account.actor.id, csrf, expiresAt);
      return { token, actor: account.actor, csrf, expiresAt };
    } finally {
      this.checking = false;
    }
  }
  current(token: string | undefined): Session {
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      fail(401, 'LOGIN_REQUIRED', 'Inicia sesión para continuar.');
    const hash = this.credentials.digest(token),
      session = this.repo.session(hash);
    if (!session || session.expiresAt <= this.now()) {
      this.repo.removeSession(hash);
      fail(401, 'LOGIN_REQUIRED', 'La sesión ha caducado. Vuelve a iniciar sesión.');
    }
    return session;
  }
  logout(token: string) {
    this.repo.removeSession(this.credentials.digest(token));
  }
}
