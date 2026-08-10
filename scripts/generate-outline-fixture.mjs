import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(
  new URL('../tests/fixtures/pdf-corpus/nested-outline.pdf', import.meta.url),
);

const objects = [
  '<< /Type /Catalog /Pages 2 0 R /Outlines 11 0 R /PageMode /UseOutlines >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R 9 0 R] /Count 4 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>',
  '<< /Length 0 >>\nstream\n\nendstream',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 6 0 R >>',
  '<< /Length 0 >>\nstream\n\nendstream',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 8 0 R >>',
  '<< /Length 0 >>\nstream\n\nendstream',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 10 0 R >>',
  '<< /Length 0 >>\nstream\n\nendstream',
  '<< /Type /Outlines /First 12 0 R /Last 18 0 R /Count 3 >>',
  '<< /Title (Introduction) /Parent 11 0 R /Next 13 0 R /Dest [3 0 R /Fit] >>',
  '<< /Title (Part One) /Parent 11 0 R /Prev 12 0 R /Next 18 0 R /First 14 0 R /Last 14 0 R /Count -4 /Dest [5 0 R /Fit] >>',
  '<< /Title (Chapter One) /Parent 13 0 R /First 15 0 R /Last 15 0 R /Count -3 /Dest [5 0 R /Fit] >>',
  '<< /Title (Section One) /Parent 14 0 R /First 16 0 R /Last 16 0 R /Count -2 /Dest [5 0 R /Fit] >>',
  '<< /Title (Deep Topic) /Parent 15 0 R /First 17 0 R /Last 17 0 R /Count -1 /Dest [7 0 R /Fit] >>',
  '<< /Title (Deep Detail) /Parent 16 0 R /Dest [7 0 R /Fit] >>',
  '<< /Title (Appendix) /Parent 11 0 R /Prev 13 0 R /Dest [9 0 R /Fit] >>',
  '<< /Producer (PDF Editor outline regression fixture) >>',
];

let pdf = '%PDF-1.7\n';
const offsets = [0];
for (const [index, object] of objects.entries()) {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
}
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += '0000000000 65535 f \n';
for (const offset of offsets.slice(1)) {
  pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 19 0 R >>\n`;
pdf += `startxref\n${xref}\n%%EOF\n`;

writeFileSync(output, pdf);
