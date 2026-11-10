import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { documentText } from '../src/infrastructure/document-text.ts';
test('PDF limita procesos simultáneos y libera capacidad tras terminar o fallar', async () => {
  const body = {
    format: 'pdf',
    source: readFileSync(new URL('./fixtures/tariff-bruma.pdf', import.meta.url)).toString(
      'base64',
    ),
  };
  const pending = documentText(body);
  await assert.rejects(documentText(body), { code: 'PDF_BUSY' });
  assert.equal(
    await documentText({ format: 'text', source: 'Texto manual independiente' }),
    'Texto manual independiente',
  );
  assert.ok((await pending).includes('NA-001'));
  await assert.rejects(
    documentText({ format: 'pdf', source: Buffer.from('%PDF-invalid').toString('base64') }),
    { code: 'PDF_UNREADABLE' },
  );
  assert.ok((await documentText(body)).includes('NA-001'));
});
