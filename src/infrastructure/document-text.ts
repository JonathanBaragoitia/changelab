import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fail } from '../domain/catalog.ts';
import { text } from '../application/operations.ts';
let pdfActive = false;
export async function documentText(body: Record<string, unknown>): Promise<string> {
  if (body.format === 'text') return text(body.source, 5, 12000);
  if (
    body.format !== 'pdf' ||
    typeof body.source !== 'string' ||
    body.source.length > 2800000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(body.source)
  )
    fail(
      400,
      'INVALID_DOCUMENT',
      'Usa texto de hasta 12.000 caracteres o PDF de hasta 2 MB y 10 páginas.',
    );
  const buffer = Buffer.from(body.source, 'base64');
  if (buffer.length > 2000000 || buffer.subarray(0, 5).toString() !== '%PDF-')
    fail(400, 'INVALID_PDF', 'Archivo PDF no válido o demasiado grande.');
  if (pdfActive)
    fail(429, 'PDF_BUSY', 'Ya se está leyendo un PDF. Espera a que termine y vuelve a intentarlo.');
  pdfActive = true;
  // Parsing untrusted PDFs runs in a bounded child process, outside the HTTP event loop.
  const result = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [
        '--max-old-space-size=192',
        fileURLToPath(new URL('./pdf-text-worker.mjs', import.meta.url)),
      ],
      { timeout: 15000, maxBuffer: 65536, windowsHide: true },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(buffer);
  })
    .catch(() =>
      fail(
        422,
        'PDF_UNREADABLE',
        'No se pudo extraer texto. Comprueba tamaño, páginas o contraseña. Los PDF escaneados requieren OCR externo y revisión.',
      ),
    )
    .finally(() => {
      pdfActive = false;
    });
  let source: unknown;
  try {
    source = JSON.parse(result).text;
  } catch {
    fail(422, 'PDF_UNREADABLE', 'El PDF no produjo texto válido.');
  }
  if (typeof source !== 'string' || source.trim().length < 5)
    fail(422, 'PDF_NO_TEXT', 'Este PDF no tiene texto utilizable. No hay OCR en esta versión.');
  return text(source, 5, 12000);
}
