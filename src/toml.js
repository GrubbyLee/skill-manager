import { stripQuotes } from './utils.js';

// 极简 TOML 解析：只覆盖 Codex config.toml 中 MCP 配置用到的语法
// （[section]、key = 字符串/布尔/数字/一维数组），不是完整 TOML 实现。
export function parseTomlSections(text) {
  const sections = { '': {} };
  let cur = '';
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    // 表头允许行尾注释：[section] # 说明
    const sec = line.match(/^\[([^\]]+)\]\s*(#.*)?$/);
    if (sec) {
      cur = sec[1].trim().replace(/"/g, '');
      sections[cur] ??= {};
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (kv) sections[cur][kv[1]] = parseValue(kv[2]);
  }
  return sections;
}

function parseValue(v) {
  v = v.trim();
  if (v.startsWith('[')) {
    // 按词法切分数组元素：引号字符串（内部可含逗号/空格）或裸词，避免裸逗号切分劈坏带逗号的参数
    const inner = v.slice(1, v.lastIndexOf(']') === -1 ? v.length : v.lastIndexOf(']'));
    const tokens = inner.match(/"(?:[^"\\]|\\.)*"|'[^']*'|[^,\s]+/g) || [];
    return tokens.map((t) => stripQuotes(t));
  }
  // 引号字符串：只取引号内内容，行尾内联注释（command = "npx" # runner）自然被丢弃
  const quoted = v.match(/^"((?:[^"\\]|\\.)*)"|^'([^']*)'/);
  if (quoted) return quoted[1] ?? quoted[2];
  // 非引号标量：剥离行尾注释后再判定类型
  v = v.split('#')[0].trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}
