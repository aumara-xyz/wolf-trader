import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'MANIFEST.json'), 'utf8'));
for (const file of manifest.files) {
  const bytes = readFileSync(join(root, 'x1', file.path));
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Vendor source changed: ' + file.path);
  if (file.path.startsWith('src/') && file.path.endsWith('.ts')) {
    const output = ts.transpileModule(bytes.toString(), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace(/(from\s+['"][^'"]+)\.ts(['"])/g, '$1.mjs$2');
    const target = join(root, 'x1', file.path.replace('.ts', '.mjs'));
    if (process.argv.includes('--check')) {
      if (readFileSync(target, 'utf8') !== output) throw new Error('Generated adapter drifted: ' + file.path);
    } else writeFileSync(target, output);
  }
}
console.log('Vendor source hashes and generated adapters verified.');
