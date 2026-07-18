import { scanClaudeCode } from '../adapters/claudeCode.js';
import { scanCodex } from '../adapters/codex.js';
import { loadRules, classify } from '../classify.js';
import { saveCatalog, loadCatalog, mergeByDirName, CATALOG_REL } from '../catalog.js';

// silent 模式：汇总走 stderr，保证 --json 消费方的 stdout 干净（兜底重扫场景）
export function runScan({ cwd, json = false, verbose = false, silent = false }) {
  const print = silent ? console.error : console.log;
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
  const catSummary = [...byCat.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c} ${n}`)
    .join(' | ');

  const line = (tool, label) => {
    const list = skills.filter((s) => s.tool === tool);
    const scopes = ['user', 'project', 'plugin']
      .map((sc) => [sc, list.filter((s) => s.scope === sc).length])
      .filter(([, n]) => n > 0)
      .map(([sc, n]) => `${{ user: '用户', project: '项目', plugin: '插件' }[sc]} ${n}`)
      .join(' / ');
    const mcp = mcpServers.filter((s) => s.tool === tool).length;
    print(`  ${label}skill ${list.length}（${scopes || '无'}），MCP ${mcp}`);
  };

  print('扫描完成 ✓');
  line('claude-code', 'Claude Code：');
  line('codex', 'Codex：      ');
  print(`  去重后共 ${merged.length} 个 skill，其中 ${both} 个在两侧同名安装`);
  // 分侧统计：每侧的常驻开销是该侧实际加载条目的 name+description 之和
  const tokensFor = (tool) => skills.filter((s) => s.tool === tool).reduce((sum, s) => sum + s.descTokens, 0);
  print(`  常驻上下文开销估算（name+description）：Claude 约 ${tokensFor('claude-code')} token，Codex 约 ${tokensFor('codex')} token`);
  print(`  分类分布：${catSummary}`);
  if (catalog.archived['claude-code'] + catalog.archived.codex > 0) {
    print(`  已归档目录（_ 或 . 开头，未计入）：claude ${catalog.archived['claude-code']}，codex ${catalog.archived.codex}`);
  }
  if (warnings.length) {
    print(`  警告 ${warnings.length} 条${verbose ? '：' : '（--verbose 查看）'}`);
    if (verbose) for (const w of warnings) print(`    - ${w}`);
  }
  print(`目录已写入 ${CATALOG_REL}`);
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
