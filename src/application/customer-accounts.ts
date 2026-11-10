import { fail } from '../domain/catalog.ts';
import type { Credentials } from './auth.ts';
export type CustomerAccount = { id: string; email: string; name: string; passwordHash: string };
export interface CustomerAccountRepository {
  byEmail(email: string): CustomerAccount | undefined;
  byId(id: string): CustomerAccount | undefined;
  add(account: CustomerAccount): void;
  update(account: CustomerAccount, expected: CustomerAccount): void;
  attempt(key: string): boolean;
  address(id: string): string;
  saveAddress(id: string, address: string): void;
}
export class CustomerAccounts {
  private repository: CustomerAccountRepository;
  private credentials: Credentials;
  constructor(repository: CustomerAccountRepository, credentials: Credentials) {
    this.repository = repository;
    this.credentials = credentials;
  }
  profile(id: string) {
    const a = this.repository.byId(id);
    return a ? { name: a.name, email: a.email, address: this.repository.address(id) } : null;
  }

  updateAddress(id: string, input: unknown) {
    if (!this.repository.byId(id))
      fail(
        403,
        'CUSTOMER_ACCOUNT_REQUIRED',
        'Inicia sesión en una cuenta de cliente para guardar direcciones.',
      );
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail(400, 'INVALID_ADDRESS', 'Dirección no válida.');
    const value = input as Record<string, unknown>;
    if (
      Object.keys(value).some((key) => key !== 'address') ||
      typeof value.address !== 'string' ||
      value.address.length > 300 ||
      (value.address.trim().length > 0 && value.address.trim().length < 8)
    )
      fail(
        400,
        'INVALID_ADDRESS',
        'La dirección debe tener entre 8 y 300 caracteres, o estar vacía para quitarla.',
      );
    this.repository.saveAddress(id, value.address.trim());
    return this.profile(id);
  }
  async updateProfile(id: string, input: Record<string, unknown>) {
    const account = this.repository.byId(id);
    if (!account) fail(403, 'CUSTOMER_ACCOUNT_REQUIRED', 'Inicia sesión para editar tu cuenta.');
    if (!this.repository.attempt('profile:' + id))
      fail(429, 'CUSTOMER_RATE', 'Demasiados intentos. Espera un minuto.');
    if (
      Object.keys(input).some(
        (key) => !['name', 'email', 'currentPassword', 'newPassword'].includes(key),
      ) ||
      typeof input.name !== 'string' ||
      input.name.trim().length < 2 ||
      input.name.length > 100 ||
      typeof input.email !== 'string' ||
      input.email.length > 150 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
      typeof input.currentPassword !== 'string' ||
      input.currentPassword.length > 128 ||
      (input.newPassword !== undefined &&
        (typeof input.newPassword !== 'string' ||
          input.newPassword.length < 9 ||
          input.newPassword.length > 128))
    )
      fail(
        400,
        'INVALID_CUSTOMER_ACCOUNT',
        'Revisa nombre, correo y contraseña (9–128 caracteres).',
      );
    if (!(await this.credentials.verify(input.currentPassword, account.passwordHash)))
      fail(401, 'CUSTOMER_LOGIN', 'La contraseña actual no es correcta.');
    const email = input.email.trim().toLowerCase();
    const other = this.repository.byEmail(email);
    if (other && other.id !== id) fail(409, 'CUSTOMER_EXISTS', 'Ese correo ya está en uso.');
    this.repository.update(
      {
        ...account,
        name: input.name.trim(),
        email,
        passwordHash: input.newPassword
          ? await this.credentials.hash(input.newPassword as string)
          : account.passwordHash,
      },
      account,
    );
    return this.profile(id);
  }
  async execute(mode: 'register' | 'login', guestId: string, input: unknown, ip: string) {
    if (!this.repository.attempt(ip))
      fail(429, 'CUSTOMER_RATE', 'Demasiados intentos. Espera un minuto.');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail(400, 'INVALID_CUSTOMER_ACCOUNT', 'Datos no válidos.');
    const v = input as Record<string, unknown>;
    if (
      Object.keys(v).some(
        (key) =>
          !(mode === 'register' ? ['email', 'name', 'password'] : ['email', 'password']).includes(
            key,
          ),
      ) ||
      typeof v.email !== 'string' ||
      v.email.length > 150 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) ||
      typeof v.password !== 'string' ||
      v.password.length < 9 ||
      v.password.length > 128
    )
      fail(400, 'INVALID_CUSTOMER_ACCOUNT', 'Revisa correo y contraseña (9–128 caracteres).');
    const email = v.email.trim().toLowerCase();
    if (mode === 'login') {
      const account = this.repository.byEmail(email);
      const verified = await this.credentials.verify(v.password, account?.passwordHash ?? '');
      if (
        !account ||
        !verified ||
        this.repository.byId(account.id)?.passwordHash !== account.passwordHash
      )
        fail(401, 'CUSTOMER_LOGIN', 'Correo o contraseña incorrectos.');
      return account.id;
    }
    if (typeof v.name !== 'string' || v.name.trim().length < 2 || v.name.length > 100)
      fail(400, 'INVALID_CUSTOMER_ACCOUNT', 'Indica un nombre de 2–100 caracteres.');
    if (this.repository.byId(guestId) || this.repository.byEmail(email))
      fail(409, 'CUSTOMER_EXISTS', 'Ya existe una cuenta. Usa Iniciar sesión.');
    const account = {
      id: guestId,
      email,
      name: v.name.trim(),
      passwordHash: await this.credentials.hash(v.password),
    };
    this.repository.add(account);
    return account.id;
  }
}
