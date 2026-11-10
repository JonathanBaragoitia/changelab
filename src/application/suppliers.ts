import { fail } from '../domain/catalog.ts';
export type Supplier = {
  id: string;
  name: string;
  email: string;
  phone: string;
  active: number;
  version: number;
};
export interface SupplierRepository {
  transaction<T>(operation: () => T): T;
  suppliers(): Supplier[];
  saveSupplier(supplier: Supplier, expectedVersion?: number): void;
  record(actor: string, action: string, detail: unknown): void;
}
export class ManageSuppliers {
  private repository: SupplierRepository;
  private nextId: () => string;
  constructor(repository: SupplierRepository, nextId: () => string) {
    this.repository = repository;
    this.nextId = nextId;
  }
  execute(actor: { id: string; role: string }, id: string | undefined, input: unknown) {
    if (actor.role !== 'editor')
      fail(403, 'FORBIDDEN', 'Solo una cuenta editora puede gestionar proveedores.');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail(400, 'INVALID_SUPPLIER', 'Proveedor no válido.');
    const v = input as Record<string, unknown>;
    if (
      Object.keys(v).some(
        (key) => !['name', 'email', 'phone', 'active', 'expectedVersion'].includes(key),
      ) ||
      typeof v.name !== 'string' ||
      v.name.trim().length < 2 ||
      v.name.length > 120 ||
      typeof v.email !== 'string' ||
      v.email.length > 150 ||
      (v.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) ||
      typeof v.phone !== 'string' ||
      v.phone.length > 40 ||
      (v.phone !== '' && !/^[+\d ()-]{5,40}$/.test(v.phone)) ||
      typeof v.active !== 'boolean'
    )
      fail(400, 'INVALID_SUPPLIER', 'Revisa nombre y datos de contacto.');
    return this.repository.transaction(() => {
      const current = id ? this.repository.suppliers().find((s) => s.id === id) : undefined;
      if (id && !current) fail(404, 'SUPPLIER_NOT_FOUND', 'Proveedor no encontrado.');
      if (current && current.version !== v.expectedVersion)
        fail(409, 'SUPPLIER_CHANGED', 'La ficha ha cambiado. Actualiza antes de editar.');
      if (
        this.repository
          .suppliers()
          .some(
            (s) =>
              s.id !== id &&
              s.name.trim().toLowerCase() === (v.name as string).trim().toLowerCase(),
          )
      )
        fail(409, 'SUPPLIER_EXISTS', 'Ya existe un proveedor con ese nombre, incluso archivado.');
      const supplier = {
        id: current?.id ?? this.nextId(),
        name: (v.name as string).trim(),
        email: (v.email as string).trim(),
        phone: (v.phone as string).trim(),
        active: v.active ? 1 : 0,
        version: (current?.version ?? 0) + 1,
      };
      this.repository.saveSupplier(supplier, current?.version);
      this.repository.record(actor.id, current ? 'supplier.updated' : 'supplier.created', {
        id: supplier.id,
        name: supplier.name,
        active: supplier.active,
        version: supplier.version,
      });
      return supplier;
    });
  }
}
