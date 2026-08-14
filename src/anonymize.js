import crypto from 'node:crypto';
import path from 'node:path';

const REDACTED = '<redacted>';
const URL_KEYS = new Set(['source', 'repository', 'homepage', 'remote', 'sourceUrl', 'url']);

export function anonymizeCatalog(catalog) {
  return anonymizeValue(catalog, {
    pathMap: new Map(),
    workspaceMap: new Map(),
    urlMap: new Map(),
  });
}

export function anonymizeReportData(data) {
  return anonymizeValue(data, {
    pathMap: new Map(),
    workspaceMap: new Map(),
    urlMap: new Map(),
  });
}

function anonymizeValue(value, state, key = '') {
  if (Array.isArray(value)) {
    if (key === 'urls') return value.map((item) => anonymizeUrl(item, state.urlMap));
    return value.map((item) => anonymizeValue(item, state, key));
  }
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
  if (URL_KEYS.has(key)) return anonymizeUrl(value, state.urlMap);
  if (looksLikeHomePath(value)) return anonymizePath(value, state.pathMap, 'path');
  return anonymizeEmbeddedPaths(value, state);
}

function anonymizeUrl(value, map) {
  if (!value || typeof value !== 'string') return value;
  if (!looksLikeUrl(value)) return value;
  if (!map.has(value)) map.set(value, `url-${hash(value).slice(0, 8)}`);
  return map.get(value);
}

function looksLikeUrl(value) {
  return /^(https?:\/\/|file:\/\/|git@|ssh:\/\/)/i.test(value);
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
