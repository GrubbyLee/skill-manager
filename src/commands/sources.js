import readline from 'node:readline/promises';
import { mergeByDirName } from '../catalog.js';
import { ensureCatalog } from './scan.js';
import { collectOutdatedRows } from './outdated.js';
import { applySourcesToSkills, loadSources, missingSourceRows, removeSource, upsertSource, isValidSourceUrl } from '../sources.js';
import { renderTable, termWidth } from '../table.js';
import { paint } from '../utils.js';
import { tr } from '../i18n.js';

export async function runSources({ cwd, json = false, output, source, repository, homepage, version, lang = 'zh-CN' }, args = []) {
  const action = args[0] || 'list';
  if (action === 'list') return runSourcesList({ json, lang });
  if (action === 'missing') return runSourcesMissing({ cwd, json, lang });
  if (action === 'add') return runSourcesAdd({ json, source, repository, homepage, version, lang }, args.slice(1));
  if (action === 'remove') return runSourcesRemove({ json, lang }, args.slice(1));
  if (action === 'check') return runSourcesCheck({ cwd, json, lang }, args.slice(1));
  if (action === 'wizard') return runSourcesWizard({ cwd, lang });
  throw new Error(tr(lang, 'sources.unknownAction', { action }));
}

function runSourcesList({ json = false, lang = 'zh-CN' }) {
  const data = loadSources();
  const rows = Object.entries(data.sources).map(([name, record]) => ({
    name,
    source: record.source || '',
    repository: record.repository || '',
    homepage: record.homepage || '',
    version: record.version || '',
    updatedAt: record.updatedAt || '',
  })).sort((a, b) => a.name.localeCompare(b.name));
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
      { title: tr(lang, 'sources.col.source'), width: 0 },
    ],
    rows.map((row) => [row.name, row.version || '—', row.source || row.repository || row.homepage || '—']),
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

function runSourcesAdd({ json = false, source, repository, homepage, version, lang = 'zh-CN' }, args) {
  const name = args[0];
  if (!name) throw new Error(tr(lang, 'sources.nameRequired'));
  const result = saveSource(name, { source, repository, homepage, version, note: 'manual' }, lang);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(paint.green(tr(lang, 'sources.saved', { name: result.name })));
}

function runSourcesRemove({ json = false, lang = 'zh-CN' }, args) {
  const name = args[0];
  if (!name) throw new Error(tr(lang, 'sources.nameRequired'));
  const removed = removeSource(name);
  if (json) {
    console.log(JSON.stringify({ name, removed }, null, 2));
    return;
  }
  console.log(removed ? paint.green(tr(lang, 'sources.removed', { name })) : paint.yellow(tr(lang, 'sources.notFound', { name })));
}

async function runSourcesCheck({ cwd, json = false, lang = 'zh-CN' }, args) {
  const name = args[0];
  if (!name) throw new Error(tr(lang, 'sources.nameRequired'));
  const catalog = ensureCatalog(cwd, lang);
  const merged = mergeByDirName(applySourcesToSkills(catalog.skills || []));
  const skill = merged.find((item) => item.dirName === name || item.name === name);
  if (!skill) throw new Error(tr(lang, 'sources.skillNotFound', { name }));
  const rows = await collectOutdatedRows([skill], { online: true, refresh: true, lang });
  if (json) {
    console.log(JSON.stringify(rows[0] || null, null, 2));
    return;
  }
  const row = rows[0];
  console.log(renderTable(
    [
      { title: tr(lang, 'sources.col.skill'), width: 28 },
      { title: tr(lang, 'sources.col.status'), width: 12 },
      { title: tr(lang, 'sources.col.source'), width: 0 },
    ],
    [[row.dirName, row.status, row.sourceUrl || '—']],
    termWidth(),
  ));
  console.log(row.suggestion);
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
      saveSource(row.dirName, { source: answer, note: 'wizard' }, lang);
      saved++;
      console.log(paint.green(tr(lang, 'sources.saved', { name: row.dirName })));
    }
    console.log(tr(lang, 'sources.wizardDone', { saved }));
  } finally {
    rl.close();
  }
}

function getMissingRows(cwd) {
  const catalog = ensureCatalog(cwd);
  return missingSourceRows(mergeByDirName(applySourcesToSkills(catalog.skills || [])));
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

function saveSource(name, input, lang) {
  try {
    return upsertSource(name, input);
  } catch (error) {
    if (error?.name === 'SourceError') {
      throw new Error(tr(lang, `sources.error.${error.code}`, error.params));
    }
    throw error;
  }
}
