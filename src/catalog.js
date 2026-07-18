import path from 'node:path';
import { CATALOG_PATH } from './paths.js';
import { loadJsonFile, saveJsonFile } from './utils.js';

export function saveCatalog(catalog) {
  saveJsonFile(CATALOG_PATH, catalog, { pretty: true });
}

// 结构校验：形状不对（外部编辑/版本变更）视同缺失，让调用方走重扫兜底，而不是后续崩溃
export function loadCatalog() {
  const c = loadJsonFile(CATALOG_PATH);
  if (!c || !Array.isArray(c.skills) || !Array.isArray(c.mcpServers)) return null;
  return c;
}

// 合并同名 skill（多数是 claude/codex 双份安装），供 list/dupes 展示"去重后的清单"
export function mergeByDirName(skills) {
  const map = new Map();
  for (const s of skills) {
    let m = map.get(s.dirName);
    if (!m) {
      m = { ...s, tools: [], entries: [] };
      map.set(s.dirName, m);
    }
    if (!m.tools.includes(s.tool)) m.tools.push(s.tool);
    m.entries.push(s);
    // 描述优先取更长的那份（信息量更大）
    if (s.description.length > m.description.length) m.description = s.description;
  }
  return [...map.values()];
}

export function toolLabel(tools) {
  if (tools.length > 1) return '两侧';
  return tools[0] === 'claude-code' ? 'claude' : tools[0];
}

export const CATALOG_REL = path.join('~', '.skill-manager', 'catalog.json');
