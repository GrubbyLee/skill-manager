import { stripQuotes } from './utils.js';

// frontmatter 分隔线：容忍行尾空白（编辑器常见残留），闭合线后可为换行或 EOF
const FM_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;

// 解析 SKILL.md 顶部的 YAML frontmatter。
// 只支持 skill 元数据实际会用到的子集：key: value、引号字符串、> / | 折叠块、超长值缩进续行。
export function parseFrontmatter(text) {
  const m = text.match(FM_RE);
  if (!m) return { data: {}, hasFrontmatter: false };

  const data = {};
  let curKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^\s/.test(line) ? null : line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      const [, key, rawVal] = kv;
      curKey = key;
      // 折叠块/字面块起始符：值在后续缩进行里
      data[key] = /^[>|][+-]?$/.test(rawVal.trim()) ? '' : stripQuotes(rawVal.trim());
    } else if (curKey && /^\s+\S/.test(line)) {
      data[curKey] = (data[curKey] ? data[curKey] + ' ' : '') + line.trim();
    }
  }
  return { data, hasFrontmatter: true };
}

// 无 frontmatter 或 description 缺失时，从正文取第一段非标题文本兜底
export function fallbackDescription(text, maxLen = 200) {
  const body = text.replace(FM_RE, '');
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('<') || line.startsWith('```') || /^-{3,}$/.test(line)) continue;
    return line.length > maxLen ? line.slice(0, maxLen) + '…' : line;
  }
  return '';
}
