import { fail } from '../domain/catalog.ts';
import { parseTariffCsv } from '../domain/tariff-csv.ts';
import { validateExtracted } from './document-imports.ts';
/** Strict tables first; ambiguous layouts require a model proposal and human review. */
export async function extractTariffRows(
  source: string,
  extractAI?: (source: string) => Promise<unknown>,
) {
  if (/^\s*sku\s*[;,]\s*coste\s*$/im.test(source.split('\n')[0] ?? ''))
    return { rows: parseTariffCsv(source), modelUsed: false };
  try {
    return { rows: parseTariffCsv(source), modelUsed: false };
  } catch {
    /* Not a strict CSV. */
  }
  const matches = [
    ...source.matchAll(/^([-A-Za-z0-9_]{2,40})\s*;\s*(\d{1,7}(?:[.,]\d{1,2})?)\s*(?:EUR|€)?\s*$/gm),
  ];
  const candidates = source
    .split(/\r?\n/)
    .filter((line) => /^[-A-Za-z0-9_]{2,40}\s*;/.test(line) && !/^sku\s*;/i.test(line));
  const compactTable = matches.length > 0 || /^\s*sku\s*;\s*coste\s*$/im.test(source);
  if (compactTable && candidates.length !== matches.length)
    fail(
      422,
      'TARIFF_AMBIGUOUS',
      'Alguna fila de precios no es válida. No se ha importado ninguna; revisa el documento.',
    );
  if (matches.length && /sin\s+iva|netos?|sku\s*;\s*coste/i.test(source)) {
    const rows = parseTariffCsv('sku;coste\n' + matches.map((m) => m[1] + ';' + m[2]).join('\n'));
    return { rows, modelUsed: false };
  }
  if (!extractAI)
    fail(
      422,
      'TARIFF_LAYOUT',
      'No se reconoce la tabla. Usa el CSV de ejemplo o activa la extracción asistida y revisa el resultado.',
    );
  const rows = validateExtracted(await extractAI(source), source);
  if (!rows.length || rows.some((row) => row.costCents === null))
    fail(
      422,
      'TARIFF_AMBIGUOUS',
      'Hay precios ambiguos. Usa costes unitarios sin IVA y revisa el documento.',
    );
  return {
    rows: parseTariffCsv(
      'sku;coste\n' +
        rows.map((row) => row.sku + ';' + (row.costCents! / 100).toFixed(2)).join('\n'),
    ),
    modelUsed: true,
  };
}
