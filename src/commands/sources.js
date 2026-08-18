import readline from 'node:readline/promises';
import { ensureCatalog } from './scan.js';
import { collectOutdatedRows } from './outdated.js';
import { applySourcesToSkills, loadSources, missingSourceRows, removeSource, upsertSource, isValidSourceUrl } from '../sources.js';
import { discoverSkillSources } from '../sourceDiscovery.js';
import { renderTable, termWidth } from '../table.js';
import { paint } from '../utils.js';
import { tr } from '../i18n.js';

export async function runSources({ cwd, json = false, source, repository, homepage, version, tool, scope, instance, all = false, yes = false, select = null, provider = 'github', lang = 'zh-CN' }, args = []) {
  const action = args[0] || 'list';
  if (action === 'list') return runSourcesList({ json, lang });
  if (action === 'missing') return runSourcesMissing({ cwd, json, lang });
  if (action === 'add') return runSourcesAdd({ cwd, json, source, repository, homepage, version, tool, scope, instance, all, lang }, args.slice(1));
  if (action === 'remove') return runSourcesRemove({ json, instance, lang }, args.slice(1));
  if (action === 'check') return runSourcesCheck({ cwd, json, tool, scope, instance, all, lang }, args.slice(1));
  if (action === 'discover') return runSourcesDiscover({ cwd, json, yes, select, provider, tool, scope, instance, all, lang }, args.slice(1));
  if (action === 'wizard') return runSourcesWizard({ cwd, lang });
  throw new Error(tr(lang, 'sources.unknownAction', { action }));
}

function runSourcesList({ json = false, lang = 'zh-CN' }) {
  const data = loadSources();
  const rows = [
    ...Object.entries(data.sources).map(([name, record]) => ({
      instanceId: '',
      name,
      source: record.source || '',
      repository: record.repository || '',
      homepage: record.homepage || '',
      version: record.version || '',
      discovery: record.discovery || null,
      updatedAt: record.updatedAt || '',
    })),
    ...Object.entries(data.instances || {}).map(([instanceId, record]) => ({
      instanceId,
      name: record.skillName || instanceId,
      source: record.source || '',
      repository: record.repository || '',
      homepage: record.homepage || '',
      version: record.version || '',
      discovery: record.discovery || null,
      updatedAt: record.updatedAt || '',
    })),
  ].sort((a, b) => a.name.localeCompare(b.name) || a.instanceId.localeCompare(b.instanceId));
  if (json) {
    console.log(JSON.stringify({ fileVersion: data.version, total: rows.length, items: rows }, null, 2));
    return;
  }
  if (!rows.length) {
    console.log(tr(lang, 'sources.empty'));
    return;
  }
  console.log(renderTable(
    [
      { title: tr(lang, 'sources.col.skill'), width: 28 },
      { title: tr(lang, 'sources.col.version'), width: 12 },
      { title: tr(lang, 'sources.col.method'), width: 10 },
      { title: tr(lang, 'sources.col.source'), width: 0 },
    ],
    rows.map((row) => [row.instanceId ? `${row.name} [${row.instanceId}]` : row.name, row.version || '—', row.discovery?.method || '—', row.source || row.repository || row.homepage || '—']),
    termWidth(),
  ));
}

function runSourcesMissing({ cwd, json = false, lang = 'zh-CN' }) {
  const rows = getMissingRows(cwd);
  if (json) {
    console.log(JSON.stringify({ total: rows.length, items: rows }, null, 2));
    return;
  }
  printMissingRows(rows, lang);
}

function runSourcesAdd({ cwd, json = false, source, repository, homepage, version, tool, scope, instance, all, lang = 'zh-CN' }, args) {
  const name = args[0];
  if (!name) throw new Error(tr(lang, 'sources.nameRequired'));
  const input = { source, repository, homepage, version, note: 'manual', discovery: manualDiscovery() };
  const entries = matchingEntries(cwd, name, { tool, scope, instance });
  if (entries.length > 1 && !all) throw new Error(instanceChoiceError(entries, lang));
  const results = entries.length
    ? entries.map((entry) => saveSource(name, input, lang, entry.id))
    : [saveSource(name, input, lang)];
  if (entries.length === 1) saveSource(name, input, lang);
  if (json) {
    console.log(JSON.stringify({ items: results }, null, 2));
    return;
  }
  console.log(paint.green(tr(lang, 'sources.saved', { name: `${name} (${results.length})` })));
}

function runSourcesRemove({ json = false, instance, lang = 'zh-CN' }, args) {
  const name = args[0];
  if (!name) throw new Error(tr(lang, 'sources.nameRequired'));
  const removed = removeSource(name, { instanceId: instance || null });
  if (json) {
    console.log(JSON.stringify({ name, removed }, null, 2));
    return;
  }
  console.log(removed ? paint.green(tr(lang, 'sources.removed', { name })) : paint.yellow(tr(lang, 'sources.notFound', { name })));
}

