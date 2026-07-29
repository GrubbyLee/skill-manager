import crypto from 'node:crypto';
import path from 'node:path';

const REDACTED = '<redacted>';

export function anonymizeCatalog(catalog) {
  return anonymizeValue(catalog, {
    pathMap: new Map(),
    workspaceMap: new Map(),
  });
}

export function anonymizeReportData(data) {
  return anonymizeValue(data, {
    pathMap: new Map(),
    workspaceMap: new Map(),
  });
}

function anonymizeValue(value, state, key = '') {
  if (Array.isArray(value)) return value.map((item) => anonymizeValue(item, state, key));
  if (!value || typeof value !== 'object') return anonymizeScalar(key, value, state);

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = anonymizeValue(v, state, k);
  }
  return out;
}

function anonymizeScalar(key, value, state) {
  if (typeof value !== 'string') return value;
  if (['path', 'realPath', 'configFile', 'scanCwd'].includes(key)) return anonymizePath(value, state.pathMap, 'path');
  if (key === 'workspace') return value ? anonymizePath(value, state.workspaceMap, 'workspace') : value;
  if (key === 'command') return value ? REDACTED : value;
  if (looksLikeHomePath(value)) return anonymizePath(value, state.pathMap, 'path');
  return anonymizeEmbeddedPaths(value, state);
}

function anonymizePath(value, map, prefix) {
  if (!value) return value;
  const normalized = normalizePath(value);
  if (!map.has(normalized)) map.set(normalized, `${prefix}-${hash(normalized).slice(0, 8)}`);
  return map.get(normalized);
}

function normalizePath(value) {
  return path.resolve(String(value).replace(/^~(?=$|[\\/])/, process.env.HOME || '~'));
}

function looksLikeHomePath(value) {
  const home = process.env.HOME;
  return Boolean(home && value.startsWith(home));
}

function anonymizeEmbeddedPaths(value, state) {
  return value
    .replace(/(?:~|\/home\/[^/\s]+|\/Users\/[^/\s]+)(?:\/[^\s，。；;:"'<>)]*)*/g, (match) => anonymizePath(match, state.pathMap, 'path'))
    .replace(/[A-Za-z]:\\Users\\[^\\/\s]+(?:[\\/][^\\/\s，。；;:"'<>)]*)*/g, (match) => anonymizePath(match, state.pathMap, 'path'));
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
