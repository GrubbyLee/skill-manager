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

// 合并同名 skill（多数是 claude/codex 双份安装），供 list/dupes 展示"去重后的清单"。
// 对缺失字段做防御：catalog.json 可能被外部编辑或来自不兼容版本
export function mergeByDirName(skills) {
  const map = new Map();
  for (const s of skills) {
    const desc = typeof s.description === 'string' ? s.description : '';
    let m = map.get(s.dirName);
    if (!m) {
      m = { ...s, description: desc, tools: [], entries: [] };
      map.set(s.dirName, m);
    }
    if (!m.tools.includes(s.tool)) m.tools.push(s.tool);
    m.entries.push(s);
    // 描述优先取更长的那份（信息量更大）
    if (desc.length > m.description.length) m.description = desc;
  }
  return [...map.values()];
}

export function toolLabel(tools) {
  if (tools.length > 1) return '两侧';
  return tools[0] === 'claude-code' ? 'claude' : tools[0];
}

// 实体双份：同名多处安装且并非软链共享同一实体。
// status / audit / dupes 三处共用同一谓词，保证"多少组双份"口径一致；
// realPath 缺失（外部编辑过的 catalog）时退回 path 判断，避免假阳性/假阴性
export function isDupEntity(m) {
  return m.entries.length > 1 && new Set(m.entries.map((e) => e.realPath ?? e.path)).size > 1;
}

export const CATALOG_REL = path.join('~', '.skill-manager', 'catalog.json');
