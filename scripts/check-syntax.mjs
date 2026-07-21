import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOTS = ['bin', 'src', 'scripts', 'test'];
const EXTENSIONS = new Set(['.js', '.mjs']);

const files = ROOTS.flatMap((root) => walk(root)).sort();
let failed = 0;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) failed++;
}

if (failed > 0) {
  console.error(`语法检查失败：${failed} 个文件未通过。`);
  process.exit(1);
}

console.log(`语法检查通过：${files.length} 个文件。`);

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out = [];
  for (const ent of entries) {
    const file = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(file));
    else if (ent.isFile() && EXTENSIONS.has(path.extname(ent.name))) out.push(file);
  }
  return out;
}
