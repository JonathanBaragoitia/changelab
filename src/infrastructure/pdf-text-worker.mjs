import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const loading = getDocument({
  data: new Uint8Array(Buffer.concat(chunks)),
  isEvalSupported: false,
  verbosity: 0,
  useSystemFonts: false,
  disableFontFace: true,
  stopAtErrors: true,
});
const pdf = await loading.promise;
let text = '';
try {
  if (pdf.numPages > 10) throw new Error('Maximum ten pages');
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i),
      content = await page.getTextContent();
    text += '\n[Página ' + i + ']\n';
    for (const item of content.items)
      if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
    if (text.length > 12000) throw new Error('Text limit');
    page.cleanup();
  }
  process.stdout.write(JSON.stringify({ text }));
} finally {
  await loading.destroy();
}
