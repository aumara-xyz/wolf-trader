import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const built = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', path.join(root, 'vite.config.ts')], { cwd: root, stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);
const files = [];
async function collect(dir) {
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true }).catch(() => [])) {
    if (['dist', 'node_modules', '.git', '__pycache__', '.venv', 'target'].includes(entry.name)) continue;
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) await collect(relative);
    else files.push(relative);
  }
}
for (const dir of ['apps/desk', 'apps/service', 'apps/macos', 'packages/wolf-ui', 'packages/wolf-core', 'packages/spatial-ui', 'packages/aukora', 'packages/aukora-vendor', 'packages/providers', 'packages/autonomy', 'packages/intelligence', 'packages/weekly', 'packages/authority', 'packages/runtime', 'packages/runtime-vendor', 'workers']) await collect(dir);
const digest = createHash('sha256');
for (const file of files.sort()) digest.update(file).update('\0').update(await readFile(path.join(root, file))).update('\0');
const sourceSha256 = digest.digest('hex');
const release = { app: 'Wolf Trader', capitalMode: 'DEMO', buildId: sourceSha256.slice(0, 16), sourceSha256, builtAt: new Date().toISOString(), sourceFiles: files.length };
await writeFile(path.join(root, 'apps/desk/dist/release.json'), JSON.stringify(release, null, 2) + '\n');
console.log(`Wolf Trader build ${release.buildId} (${files.length} source files)`);
