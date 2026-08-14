import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPackageManifest, validateSkillPackage } from './skillPackage.js';

const FETCH_TIMEOUT_MS = 8000;

export async function acquireSkillSource(input, { fetchImpl = globalThis.fetch } = {}) {
  const descriptor = normalizeDescriptor(input);
  if (/^file:\/\//i.test(descriptor.url) && !/\/SKILL\.md(?:[?#].*)?$/i.test(descriptor.url)) {
    const root = path.resolve(fileURLToPath(descriptor.url));
    const dir = path.resolve(root, sanitizeSubdir(descriptor.subdir || ''));
    validateSkillPackage(dir);
    return directoryResult(dir, descriptor, () => {});
  }
  if (isLocalPath(descriptor.url)) {
    const dir = path.resolve(descriptor.url, sanitizeSubdir(descriptor.subdir || ''));
    validateSkillPackage(dir);
    return directoryResult(dir, descriptor, () => {});
  }

  const git = parseGitSource(descriptor);
  if (git) return cloneGitSource(git, descriptor);

  const skillMdUrl = directSkillMdUrl(descriptor.url);
  if (!skillMdUrl) throw new Error(`unsupported skill source: ${descriptor.url}`);
  const text = await fetchText(skillMdUrl, fetchImpl);
  return {
    kind: 'single-file',
    text,
    source: descriptor.url,
    resolvedSource: skillMdUrl,
    ref: descriptor.ref || null,
    subdir: descriptor.subdir || null,
    resolvedCommit: null,
    cleanup() {},
  };
}

export function prepareCandidate(payload, targetDir, copyDir) {
  const parent = path.dirname(targetDir);
  fs.mkdirSync(parent, { recursive: true });
  const stage = path.join(parent, `.skm-stage-${process.pid}-${Date.now()}-${randomSuffix()}`);
  try {
    if (payload.kind === 'directory') {
      copyDir(payload.sourceDir, stage);
    } else {
      if (fs.existsSync(targetDir)) copyDir(targetDir, stage);
      else fs.mkdirSync(stage, { recursive: true });
      fs.writeFileSync(path.join(stage, 'SKILL.md'), payload.text);
    }
    validateSkillPackage(stage);
    return { stage, manifest: buildPackageManifest(stage) };
  } catch (error) {
    removePreparedCandidate(stage);
    throw error;
  }
}

export function atomicReplaceDirectory(stage, targetDir) {
  const old = `${targetDir}.skm-old-${process.pid}-${Date.now()}-${randomSuffix()}`;
  let movedOld = false;
  try {
    if (fs.existsSync(targetDir)) {
      fs.renameSync(targetDir, old);
      movedOld = true;
    }
    fs.renameSync(stage, targetDir);
    if (movedOld) fs.rmSync(old, { recursive: true, force: true });
  } catch (error) {
    try {
      if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive: true, force: true });
      if (movedOld && fs.existsSync(old)) fs.renameSync(old, targetDir);
      if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
    } catch (restoreError) {
      error.restoreError = restoreError;
    }
    throw error;
  }
}

export function atomicReplaceDirectories(items) {
  const transactions = items.map(({ stage, targetDir }) => ({
    stage,
    targetDir,
    old: `${targetDir}.skm-old-${process.pid}-${Date.now()}-${randomSuffix()}`,
    movedOld: false,
    committed: false,
  }));
  try {
    for (const item of transactions) {
      if (fs.existsSync(item.targetDir)) {
        fs.renameSync(item.targetDir, item.old);
        item.movedOld = true;
      }
    }
    for (const item of transactions) {
      fs.renameSync(item.stage, item.targetDir);
      item.committed = true;
    }
  } catch (error) {
    const restoreErrors = [];
    for (const item of [...transactions].reverse()) {
      try {
        if (item.committed && fs.existsSync(item.targetDir)) fs.rmSync(item.targetDir, { recursive: true, force: true });
        if (item.movedOld && fs.existsSync(item.old)) fs.renameSync(item.old, item.targetDir);
      } catch (restoreError) {
        restoreErrors.push(restoreError.message);
      }
    }
    if (restoreErrors.length) error.restoreErrors = restoreErrors;
    throw error;
  }
  for (const item of transactions) {
    try {
      if (item.movedOld) fs.rmSync(item.old, { recursive: true, force: true });
    } catch {
      // The new targets are committed; an old hidden directory is safer than reporting a false rollback.
    }
  }
}