async function runSourcesCheck({ cwd, json = false, tool, scope, instance, all, lang = 'zh-CN' }, args) {
  const name = args[0];
  if (!name) throw new Error(tr(lang, 'sources.nameRequired'));
  const entries = matchingEntries(cwd, name, { tool, scope, instance });
  if (!entries.length) throw new Error(tr(lang, 'sources.skillNotFound', { name }));
  if (entries.length > 1 && !all) throw new Error(instanceChoiceError(entries, lang));
  const rows = await collectOutdatedRows(entries, { online: true, refresh: true, lang });
  if (json) {
    console.log(JSON.stringify(rows.length === 1 ? rows[0] : { items: rows }, null, 2));
    return;
  }
  console.log(renderTable(
    [
      { title: tr(lang, 'sources.col.skill'), width: 28 },
      { title: tr(lang, 'sources.col.status'), width: 12 },
      { title: tr(lang, 'sources.col.source'), width: 0 },
    ],
    rows.map((row) => [`${row.dirName} (${row.tool || '—'}/${row.scope || '—'})`, row.status, row.sourceUrl || '—']),
    termWidth(),
  ));
  for (const item of rows) console.log(item.suggestion);
}

async function runSourcesWizard({ cwd, lang = 'zh-CN' }) {
  if (!process.stdin.isTTY) throw new Error(tr(lang, 'sources.wizardTtyRequired'));
  const rows = getMissingRows(cwd);
  if (!rows.length) {
    console.log(paint.green(tr(lang, 'sources.noMissing')));
    return;
  }
  console.log(tr(lang, 'sources.wizardIntro', { count: rows.length }));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    let saved = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      console.log(`\n${i + 1}/${rows.length} ${paint.bold(row.dirName)} ${row.currentVersion ? `(${row.currentVersion})` : ''}`);
      console.log(tr(lang, row.status === 'version-only' ? 'sources.reasonVersionOnly' : 'sources.reasonMissing'));
      const answer = (await rl.question(tr(lang, 'sources.prompt'))).trim();
      if (!answer || answer.toLowerCase() === 's') continue;
      if (answer.toLowerCase() === 'q') break;
      if (answer === '2' || /^search$/i.test(answer)) {
        if (!(await confirmSearchPermission(rl, lang))) continue;
        const result = await discoverForWizard(row.dirName, lang);
        const selected = await chooseCandidate(result.candidates, rl, lang);
        if (!selected) continue;
        saveSource(row.dirName, discoveryRecord(selected, result), lang, row.instanceId);
        saved++;
        console.log(paint.green(tr(lang, 'sources.saved', { name: row.dirName })));
        continue;
      }
      if (answer === '?') {
        console.log(tr(lang, 'sources.helpText'));
        i--;
        continue;
      }
      if (!isValidSourceUrl(answer)) {
        console.log(paint.yellow(tr(lang, 'sources.invalidUrl')));
        i--;
        continue;
      }
      saveSource(row.dirName, { source: answer, note: 'wizard', discovery: manualDiscovery() }, lang, row.instanceId);
      saved++;
      console.log(paint.green(tr(lang, 'sources.saved', { name: row.dirName })));
    }
    console.log(tr(lang, 'sources.wizardDone', { saved }));
  } finally {
    rl.close();
  }
}

async function runSourcesDiscover({ cwd, json = false, yes = false, select = null, provider = 'github', tool, scope, instance, all, lang = 'zh-CN' }, args) {
  const name = args[0];
  if (!name) throw new Error(tr(lang, 'sources.nameRequired'));
  if (!yes && !process.stdin.isTTY) throw new Error(tr(lang, 'sources.searchTtyRequired'));
  if (yes && !process.stdin.isTTY && !json && select == null) throw new Error(tr(lang, 'sources.searchSelectRequired'));
  const entries = matchingEntries(cwd, name, { tool, scope, instance });
  if (entries.length > 1 && !all) throw new Error(instanceChoiceError(entries, lang));
  if (!(await confirmSearchPermission(null, lang, yes))) return;
  const result = await discoverSkillSources(name, { provider });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (!result.candidates.length) {
    console.log(paint.yellow(tr(lang, 'sources.noSearchResults', { name })));
    return;
  }
  const rl = select == null ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    const selected = await chooseCandidate(result.candidates, rl, lang, select);
    if (!selected) return;
    const record = discoveryRecord(selected, result);
    if (entries.length) {
      for (const entry of entries) saveSource(name, record, lang, entry.id);
      if (entries.length === 1) saveSource(name, record, lang);
    } else {
      saveSource(name, record, lang);
    }
    console.log(paint.green(tr(lang, 'sources.discoverySaved', { name, source: selected.source })));
  } finally {
    rl?.close();
  }
}

async function discoverForWizard(name, lang) {
  try {
    return await discoverSkillSources(name);
  } catch (error) {
    console.log(paint.yellow(tr(lang, 'sources.searchFailed', { message: error.message })));
    return { candidates: [] };
  }
}

