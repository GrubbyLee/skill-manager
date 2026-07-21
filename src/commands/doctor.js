import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadCatalog, mergeByDirName } from '../catalog.js';
import {
  CLAUDE_SKILLS_DIR,
  CODEX_SKILLS_DIR,
  CLAUDE_CONFIG_FILE,
  CODEX_CONFIG_FILE,
  CLAUDE_SESSIONS_ROOT,
  CODEX_SESSIONS_ROOT,
  CATALOG_PATH,
} from '../paths.js';
import { fmtDateTime, paint } from '../utils.js';
import { renderTable, termWidth } from '../table.js';
import { fmtAgoLang, tr } from '../i18n.js';

const MIN_NODE_MAJOR = 18;

// skm doctor：只读环境诊断。用于新用户安装后确认 Node、目录、catalog、advisor CLI 与项目约束。
export function runDoctor({ cwd, json = false, lang = 'zh-CN' }) {
  const report = collectDoctor({ cwd, lang: json ? 'zh-CN' : lang });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(paint.bold(`${tr(lang, 'doctor.title')}\n`));
  console.log(renderTable(
    [{ title: tr(lang, 'doctor.col.item'), width: 22 }, { title: tr(lang, 'doctor.col.status'), width: 8 }, { title: tr(lang, 'doctor.col.detail'), width: 0 }],
    report.checks.map((c) => [c.name, label(c.status, lang), c.detail]),
    termWidth(),
  ));

  const fail = report.summary.fail;
  const warn = report.summary.warn;
  console.log(`\n${colorConclusion(tr(lang, 'doctor.conclusion', { fail, warn }), fail, warn)}`);
  if (report.nextSteps.length) {
    console.log(`\n${tr(lang, 'doctor.nextSteps')}`);
    for (const [i, step] of report.nextSteps.entries()) console.log(`  ${i + 1}. ${step}`);
  }
}

export function collectDoctor({ cwd, spawnImpl = spawnSync, nodeVersion = process.versions.node, lang = 'zh-CN' }) {
  const checks = [];
  const add = (status, name, detail, data = {}) => checks.push({ status, name, detail, ...data });
  const en = lang === 'en';

  const nodeMajor = Number(String(nodeVersion).split('.')[0]);
  add(nodeMajor >= MIN_NODE_MAJOR ? 'ok' : 'fail', en ? 'Node.js version' : 'Node.js 版本', en ? `current ${nodeVersion}, required >= ${MIN_NODE_MAJOR}` : `当前 ${nodeVersion}，要求 >= ${MIN_NODE_MAJOR}`);

  const pkg = readPackage(cwd);
  if (!pkg) {
    add('fail', 'package.json', en ? 'not found or cannot be parsed' : '未找到或无法解析 package.json');
  } else {
    const depCount = Object.keys(pkg.dependencies || {}).length;
    add(depCount === 0 ? 'ok' : 'fail', en ? 'Zero dependencies' : '零第三方依赖', depCount === 0 ? (en ? 'dependencies is empty' : 'dependencies 为空') : (en ? `${depCount} dependencies found` : `发现 ${depCount} 个 dependencies`));
    add(pkg.type === 'module' ? 'ok' : 'fail', 'ES Modules', pkg.type === 'module' ? 'type=module' : (en ? 'package.json is missing type=module' : 'package.json 缺少 type=module'));
    add(pkg.bin?.skm ? 'ok' : 'fail', en ? 'skm command entry' : 'skm 命令入口', pkg.bin?.skm ? pkg.bin.skm : (en ? 'package.json is missing bin.skm' : 'package.json 缺少 bin.skm'));
  }

  for (const [name, file] of [
    [en ? 'Claude skill directory' : 'Claude skill 目录', CLAUDE_SKILLS_DIR],
    [en ? 'Codex skill directory' : 'Codex skill 目录', CODEX_SKILLS_DIR],
    [en ? 'Claude config' : 'Claude 配置', CLAUDE_CONFIG_FILE],
    [en ? 'Codex config' : 'Codex 配置', CODEX_CONFIG_FILE],
    [en ? 'Claude session logs' : 'Claude 会话日志', CLAUDE_SESSIONS_ROOT],
    [en ? 'Codex session logs' : 'Codex 会话日志', CODEX_SESSIONS_ROOT],
  ]) {
    add(fs.existsSync(file) ? 'ok' : 'warn', name, fs.existsSync(file) ? file : (en ? `not found: ${file}` : `未发现：${file}`));
  }

  const catalog = loadCatalog();
  if (!catalog) {
    add('warn', en ? 'Catalog' : '扫描目录', en ? `no valid ${CATALOG_PATH}; run skm scan first` : `未找到有效 ${CATALOG_PATH}，建议先运行 skm scan`);
  } else {
    const uniqueSkills = mergeByDirName(catalog.skills).length;
    add('ok', en ? 'Catalog' : '扫描目录', en
      ? `${uniqueSkills} unique skills / ${catalog.skills.length} install records / ${catalog.mcpServers.length} MCP servers, scanned at ${fmtDateTime(catalog.scannedAt)} (${fmtAgoLang(lang, catalog.scannedAt)})`
      : `${uniqueSkills} 个去重 skill / ${catalog.skills.length} 条安装记录 / ${catalog.mcpServers.length} 个 MCP，扫描于 ${fmtDateTime(catalog.scannedAt)}（${fmtAgoLang(lang, catalog.scannedAt)}）`);
  }

  for (const cmd of ['codex', 'claude']) {
    const found = probeCommand(cmd, spawnImpl);
    add(found.ok ? 'ok' : 'warn', `${cmd} advisor`, found.ok ? found.detail : (en ? `${cmd} is not in PATH; only --advisor ${cmd} is affected` : `${cmd} 不在 PATH；仅影响 --advisor ${cmd}`));
  }

  const ci = path.join(cwd, '.github', 'workflows', 'ci.yml');
  add(fs.existsSync(ci) ? 'ok' : 'warn', 'macOS/Windows CI', fs.existsSync(ci) ? (en ? '.github/workflows/ci.yml exists' : '.github/workflows/ci.yml 已存在') : (en ? 'cross-platform workflow not found' : '未发现跨端验证工作流'));

  const summary = countStatuses(checks);
  return {
    generatedAt: new Date().toISOString(),
    summary,
    checks,
    nextSteps: buildNextSteps(checks, lang),
  };
}

