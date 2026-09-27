import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(process.argv[2] || join(root, 'artifacts/live-task-cards-handoff.tar.gz'));
const temp = await mkdtemp(join(tmpdir(), 'live-card-handoff-'));
const stage = join(temp, 'live-task-cards');
const files = ['.env.example', '.gitignore', 'package.json', 'package-lock.json', 'index.mjs', 'server.mjs', 'vercel.json',
  'README.md', 'HANDOFF.md', 'INSTALL.md', 'DESIGN.md', 'SKILL.md',
  ...['API', 'INTEGRATION', 'ICONS', 'SECURITY', 'SOURCES', 'CUSTOM_LOADERS'].map(n => `docs/${n}.md`),
  ...['TEST_REPORT.md', 'HANDOFF_READINESS.md', 'unit-tests.tap', 'syntax-check.txt', 'build.txt', 'clean-install.txt'].map(n => `evidence/${n}`),
  ...['mini-card.css', 'square-animation.js', 'dot-matrix.js', 'mini-core.js', 'mini-card.js'].map(n => `grokbot-matrix/${n}`)];
async function collect(dir, allowed) {
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const name = `${dir}/${entry.name}`;
    if (entry.isDirectory()) { if (dir.startsWith('skills/dot-matrix-mini-app')) await collect(name, allowed); else if (dir === 'public' && entry.name === 'assets') await collect(name, n => /\.(png|jpg)$/.test(n)); }
    else if (allowed(entry.name)) files.push(name);
  }
}
try {
  for (const dir of ['src', 'bin', 'scripts']) await collect(dir, n => /\.(mjs|d\.ts)$/.test(n));
  await collect('public', n => /\.(mjs|css)$/.test(n));
  await collect('examples', n => /\.(json|mjs)$/.test(n));
  await collect('tests', n => n.endsWith('.test.mjs') || n === 'helpers.mjs' || n === 'custom-loader-browser.mjs');
  await collect('skills/dot-matrix-mini-app', n => /\.(md|yaml|py|html|css|js|mjs)$/.test(n));
  await collect('references', n => n.endsWith('.png'));
  const manifest = {};
  for (const file of [...new Set(files)].sort()) {
    const source = join(root, file);
    if (!(await lstat(source)).isFile()) throw Error(`Not a regular file: ${file}`);
    const bytes = await readFile(source);
    manifest[file] = createHash('sha256').update(bytes).digest('hex');
    await mkdir(join(stage, file, '..'), { recursive: true });
    await cp(source, join(stage, file));
  }
  const content = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(join(stage, 'MANIFEST.sha256.json'), content);
  await writeFile(join(root, 'MANIFEST.sha256.json'), content);
  await mkdir(join(output, '..'), { recursive: true });
  execFileSync('tar', ['-czf', output, '-C', temp, 'live-task-cards'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  const hash = createHash('sha256').update(await readFile(output)).digest('hex');
  await writeFile(`${output}.sha256`, `${hash}  ${output.split('/').at(-1)}\n`);
  console.log(JSON.stringify({ archive: output, files: Object.keys(manifest).length, sha256: hash }));
} finally { await rm(temp, { recursive: true, force: true }); }