async function confirmSearchPermission(rl, lang, alreadyAllowed = false) {
  if (alreadyAllowed) return true;
  if (!process.stdin.isTTY && !rl) throw new Error(tr(lang, 'sources.searchTtyRequired'));
  const input = rl || readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await input.question(tr(lang, 'sources.searchConsent'))).trim().toLowerCase();
    return ['y', 'yes', '是', '确认'].includes(answer);
  } finally {
    if (!rl) input.close();
  }
}

async function chooseCandidate(candidates, rl, lang, selectedIndex = null) {
  if (!candidates.length) {
    console.log(paint.yellow(tr(lang, 'sources.noSearchResults', { name: 'skill' })));
    return null;
  }
  console.log(`\n${tr(lang, 'sources.searchResults')}`);
  console.log(renderTable(
    [
      { title: '#', width: 4 },
      { title: tr(lang, 'sources.col.skill'), width: 22 },
      { title: tr(lang, 'sources.col.source'), width: 0 },
      { title: tr(lang, 'sources.col.status'), width: 12 },
    ],
    candidates.map((candidate, index) => [index + 1, candidate.name, candidate.source, `${Math.round(candidate.confidence * 100)}%`]),
    termWidth(),
  ));
  let index = selectedIndex == null ? null : Number(selectedIndex) - 1;
  if (index == null || !Number.isInteger(index)) {
    if (!rl) throw new Error(tr(lang, 'sources.searchSelectRequired'));
    const answer = (await rl.question(tr(lang, 'sources.searchSelect'))).trim().toLowerCase();
    if (!answer || answer === 'q' || answer === 's') return null;
    index = Number(answer) - 1;
  }
  if (!Number.isInteger(index) || !candidates[index]) {
    console.log(paint.yellow(tr(lang, 'sources.searchSelectionInvalid')));
    return null;
  }
  return candidates[index];
}

function discoveryRecord(candidate, result) {
  return {
    source: candidate.source,
    repository: candidate.repositoryUrl,
    version: candidate.version,
    ref: candidate.ref,
    subdir: candidate.subdir,
    note: 'discovered',
    discovery: {
      method: 'search',
      provider: result.provider,
      query: result.query,
      confidence: candidate.confidence,
      verifiedAt: result.searchedAt,
      confirmedByUser: true,
      candidatePath: candidate.path,
    },
  };
}

function manualDiscovery() {
  return {
    method: 'manual',
    confirmedByUser: true,
  };
}

function getMissingRows(cwd) {
  const catalog = ensureCatalog(cwd);
  return missingSourceRows(applySourcesToSkills(catalog.skills || []));
}

function printMissingRows(rows, lang) {
  if (!rows.length) {
    console.log(paint.green(tr(lang, 'sources.noMissing')));
    return;
  }
  console.log(tr(lang, 'sources.missingSummary', { count: rows.length }));
  console.log(renderTable(
    [
      { title: tr(lang, 'sources.col.skill'), width: 28 },
      { title: tr(lang, 'sources.col.version'), width: 12 },
      { title: tr(lang, 'sources.col.reason'), width: 18 },
      { title: tr(lang, 'sources.col.suggestion'), width: 0 },
    ],
    rows.slice(0, 80).map((row) => [
      row.dirName,
      row.currentVersion || '—',
      tr(lang, row.status === 'version-only' ? 'sources.status.versionOnly' : 'sources.status.missing'),
      tr(lang, 'sources.addSuggestion', { name: row.dirName }),
    ]),
    termWidth(),
  ));
  if (rows.length > 80) console.log(tr(lang, 'sources.more', { count: rows.length - 80 }));
}

function saveSource(name, input, lang, instanceId = null) {
  try {
    return upsertSource(name, input, { instanceId });
  } catch (error) {
    if (error?.name === 'SourceError') {
      throw new Error(tr(lang, `sources.error.${error.code}`, error.params));
    }
    throw error;
  }
}

function matchingEntries(cwd, name, { tool, scope, instance }) {
  const catalog = ensureCatalog(cwd);
  return applySourcesToSkills(catalog.skills || []).filter((entry) => {
    if (entry.dirName !== name && entry.name !== name) return false;
    if (tool && normalizeTool(entry.tool) !== normalizeTool(tool)) return false;
    if (scope && entry.scope !== scope) return false;
    if (instance && entry.id !== instance) return false;
    return true;
  });
}

function instanceChoiceError(entries, lang) {
  const choices = entries.map((entry) => `${entry.tool}/${entry.scope} [${entry.id}]`).join(', ');
  return lang === 'en'
    ? `Multiple installations match; add --tool/--scope/--instance or --all: ${choices}`
    : `存在多个匹配实例，请加 --tool/--scope/--instance 或 --all：${choices}`;
}

function normalizeTool(tool) {
  return tool === 'claude' ? 'claude-code' : tool;
}
