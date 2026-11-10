import type { CashEntry } from '../application/cash.ts';
import type { CashReversal } from '../application/cash-reversal.ts';
import type { Refund } from '../application/refunds.ts';
import type { RefundReversal } from '../application/refund-reversal.ts';
import { validDate } from '../application/economics.ts';
function invalid(): never {
  throw new Error('Invalid stored cash record');
}
function object(serialized: unknown, keys: string[]) {
  if (typeof serialized !== 'string') return invalid();
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return invalid();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== [...keys].sort().join(',')) return invalid();
  return row;
}
const text = (v: unknown, max = 300) =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const amount = (v: unknown) =>
  Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= 100000000;
function identity(row: Record<string, unknown>, key: string, expected?: string) {
  if (
    !text(row[key], 80) ||
    !text(row.actorId, 200) ||
    (expected !== undefined && row[key] !== expected)
  )
    invalid();
}
export function readCashEntry(serialized: unknown, expected?: string): CashEntry {
  const row = object(serialized, [
    'requestId',
    'kind',
    'targetId',
    'amountCents',
    'date',
    'reference',
    'method',
    'actorId',
  ]);
  identity(row, 'requestId', expected);
  if (
    !['collection', 'payment'].includes(row.kind as string) ||
    !text(row.targetId, 200) ||
    !amount(row.amountCents) ||
    !validDate(row.date) ||
    !text(row.reference, 100) ||
    !['Transferencia', 'Tarjeta', 'Efectivo', 'Otro'].includes(row.method as string)
  )
    invalid();
  return row as CashEntry;
}
export function readRefund(serialized: unknown, expected?: string): Refund {
  const row = object(serialized, [
    'requestId',
    'orderId',
    'amountCents',
    'date',
    'reference',
    'reason',
    'actorId',
  ]);
  identity(row, 'requestId', expected);
  if (
    !text(row.orderId, 200) ||
    !amount(row.amountCents) ||
    !validDate(row.date) ||
    !text(row.reference, 100) ||
    !text(row.reason) ||
    String(row.reason).trim().length < 5
  )
    invalid();
  return row as Refund;
}
export function readCashReversal(serialized: unknown, expected?: string): CashReversal {
  const row = object(serialized, ['entryId', 'reason', 'actorId', 'at']);
  identity(row, 'entryId', expected);
  if (
    !text(row.reason, 500) ||
    String(row.reason).trim().length < 5 ||
    typeof row.at !== 'string' ||
    !Number.isFinite(Date.parse(row.at))
  )
    invalid();
  return row as CashReversal;
}
export function readRefundReversal(serialized: unknown, expected?: string): RefundReversal {
  const row = object(serialized, ['refundId', 'reason', 'actorId', 'at']);
  identity(row, 'refundId', expected);
  if (
    !text(row.reason) ||
    String(row.reason).trim().length < 5 ||
    typeof row.at !== 'string' ||
    !Number.isFinite(Date.parse(row.at))
  )
    invalid();
  return row as RefundReversal;
}
