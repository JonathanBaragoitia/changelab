import { needsOwnerDecision, type CompanyActor } from './company-roles.ts';
import { fail } from '../domain/catalog.ts';
export const categories = [
  'Lavado exterior',
  'Interior',
  'Llantas y neumáticos',
  'Cristales',
  'Protección de pintura',
  'Accesorios de limpieza',
];
export type CatalogRecord = {
  id: string;
  sku: string;
  name: string;
  category: string;
  description: string;
  active: number;
  version: number;
  priceCents: number;
  costCents: number;
};
export interface CatalogRepository {
  transaction<T>(operation: () => T): T;
  records(): CatalogRecord[];
  createProduct(product: CatalogRecord): void;
  editProduct(product: CatalogRecord, expectedVersion: number): void;
  record(actor: string, action: string, detail: unknown): void;
}
function metadata(v: Record<string, unknown>) {
  if (
    typeof v.name !== 'string' ||
    v.name.trim().length < 3 ||
    v.name.length > 160 ||
    !categories.includes(v.category as string) ||
    typeof v.description !== 'string' ||
    v.description.trim().length < 10 ||
    v.description.length > 2000
  )
    fail(400, 'INVALID_PRODUCT', 'Revisa nombre, categoría y descripción (10–2.000 caracteres).');
  return { name: v.name.trim(), category: v.category as string, description: v.description.trim() };
}
export class ManageCatalog {
  private repository: CatalogRepository;
  private nextId: () => string;
  constructor(repository: CatalogRepository, nextId: () => string) {
    this.repository = repository;
    this.nextId = nextId;
  }
  execute(actor: CompanyActor, id: string | undefined, input: unknown) {
    if (actor.role !== 'editor')
      fail(403, 'FORBIDDEN', 'Solo una cuenta editora puede gestionar artículos.');
    if (needsOwnerDecision(actor))
      fail(
        403,
        'OWNER_APPROVAL_REQUIRED',
        'La creación, activación y cambios del catálogo los decide Antonio. Prepara una propuesta de precios para su revisión.',
      );
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail(400, 'INVALID_PRODUCT', 'Artículo no válido.');
    const v = input as Record<string, unknown>,
      meta = metadata(v);
    const allowed = id
      ? ['name', 'category', 'description', 'active', 'expectedVersion']
      : ['sku', 'name', 'category', 'description', 'priceCents', 'costCents'];
    if (Object.keys(v).some((key) => !allowed.includes(key)))
      fail(
        400,
        'INVALID_PRODUCT',
        'Campos no permitidos. Los precios existentes se cambian desde Norte Gestión.',
      );
    return this.repository.transaction(() => {
      if (id) {
        const current = this.repository.records().find((p) => p.id === id);
        if (!current) fail(404, 'PRODUCT_NOT_FOUND', 'Artículo no encontrado.');
        if (
          typeof v.active !== 'boolean' ||
          !Number.isSafeInteger(v.expectedVersion) ||
          current.version !== v.expectedVersion
        )
          fail(409, 'PRODUCT_CHANGED', 'El artículo ha cambiado. Actualiza antes de editar.');
        const next = {
          ...current,
          ...meta,
          active: v.active ? 1 : 0,
          version: current.version + 1,
        };
        this.repository.editProduct(next, current.version);
        this.repository.record(actor.id, 'catalog.product-edited', {
          id,
          name: next.name,
          active: next.active,
          beforeVersion: current.version,
          afterVersion: next.version,
        });
        return next;
      }
      if (
        typeof v.sku !== 'string' ||
        !/^[A-Z0-9-]{3,30}$/.test(v.sku) ||
        !Number.isSafeInteger(v.priceCents) ||
        !Number.isSafeInteger(v.costCents) ||
        (v.priceCents as number) < 1 ||
        (v.priceCents as number) > 100000000 ||
        (v.costCents as number) < 1 ||
        (v.costCents as number) * 100 > (v.priceCents as number) * 80
      )
        fail(400, 'INVALID_PRODUCT', 'Revisa SKU único, importes y margen mínimo del 20 %.');
      if (this.repository.records().some((p) => p.sku === v.sku))
        fail(409, 'SKU_EXISTS', 'El SKU ya existe, incluso si está archivado.');
      const product = {
        ...meta,
        id: this.nextId(),
        sku: v.sku,
        priceCents: v.priceCents as number,
        costCents: v.costCents as number,
        active: 1,
        version: 1,
      };
      this.repository.createProduct(product);
      this.repository.record(actor.id, 'catalog.product-created', {
        id: product.id,
        sku: product.sku,
        name: product.name,
        stock: 0,
      });
      return product;
    });
  }
}
