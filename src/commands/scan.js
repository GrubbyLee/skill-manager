import { scanClaudeCode } from '../adapters/claudeCode.js';
import { scanCodex } from '../adapters/codex.js';
import { loadRules, classify } from '../classify.js';
import { saveCatalog, loadCatalog, mergeByDirName, CATALOG_REL } from '../catalog.js';
import { renderTable, termWidth } from '../table.js';
import { paint, paintErr } from '../utils.js';

// silent 模式：汇总走 stderr，保证 --json 消费方的 stdout 干净（兜底重扫场景）
export function runScan({ cwd, json = false, verbose = false, silent = false }) {
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

  print(pal.green('扫描完成 ✓'));
  const width = termWidth();
  const claudeStats = skillStats('claude-code');
  const codexStats = skillStats('codex');

  print('\n扫描概览');
  print(renderTable(
    [
      { title: '工具', width: 12 },
      { title: 'skill', width: 6 },
      { title: '用户', width: 6 },
      { title: '项目', width: 6 },
      { title: '插件', width: 6 },
      { title: 'MCP', width: 5 },
      { title: '已归档', width: 8 },
      { title: '上下文估算', width: 0 },
    ],
    [
      ['Claude Code', claudeStats.skills, claudeStats.user, claudeStats.project, claudeStats.plugin, claudeStats.mcp, claudeStats.archived, `约 ${claudeStats.tokens} token`],
      ['Codex', codexStats.skills, codexStats.user, codexStats.project, codexStats.plugin, codexStats.mcp, codexStats.archived, `约 ${codexStats.tokens} token`],
    ],
    Math.min(width, 100),
  ));

  print('\n汇总');
  print(renderTable(
    [
      { title: '指标', width: 24 },
      { title: '数值', width: 0 },
    ],
    [
      ['去重后 skill', `${merged.length} 个`],
      ['两侧同名安装', `${both} 个`],
      ['解析警告', `${warnings.length} 条`],
      ['目录文件', CATALOG_REL],
    ],
    Math.min(width, 90),
  ));

  print('\n分类分布');
  print(renderTable(
    [
      { title: '分类', width: 24 },
      { title: '数量', width: 0 },
    ],
    [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => [c, `${n} 个`]),
    Math.min(width, 80),
  ));
  if (catalog.archived['claude-code'] + catalog.archived.codex > 0) {
    print('\n说明：已归档目录指名称以 _ 或 . 开头、扫描时未计入的目录。');
  }
  if (warnings.length) {
    print(pal.yellow(`  警告 ${warnings.length} 条${verbose ? '：' : '（--verbose 查看）'}`));
    if (verbose) for (const w of warnings) print(pal.yellow(`    - ${w}`));
  }
  print(`\n目录已写入 ${CATALOG_REL}`);
}

// 各命令的统一兜底：目录缺失/损坏 → 静默重扫（汇总走 stderr）→ 仍失败则抛出明确错误
export function ensureCatalog(cwd) {
  let catalog = loadCatalog();
  if (!catalog) {
    console.error('未找到有效目录文件，先执行扫描…');
    runScan({ cwd, silent: true });
    catalog = loadCatalog();
  }
  if (!catalog) throw new Error('无法加载或生成 skill 目录，请检查 ~/.skill-manager 的写权限后重试 skm scan');
  return catalog;
}