export function removePreparedCandidate(stage) {
  try {
    if (stage && fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup of a hidden staging directory.
  }
}

function cloneGitSource(git, descriptor) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-source-'));
  const repoDir = path.join(tempRoot, 'repo');
  const args = ['clone', '--depth', '1', '--single-branch'];
  if (git.ref) args.push('--branch', git.ref);
  args.push(git.remote, repoDir);
  const result = spawnSync('git', args, { encoding: 'utf8', timeout: 60000, windowsHide: true });
  if (result.status !== 0 || result.error) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    const detail = result.error?.message || String(result.stderr || result.stdout || `exit ${result.status}`).trim();
    throw new Error(`git clone failed: ${detail}`);
  }
  const subdir = sanitizeSubdir(git.subdir || '');
  const sourceDir = path.resolve(repoDir, subdir);
  if (sourceDir !== repoDir && !sourceDir.startsWith(`${repoDir}${path.sep}`)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw new Error(`skill source path escapes repository: ${subdir}`);
  }
  try {
    validateSkillPackage(sourceDir);
  } catch (error) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
  const head = spawnSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  const resolvedCommit = head.status === 0 ? String(head.stdout || '').trim() : null;
  return directoryResult(sourceDir, {
    ...descriptor,
    ref: git.ref || descriptor.ref,
    subdir,
    resolvedCommit,
  }, () => fs.rmSync(tempRoot, { recursive: true, force: true }));
}

function directoryResult(sourceDir, descriptor, cleanup) {
  const manifest = buildPackageManifest(sourceDir);
  return {
    kind: 'directory',
    sourceDir,
    source: descriptor.url,
    resolvedSource: descriptor.url,
    ref: descriptor.ref || null,
    subdir: descriptor.subdir || null,
    resolvedCommit: descriptor.resolvedCommit || null,
    manifest,
    cleanup,
  };
}

function parseGitSource(descriptor) {
  const url = descriptor.url;
  if (/^(git@|ssh:\/\/)/i.test(url) || /\.git(?:[#?].*)?$/i.test(url)) {
    return { remote: url, ref: descriptor.ref || null, subdir: descriptor.subdir || '' };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (!['github.com', 'gitee.com'].includes(parsed.hostname) || parts.length < 2) return null;
  const [owner, repoRaw, kind, branch, ...rest] = parts;
  const repo = repoRaw.replace(/\.git$/, '');
  const remote = `${parsed.protocol}//${parsed.host}/${owner}/${repo}.git`;
  if (!kind) return { remote, ref: descriptor.ref || null, subdir: descriptor.subdir || '' };
  if (!['tree', 'blob'].includes(kind) || !branch) return null;
  let subdir = rest.join('/');
  if (kind === 'blob' || subdir.endsWith('/SKILL.md') || subdir === 'SKILL.md') subdir = path.posix.dirname(subdir);
  if (subdir === '.') subdir = '';
  return { remote, ref: descriptor.ref || branch, subdir: descriptor.subdir || subdir };
}

function directSkillMdUrl(url) {
  if (/^file:\/\//i.test(url) && /\/SKILL\.md(?:[?#].*)?$/i.test(url)) return url;
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const parsed = new URL(url);
    return /\/SKILL\.md$/i.test(parsed.pathname) ? url : null;
  } catch {
    return null;
  }
}

async function fetchText(url, fetchImpl) {
  if (/^file:\/\//i.test(url)) return fs.readFileSync(new URL(url), 'utf8');
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { 'user-agent': 'aide-skill-manager' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const length = Number(response.headers?.get?.('content-length') || 0);
    if (length > 4 * 1024 * 1024) throw new Error('SKILL.md exceeds 4 MiB');
    const text = await response.text();
    if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error('SKILL.md exceeds 4 MiB');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeDescriptor(input) {
  if (typeof input === 'string') return { url: input, ref: null, subdir: null };
  if (!input || typeof input !== 'object' || !input.url) throw new Error('skill source URL is required');
  return { url: String(input.url), ref: input.ref || null, subdir: input.subdir || null };
}

function sanitizeSubdir(value) {
  const normalized = path.posix.normalize(String(value || '').replaceAll('\\', '/')).replace(/^\.\//, '');
  if (normalized === '.' || normalized === '/') return '';
  if (normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) throw new Error(`invalid skill source subdirectory: ${value}`);
  return normalized;
}

function isLocalPath(value) {
  return !/^(https?|file|ssh):\/\//i.test(String(value || '')) && !/^git@/i.test(String(value || ''));
}

function randomSuffix() {
  return Math.random().toString(16).slice(2, 10);
}
