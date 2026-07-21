import { scanClaudeCode } from '../adapters/claudeCode.js';
import { scanCodex } from '../adapters/codex.js';
import { loadRules, classify } from '../classify.js';
import { saveCatalog, loadCatalog, mergeByDirName, CATALOG_REL } from '../catalog.js';
import { renderTable, termWidth } from '../table.js';
import { paint, paintErr } from '../utils.js';
import { tr } from '../i18n.js';

// silent 模式：汇总走 stderr，保证 --json 消费方的 stdout 干净（兜底重扫场景）
export function runScan({ cwd, json = false, verbose = false, silent = false, lang = 'zh-CN' }) {
  const print = silent ? console.error : console.log;
  // 着色按实际写入的流判断（stdout 与 stderr 的 TTY 状态可能不同）
  const pal = silent ? paintErr : paint;
  const claude = scanClaudeCode({ cwd });
  const codex = scanCodex();
  const ruleSet = loadRules();

  const skills = [...claude.skills, ...codex.skills].map((s) => ({
    ...s,
    category: classify(s, ruleSet),
  }));
  const mcpServers = [...claude.mcpServers, ...codex.mcpServers];
  const warnings = [...claude.warnings, ...codex.warnings];

  const catalog = {
    version: 1,
    scannedAt: new Date().toISOString(),
    scanCwd: cwd,
    skills,
    mcpServers,
    warnings,
    archived: { 'claude-code': claude.archived, codex: codex.archived },
  };
  saveCatalog(catalog);

  if (json) {
    console.log(JSON.stringify(catalog, null, 2));
    return;
  }

  const merged = mergeByDirName(skills);
  const both = merged.filter((m) => m.tools.length > 1).length;
  const byCat = new Map();
  for (const m of merged) byCat.set(m.category, (byCat.get(m.category) || 0) + 1);

  const skillStats = (tool) => {
    const list = skills.filter((s) => s.tool === tool);
    return {
      skills: list.length,
      user: list.filter((s) => s.scope === 'user').length,
      project: list.filter((s) => s.scope === 'project').length,
      plugin: list.filter((s) => s.scope === 'plugin').length,
      mcp: mcpServers.filter((s) => s.tool === tool).length,
      archived: catalog.archived[tool],
      tokens: list.reduce((sum, s) => sum + s.descTokens, 0),
    };
  };

  print(pal.green(tr(lang, 'scan.done')));
  const width = termWidth();
  const claudeStats = skillStats('claude-code');
  const codexStats = skillStats('codex');

  print(`\n${tr(lang, 'scan.overview')}`);
  print(renderTable(
    [
      { title: tr(lang, 'scan.col.tool'), width: 12 },
      { title: 'skill', width: 6 },
      { title: tr(lang, 'scan.col.user'), width: 6 },
      { title: tr(lang, 'scan.col.project'), width: 6 },
      { title: tr(lang, 'scan.col.plugin'), width: 6 },
      { title: 'MCP', width: 5 },
      { title: tr(lang, 'scan.col.archived'), width: 8 },
      { title: tr(lang, 'scan.col.context'), width: 0 },
    ],
    [
      ['Claude Code', claudeStats.skills, claudeStats.user, claudeStats.project, claudeStats.plugin, claudeStats.mcp, claudeStats.archived, tr(lang, 'scan.tokens', { n: claudeStats.tokens })],
      ['Codex', codexStats.skills, codexStats.user, codexStats.project, codexStats.plugin, codexStats.mcp, codexStats.archived, tr(lang, 'scan.tokens', { n: codexStats.tokens })],
    ],
    Math.min(width, 100),
  ));

  print(`\n${tr(lang, 'scan.summary')}`);
  print(renderTable(
    [
      { title: tr(lang, 'scan.col.metric'), width: 24 },
      { title: tr(lang, 'scan.col.value'), width: 0 },
    ],
    [
      [tr(lang, 'scan.metric.uniqueSkills'), tr(lang, 'scan.unit.items', { n: merged.length })],
      [tr(lang, 'scan.metric.sameNameBoth'), tr(lang, 'scan.unit.items', { n: both })],
      [tr(lang, 'scan.metric.warnings'), tr(lang, 'scan.unit.warnings', { n: warnings.length })],
      [tr(lang, 'scan.metric.catalogFile'), CATALOG_REL],
    ],
    Math.min(width, 90),
  ));

  print(`\n${tr(lang, 'scan.categories')}`);
  print(renderTable(
    [
      { title: tr(lang, 'scan.col.category'), width: 24 },
      { title: tr(lang, 'scan.col.count'), width: 0 },
    ],
    [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => [c, tr(lang, 'scan.unit.items', { n })]),
    Math.min(width, 80),
  ));
  if (catalog.archived['claude-code'] + catalog.archived.codex > 0) {
    print(`\n${tr(lang, 'scan.archivedNote')}`);
  }
  if (warnings.length) {
    print(pal.yellow(tr(lang, 'scan.warningSummary', { n: warnings.length, verbose })));
    if (verbose) for (const w of warnings) print(pal.yellow(`    - ${w}`));
  }
  print(`\n${tr(lang, 'scan.catalogWritten', { file: CATALOG_REL })}`);
}

// 各命令的统一兜底：目录缺失/损坏 → 静默重扫（汇总走 stderr）→ 仍失败则抛出明确错误
export function ensureCatalog(cwd, lang = 'zh-CN') {
  let catalog = loadCatalog();
  if (!catalog) {
    console.error(tr(lang, 'scan.catalogMissing'));
    runScan({ cwd, silent: true, lang });
    catalog = loadCatalog();
  }
  if (!catalog) throw new Error(tr(lang, 'scan.catalogLoadFailed'));
  return catalog;
}
