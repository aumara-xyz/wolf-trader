import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
if (process.platform !== 'darwin') throw new Error('The native Mac carrier requires macOS. Use npm run wolf:start elsewhere.');
if (!process.argv.includes('--skip-build')) {
  run(process.execPath, [path.join(root, 'scripts/build-runtime-vendor.mjs')]);
  run(process.execPath, [path.join(root, 'scripts/build-wolf.mjs')]);
}
const release = JSON.parse(await readFile(path.join(root, 'apps/desk/dist/release.json'), 'utf8'));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'aukora-wolf-install-'));
const bundle = path.join(temporary, 'Wolf Trader.app');
const contents = path.join(bundle, 'Contents');
const resources = path.join(contents, 'Resources');
await mkdir(path.join(contents, 'MacOS'), { recursive: true });
await mkdir(path.join(resources, 'app/apps/desk'), { recursive: true });
await mkdir(path.join(resources, 'app/packages'), { recursive: true });
for (const [from, to] of [
  ['apps/service', 'app/apps/service'],
  ['packages/wolf-core', 'app/packages/wolf-core'],
  ['packages/aukora', 'app/packages/aukora'],
  ['packages/aukora-vendor', 'app/packages/aukora-vendor'],
  ['packages/providers', 'app/packages/providers'],
  ['packages/autonomy', 'app/packages/autonomy'],
  ['packages/intelligence', 'app/packages/intelligence'],
  ['packages/weekly', 'app/packages/weekly'],
  ['packages/authority', 'app/packages/authority'],
  ['packages/runtime', 'app/packages/runtime'],
  ['packages/runtime-vendor', 'app/packages/runtime-vendor'],
  ['workers', 'app/workers'],
  ['apps/desk/dist', 'app/apps/desk/dist'],
]) await cp(path.join(root, from), path.join(resources, to), { recursive: true, filter: source => !source.endsWith('.test.mjs') && !source.split(path.sep).includes('__pycache__') && !source.endsWith('.pyc') });
await writeFile(path.join(resources, 'app/package.json'), JSON.stringify({ name: 'wolf-trader-installed', private: true, type: 'module' }) + '\n');
await writeFile(path.join(resources, 'release.json'), JSON.stringify(release, null, 2) + '\n');
await cp(path.join(root, 'packages/spatial-ui'), path.join(resources, 'notices/spatial-ui'), { recursive: true, filter: source => !/\.(tsx|css)$/.test(source) });
await writeFile(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Wolf Trader</string>
<key>CFBundleIdentifier</key><string>xyz.aukora.wolf.trader</string>
<key>CFBundleName</key><string>Wolf Trader</string>
<key>CFBundleDisplayName</key><string>Wolf Trader</string>
<key>CFBundleIconFile</key><string>Wolf.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.3.0</string>
<key>CFBundleVersion</key><string>${Date.now()}</string>
<key>NSHighResolutionCapable</key><true/>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>\n`);
run('/usr/bin/xcrun', ['swift', path.join(root, 'scripts/wolf-icon.swift'), path.join(resources, 'Wolf.icns')]);
run('/usr/bin/xcrun', ['swiftc', '-parse-as-library', path.join(root, 'apps/macos/WolfApp.swift'), '-o', path.join(contents, 'MacOS/Wolf Trader'), '-framework', 'AppKit', '-framework', 'WebKit', '-O']);
run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle]);
const destination = path.join(os.homedir(), 'Applications/Wolf Trader.app');
await mkdir(path.dirname(destination), { recursive: true });
const backup = destination + '.previous';
await rm(backup, { recursive: true, force: true });
try { await rename(destination, backup); } catch (error) { if (error.code !== 'ENOENT') throw error; }
try { await cp(bundle, destination, { recursive: true }); }
catch (error) { await rm(destination, { recursive: true, force: true }); await rename(backup, destination).catch(() => {}); throw error; }
await rm(temporary, { recursive: true, force: true });
console.log(`Installed ${destination}\nRelease ${release.buildId}\nRun: open '${destination}'`);
