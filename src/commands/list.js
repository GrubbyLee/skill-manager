import { mergeByDirName, toolLabel } from '../catalog.js';
import { renderTable, termWidth } from '../table.js';
import { ensureCatalog } from './scan.js';
import { groupBy, fmtDateTime } from '../utils.js';

export function runList({ cwd, tool, category, scope, mcp = false, json = false, raw = false }) {
  const catalog = ensureCatalog(cwd);

  if (mcp) return listMcp(catalog, { tool, json });

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
    console.log(`\n【${cat}】（${list.length}）`);
    const rows = list
      .sort((a, b) => a.dirName.localeCompare(b.dirName))
      .map((it) => raw
        ? [it.dirName, toolLabel(it.tools), it.scope, it.description || '（无描述）']
        : [it.dirName, toolLabel(it.tools), it.description || '（无描述）']);
    const cols = raw
      ? [{ title: '名称', width: 30 }, { title: '工具', width: 6 }, { title: '范围', width: 7 }, { title: '描述', width: 0 }]
      : [{ title: '名称', width: 30 }, { title: '工具', width: 6 }, { title: '描述', width: 0 }];
    console.log(renderTable(cols, rows, width));
  }
  console.log(`\n共 ${items.length} 个 skill（扫描时间：${fmtDateTime(catalog.scannedAt)}，过期可重新 skm scan）`);
}

function listMcp(catalog, { tool, json }) {
  let servers = catalog.mcpServers;
  if (tool) servers = servers.filter((s) => shortTool(s.tool) === shortTool(tool));
  if (json) {
    console.log(JSON.stringify(servers, null, 2));
    return;
  }
  const rows = servers.map((s) => [s.name, shortTool(s.tool), s.scope, s.transport, s.command]);
  console.log(renderTable(
    [
      { title: '名称', width: 20 },
      { title: '工具', width: 7 },
      { title: '范围', width: 8 },
      { title: '传输', width: 6 },
      { title: '启动命令 / URL', width: 0 },
    ],
    rows,
    termWidth(),
  ));
  console.log(`\n共 ${servers.length} 个 MCP server。提示：MCP 的 tool schema 会全量注入上下文，是启动开销的大头。`);
}

function shortTool(t) {
  return t.replace('claude-code', 'claude');
}
