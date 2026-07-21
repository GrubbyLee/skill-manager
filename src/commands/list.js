import { mergeByDirName, toolLabel } from '../catalog.js';
import { renderTable, termWidth } from '../table.js';
import { ensureCatalog } from './scan.js';
import { groupBy, fmtDateTime } from '../utils.js';
import { tr } from '../i18n.js';

export function runList({ cwd, tool, category, scope, mcp = false, json = false, raw = false, lang = 'zh-CN' }) {
  const catalog = ensureCatalog(cwd, lang);

  if (mcp) return listMcp(catalog, { tool, json, lang });

  let skills = catalog.skills;
  if (tool) skills = skills.filter((s) => shortTool(s.tool) === shortTool(tool));
  if (scope) skills = skills.filter((s) => s.scope === scope);
  if (category) skills = skills.filter((s) => s.category.toLowerCase().includes(category.toLowerCase()));

  // 默认合并两侧同名 skill，一行一个能力；--raw 查看逐条安装记录
  const items = raw
    ? skills.map((s) => ({ ...s, tools: [s.tool] }))
    : mergeByDirName(skills);

  if (json) {
    console.log(JSON.stringify(items.map(({ entries, ...rest }) => rest), null, 2));
    return;
  }

  const byCat = groupBy(items, (it) => it.category);
  const width = termWidth();
  for (const [cat, list] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${tr(lang, 'list.categoryTitle', { category: cat, count: list.length })}`);
    const rows = list
      .sort((a, b) => a.dirName.localeCompare(b.dirName))
      .map((it) => raw
        ? [it.dirName, localizedToolLabel(it.tools, lang), it.scope, it.description || tr(lang, 'list.noDescription')]
        : [it.dirName, localizedToolLabel(it.tools, lang), it.description || tr(lang, 'list.noDescription')]);
    const cols = raw
      ? [{ title: tr(lang, 'list.col.name'), width: 30 }, { title: tr(lang, 'list.col.tool'), width: 6 }, { title: tr(lang, 'list.col.scope'), width: 7 }, { title: tr(lang, 'list.col.description'), width: 0 }]
      : [{ title: tr(lang, 'list.col.name'), width: 30 }, { title: tr(lang, 'list.col.tool'), width: 6 }, { title: tr(lang, 'list.col.description'), width: 0 }];
    console.log(renderTable(cols, rows, width));
  }
  console.log(`\n${tr(lang, 'list.summary', { count: items.length, scannedAt: fmtDateTime(catalog.scannedAt) })}`);
}

function listMcp(catalog, { tool, json, lang }) {
  let servers = catalog.mcpServers;
  if (tool) servers = servers.filter((s) => shortTool(s.tool) === shortTool(tool));
  if (json) {
    console.log(JSON.stringify(servers, null, 2));
    return;
  }
  const rows = servers.map((s) => [s.name, shortTool(s.tool), s.scope, s.transport, s.command]);
  console.log(renderTable(
    [
      { title: tr(lang, 'list.col.name'), width: 20 },
      { title: tr(lang, 'list.col.tool'), width: 7 },
      { title: tr(lang, 'list.col.scope'), width: 8 },
      { title: tr(lang, 'list.col.transport'), width: 9 },
      { title: tr(lang, 'list.col.command'), width: 0 },
    ],
    rows,
    termWidth(),
  ));
  console.log(`\n${tr(lang, 'list.mcpSummary', { count: servers.length })}`);
}

function shortTool(t) {
  return t.replace('claude-code', 'claude');
}

function localizedToolLabel(tools, lang) {
  const label = toolLabel(tools);
  return label === '两侧' ? tr(lang, 'tool.both') : label;
}
