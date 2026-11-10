import { fail } from './catalog.ts';
export function parseTariffCsv(input: unknown) {
  if (typeof input !== 'string' || !input.trim() || input.length > 12000)
    fail(400, 'INVALID_CSV', 'CSV vacío o demasiado grande (máximo 12.000 caracteres).');
  const csv = input.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  const first = csv.split('\n')[0]!,
    delimiter = first.includes(';') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false;
  for (let i = 0; i <= csv.length; i++) {
    const ch = i === csv.length ? '\n' : csv[i]!;
    if (quoted) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        if (i === csv.length) fail(400, 'INVALID_CSV', 'Comillas sin cerrar.');
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (cell || closed) fail(400, 'INVALID_CSV', 'Comillas fuera de posición.');
      quoted = true;
    } else if (ch === delimiter || ch === '\n') {
      row.push(cell.trim());
      cell = '';
      closed = false;
      if (ch === '\n') {
        if (row.some((v) => v)) rows.push(row);
        row = [];
      }
    } else {
      if (closed && ch.trim()) fail(400, 'INVALID_CSV', 'Texto después de comillas.');
      cell += ch;
    }
  }
  if (
    rows.length < 2 ||
    rows.length > 101 ||
    rows[0]!.map((x) => x.toLowerCase()).join(',') !== 'sku,coste'
  )
    fail(400, 'INVALID_CSV', 'Cabecera esperada: sku;coste. Entre 1 y 100 artículos.');
  const seen = new Set<string>();
  return rows.slice(1).map((values, index) => {
    const sku = values[0] ?? '',
      raw = values[1] ?? '';
    if (
      values.length !== 2 ||
      !/^[-A-Za-z0-9_]{2,40}$/.test(sku) ||
      seen.has(sku.toUpperCase()) ||
      !/^\d{1,7}([.,]\d{1,2})?$/.test(raw)
    )
      fail(
        400,
        'INVALID_CSV',
        'Revisa SKU, duplicados e importe de la fila ' +
          (index + 2) +
          '. Usa decimales sin separador de miles.',
      );
    seen.add(sku.toUpperCase());
    const parts = raw.replace(',', '.').split('.'),
      costCents = Number(parts[0]) * 100 + Number((parts[1] ?? '').padEnd(2, '0'));
    if (!Number.isSafeInteger(costCents) || costCents < 1 || costCents > 100000000)
      fail(400, 'INVALID_CSV', 'Coste fuera de rango en fila ' + (index + 2) + '.');
    return { sku: sku.toUpperCase(), costCents };
  });
}
