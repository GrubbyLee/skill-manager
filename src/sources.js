import { SOURCES_PATH } from './paths.js';
import { loadJsonFile, saveJsonFile } from './utils.js';
import { installationId } from './skillPackage.js';

export const SOURCE_FILE_VERSION = 2;

export function loadSources() {
  const data = loadJsonFile(SOURCES_PATH);
  if (!data || typeof data !== 'object') return emptySources();
  const sources = data.sources && typeof data.sources === 'object' ? data.sources : {};
  const instances = data.instances && typeof data.instances === 'object' ? data.instances : {};
  return {
    version: SOURCE_FILE_VERSION,
    sources: Object.fromEntries(
      Object.entries(sources)
        .filter(([name, value]) => name && value && typeof value === 'object')
        .map(([name, value]) => [name, normalizeSourceRecord(value)]),
    ),
    instances: Object.fromEntries(
      Object.entries(instances)
        .filter(([id, value]) => id && value && typeof value === 'object')
        .map(([id, value]) => [id, normalizeSourceRecord(value)]),
    ),
  };
}

export function saveSources(data) {
  saveJsonFile(SOURCES_PATH, {
    version: SOURCE_FILE_VERSION,
    sources: data.sources || {},
    instances: data.instances || {},
  }, { pretty: true });
}

export function upsertSource(name, input, { instanceId = null } = {}) {
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
  const collection = instanceId ? data.instances : data.sources;
  const targetKey = instanceId || key;
  collection[targetKey] = {
    ...(collection[targetKey] || {}),
    ...record,
    skillName: key,
    updatedAt: new Date().toISOString(),
  };
  saveSources(data);
  return { name: key, instanceId, record: collection[targetKey] };
}

export function removeSource(name, { instanceId = null } = {}) {
  const key = normalizeName(name);
  const data = loadSources();
  const collection = instanceId ? data.instances : data.sources;
  const targetKey = instanceId || key;
  const existed = Object.hasOwn(collection, targetKey);
  if (existed) {
    delete collection[targetKey];
    saveSources(data);
  }
  return existed;
}

export function findSourceForSkill(skill, data = loadSources()) {
  const id = skill.id || installationId(skill);
  if (id && data.instances?.[id]) return { key: id, instanceId: id, record: data.instances[id] };
  const names = [skill.dirName, skill.name].map(normalizeName).filter(Boolean);
  const hasInstanceRecords = Object.values(data.instances || {}).some((record) => names.includes(normalizeName(record.skillName)));
  if (hasInstanceRecords) return null;
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
  const upstream = sanitizeUpstreamUrls(skill.upstream || {});
  if (!found) return { ...skill, upstream };
  const record = found.record;
  return {
    ...skill,
    upstream: {
      ...upstream,
      version: upstream.version || record.version || null,
      source: upstream.source || record.source || null,
      repository: upstream.repository || record.repository || null,
      homepage: upstream.homepage || record.homepage || null,
      ref: upstream.ref || record.ref || null,
      subdir: upstream.subdir || record.subdir || null,
      resolvedCommit: upstream.resolvedCommit || record.resolvedCommit || null,
      packageHash: upstream.packageHash || record.packageHash || null,
      sourceDiscovery: upstream.sourceDiscovery || record.discovery || null,
      localSourceKey: found.key,
      localSourceInstance: found.instanceId || null,
      localSource: true,
      urls: mergeUrls(upstream.urls, [record.source, record.repository, record.homepage]),
      trackable: Boolean(upstream.git?.remote || upstream.source || upstream.repository || upstream.homepage || record.source || record.repository || record.homepage),
    },
  };
}

export function missingSourceRows(skills, data = loadSources()) {
  return skills
    .map((skill) => {
      const found = findSourceForSkill(skill, data);
      const upstream = applySourceToSkill(skill, data).upstream || {};
      const hasUrl = Boolean(upstream.git?.remote || upstream.source || upstream.repository || upstream.homepage);
      return {
        instanceId: skill.id || installationId(skill),
        dirName: skill.dirName,
        name: skill.name,
        tool: skill.tool || null,
        scope: skill.scope || null,
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
  if (!/^(https?:\/\/|file:\/\/|git@|ssh:\/\/)/i.test(String(value || ''))) return false;
  if (/^git@/i.test(value)) return /^git@[^:]+:.+/.test(value);
  try {
    const u = new URL(value);
    return ['http:', 'https:', 'ssh:', 'file:'].includes(u.protocol);
  } catch {
    return false;
  }
}

function emptySources() {
  return { version: SOURCE_FILE_VERSION, sources: {}, instances: {} };
}

function normalizeSourceRecord(value) {
  return {
    source: clean(value.source),
    repository: clean(value.repository || value.repo),
    homepage: clean(value.homepage),
    version: clean(value.version),
    note: clean(value.note),
    skillName: clean(value.skillName),
    ref: clean(value.ref),
    subdir: clean(value.subdir),
    resolvedCommit: clean(value.resolvedCommit),
    packageHash: clean(value.packageHash),
    discovery: normalizeDiscovery(value.discovery),
    updatedAt: clean(value.updatedAt),
  };
}

function normalizeDiscovery(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    method: clean(value.method),
    provider: clean(value.provider),
    query: clean(value.query),
    confidence: Number.isFinite(Number(value.confidence)) ? Number(value.confidence) : null,
    verifiedAt: clean(value.verifiedAt),
    confirmedByUser: value.confirmedByUser === true,
    candidatePath: clean(value.candidatePath),
  };
}

function mergeUrls(existing = [], values = []) {
  return [...new Set([...(existing || []), ...values].filter((v) => isValidSourceUrl(v)))];
}

function sanitizeUpstreamUrls(upstream) {
  return {
    ...upstream,
    source: isValidSourceUrl(upstream.source) ? upstream.source : null,
    repository: isValidSourceUrl(upstream.repository) ? upstream.repository : null,
    homepage: isValidSourceUrl(upstream.homepage) ? upstream.homepage : null,
    urls: mergeUrls(upstream.urls),
  };
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
