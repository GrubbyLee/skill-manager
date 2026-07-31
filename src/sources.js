import { SOURCES_PATH } from './paths.js';
import { loadJsonFile, saveJsonFile } from './utils.js';

export const SOURCE_FILE_VERSION = 1;

export function loadSources() {
  const data = loadJsonFile(SOURCES_PATH);
  if (!data || typeof data !== 'object') return emptySources();
  const sources = data.sources && typeof data.sources === 'object' ? data.sources : {};
  return {
    version: SOURCE_FILE_VERSION,
    sources: Object.fromEntries(
      Object.entries(sources)
        .filter(([name, value]) => name && value && typeof value === 'object')
        .map(([name, value]) => [name, normalizeSourceRecord(value)]),
    ),
  };
}

export function saveSources(data) {
  saveJsonFile(SOURCES_PATH, {
    version: SOURCE_FILE_VERSION,
    sources: data.sources || {},
  }, { pretty: true });
}

export function upsertSource(name, input) {
  const key = normalizeName(name);
  if (!key) throw new SourceError('nameRequired');
  const record = normalizeSourceRecord(input);
  if (!record.source && !record.repository && !record.homepage && !record.version) {
    throw new SourceError('metadataRequired');
  }
  for (const [field, value] of Object.entries(record)) {
    if (['source', 'repository', 'homepage'].includes(field) && value && !isValidSourceUrl(value)) {
      throw new SourceError('invalidUrlField', { field, value });
    }
  }
  const data = loadSources();
  data.sources[key] = {
    ...(data.sources[key] || {}),
    ...record,
    updatedAt: new Date().toISOString(),
  };
  saveSources(data);
  return { name: key, record: data.sources[key] };
}

export function removeSource(name) {
  const key = normalizeName(name);
  const data = loadSources();
  const existed = Object.hasOwn(data.sources, key);
  if (existed) {
    delete data.sources[key];
    saveSources(data);
  }
  return existed;
}

export function findSourceForSkill(skill, data = loadSources()) {
  const names = [skill.dirName, skill.name].map(normalizeName).filter(Boolean);
  for (const name of names) {
    const record = data.sources[name];
    if (record) return { key: name, record };
  }
  return null;
}

export function applySourcesToSkills(skills, data = loadSources()) {
  return skills.map((skill) => applySourceToSkill(skill, data));
}

export function applySourceToSkill(skill, data = loadSources()) {
  const found = findSourceForSkill(skill, data);
  if (!found) return skill;
  const record = found.record;
  const upstream = skill.upstream || {};
  return {
    ...skill,
    upstream: {
      ...upstream,
      version: upstream.version || record.version || null,
      source: upstream.source || record.source || null,
      repository: upstream.repository || record.repository || null,
      homepage: upstream.homepage || record.homepage || null,
      localSourceKey: found.key,
      localSource: true,
      urls: mergeUrls(upstream.urls, [record.source, record.repository, record.homepage]),
      trackable: Boolean(upstream.trackable || upstream.git?.remote || upstream.source || upstream.repository || upstream.homepage || record.source || record.repository || record.homepage),
    },
  };
}

export function missingSourceRows(skills, data = loadSources()) {
  return skills
    .map((skill) => {
      const found = findSourceForSkill(skill, data);
      const upstream = found ? applySourceToSkill(skill, data).upstream : (skill.upstream || {});
      const hasUrl = Boolean(upstream.git?.remote || upstream.source || upstream.repository || upstream.homepage);
      return {
        dirName: skill.dirName,
        name: skill.name,
        tools: skill.tools || [skill.tool].filter(Boolean),
        category: skill.category,
        currentVersion: upstream.version || null,
        hasLocalSource: Boolean(found),
        status: hasUrl ? 'has-source' : upstream.version ? 'version-only' : 'missing',
        suggestion: hasUrl ? '' : `skm sources add ${skill.dirName} --source <url>`,
      };
    })
    .filter((row) => row.status !== 'has-source')
    .sort((a, b) => sourceStatusOrder(a.status) - sourceStatusOrder(b.status) || a.dirName.localeCompare(b.dirName));
}

export class SourceError extends Error {
  constructor(code, params = {}) {
    super(code);
    this.name = 'SourceError';
    this.code = code;
    this.params = params;
  }
}

export function isValidSourceUrl(value) {
  if (!/^(https?:\/\/|git@|ssh:\/\/)/i.test(String(value || ''))) return false;
  if (/^git@/i.test(value)) return /^git@[^:]+:.+/.test(value);
  try {
    const u = new URL(value);
    return ['http:', 'https:', 'ssh:'].includes(u.protocol);
  } catch {
    return false;
  }
}

function emptySources() {
  return { version: SOURCE_FILE_VERSION, sources: {} };
}

function normalizeSourceRecord(value) {
  return {
    source: clean(value.source),
    repository: clean(value.repository || value.repo),
    homepage: clean(value.homepage),
    version: clean(value.version),
    note: clean(value.note),
    updatedAt: clean(value.updatedAt),
  };
}

function mergeUrls(existing = [], values = []) {
  return [...new Set([...(existing || []), ...values].filter((v) => isValidSourceUrl(v)))];
}

function sourceStatusOrder(status) {
  return { 'version-only': 0, missing: 1 }[status] ?? 9;
}

function normalizeName(name) {
  return String(name || '').trim();
}

function clean(value) {
  const text = String(value || '').trim();
  return text || null;
}
