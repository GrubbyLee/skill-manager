import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX_FILES = 20000;

export function buildPackageManifest(dir, { maxFiles = DEFAULT_MAX_FILES } = {}) {
  const root = path.resolve(dir);
  const files = [];
  let totalBytes = 0;

  walk(root, '', files, maxFiles, (entry) => {
    totalBytes += entry.size || 0;
  });
  files.sort((a, b) => a.path.localeCompare(b.path));

  const digest = crypto.createHash('sha256');
  for (const entry of files) {
    digest.update(JSON.stringify(entry));
    digest.update('\n');
  }
  return {
    algorithm: 'sha256',
    hash: digest.digest('hex'),
    fileCount: files.filter((entry) => entry.type === 'file').length,
    totalBytes,
    files,
  };
}

export function diffPackageManifests(before, after) {
  const oldMap = new Map((before?.files || []).map((entry) => [entry.path, entry]));
  const newMap = new Map((after?.files || []).map((entry) => [entry.path, entry]));
  const added = [];
  const removed = [];
  const changed = [];

  for (const [file, entry] of newMap) {
    const previous = oldMap.get(file);
    if (!previous) added.push(file);
    else if (JSON.stringify(previous) !== JSON.stringify(entry)) changed.push(file);
  }
  for (const file of oldMap.keys()) {
    if (!newMap.has(file)) removed.push(file);
  }
  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
    same: added.length === 0 && removed.length === 0 && changed.length === 0,
  };
}

export function packageHash(dir) {
  return buildPackageManifest(dir).hash;
}

export function installationId(skill) {
  const location = skill.realPath || skill.path
    ? path.resolve(skill.realPath || skill.path)
    : `${skill.tool || 'unknown'}:${skill.scope || 'unknown'}:${skill.dirName || skill.name || 'unknown'}`;
  const locationHash = crypto.createHash('sha256').update(location).digest('hex').slice(0, 12);
  return [skill.tool || 'unknown', skill.scope || 'unknown', skill.dirName || skill.name || 'unknown', locationHash].join(':');
}

export function validateSkillPackage(dir) {
  const root = path.resolve(dir);
  const skillMd = path.join(root, 'SKILL.md');
  const stat = safeStat(skillMd);
  if (!stat?.isFile()) throw new Error(`SKILL.md not found in package: ${dir}`);
  validateSymlinks(root, '');
  return skillMd;
}

function validateSymlinks(root, relative) {
  const current = path.join(root, relative);
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (!relative && entry.name === '.git') continue;
    const rel = path.join(relative, entry.name);
    const full = path.join(root, rel);
    if (entry.isDirectory()) {
      validateSymlinks(root, rel);
      continue;
    }
    if (!entry.isSymbolicLink()) continue;
    const target = fs.readlinkSync(full);
    const resolved = path.resolve(path.dirname(full), target);
    if (path.isAbsolute(target) || (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))) {
      throw new Error(`skill package symlink escapes package: ${rel.split(path.sep).join('/')} -> ${target}`);
    }
  }
}

function walk(root, relative, files, maxFiles, onEntry) {
  const current = path.join(root, relative);
  const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (!relative && entry.name === '.git') continue;
    if (files.length >= maxFiles) throw new Error(`skill package exceeds ${maxFiles} entries: ${root}`);
    const rel = path.join(relative, entry.name);
    const normalized = rel.split(path.sep).join('/');
    const full = path.join(root, rel);
    const stat = fs.lstatSync(full);
    const mode = stat.mode & 0o777;
    if (entry.isDirectory()) {
      files.push({ path: normalized, type: 'directory', mode, size: 0 });
      onEntry(files.at(-1));
      walk(root, rel, files, maxFiles, onEntry);
    } else if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(full);
      files.push({ path: normalized, type: 'symlink', mode, size: Buffer.byteLength(target), target });
      onEntry(files.at(-1));
    } else if (entry.isFile()) {
      files.push({ path: normalized, type: 'file', mode, size: stat.size, hash: hashFile(full) });
      onEntry(files.at(-1));
    }
  }
}

function hashFile(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(256 * 1024);
  try {
    let bytes;
    do {
      bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytes) hash.update(buffer.subarray(0, bytes));
    } while (bytes);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function safeStat(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}
