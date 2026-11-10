import type { Product, Change, Proposal } from '../domain/catalog.ts';
export interface ChangeRepository {
  products(): Product[];
  proposal(id: string): Proposal | undefined;
  save(value: Proposal): void;
  record(actor: string, action: string, detail: unknown): void;
  updatePrice(change: Change): boolean;
  transaction<T>(operation: () => T): T;
}
export interface Digest {
  hash(value: unknown): string;
}
export interface Clock {
  now(): string;
}
export interface Ids {
  next(): string;
}