function readPackage(cwd) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function probeCommand(command, spawnImpl) {
  const r = spawnImpl(command, ['--version'], { encoding: 'utf8', timeout: 3000, windowsHide: true });
  if (r.error) return { ok: false, detail: r.error.code === 'ENOENT' ? '未找到命令' : r.error.message };
  if (r.status === 0) {
    const text = `${r.stdout || ''}${r.stderr || ''}`.trim().split(/\r?\n/)[0];
    return { ok: true, detail: text || '命令可用' };
  }
  return { ok: false, detail: `退出码 ${r.status}` };
}

function countStatuses(checks) {
  const out = { ok: 0, warn: 0, fail: 0 };
  for (const c of checks) out[c.status] = (out[c.status] || 0) + 1;
  return out;
}

function buildNextSteps(checks, lang = 'zh-CN') {
  const en = lang === 'en';
  const steps = [];
  if (checks.some((c) => ['Node.js 版本', 'Node.js version'].includes(c.name) && c.status === 'fail')) steps.push(en ? 'Upgrade Node.js to 18 or later.' : '升级 Node.js 到 18 或更高版本。');
  if (checks.some((c) => ['扫描目录', 'Catalog'].includes(c.name) && c.status !== 'ok')) steps.push(en ? 'Run skm scan to build the local skill / MCP catalog.' : '运行 skm scan 建立本机 skill / MCP 目录。');
  if (checks.some((c) => c.name.endsWith('advisor') && c.status !== 'ok')) steps.push(en ? 'For enhanced recommendations, make sure codex / claude is installed, logged in, and available in PATH. Default local recommendation is unaffected.' : '如需增强推荐，确认 codex / claude 已安装、已登录且在 PATH 中；默认推荐不受影响。');
  if (checks.some((c) => c.name === 'macOS/Windows CI' && c.status !== 'ok')) steps.push(en ? 'Add macOS / Windows CI before public release; Linux can be validated locally.' : '开源发布前建议补充 macOS / Windows CI；Linux 可在本机验证。');
  return steps;
}

function label(status, lang) {
  if (status === 'ok') return paint.green(tr(lang, 'common.ok'));
  if (status === 'fail') return paint.red(tr(lang, 'common.fail'));
  return paint.yellow(tr(lang, 'common.warn'));
}

function colorConclusion(text, fail, warn) {
  if (fail) return paint.red(text);
  if (warn) return paint.yellow(text);
  return paint.green(text);
}
