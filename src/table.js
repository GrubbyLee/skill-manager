// 终端对齐输出：中文等全角字符按宽度 2 计算，保证表格不错位；测量前剥离 ANSI 颜色序列
const ANSI_RE = /\[[0-9;]*m/g;

export function displayWidth(str) {
  let w = 0;
  for (const ch of String(str).replace(ANSI_RE, '')) w += charWidth(ch.codePointAt(0));
  return w;
}

function charWidth(cp) {
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3ffff)
  ) {
    return 2;
  }
  return 1;
}

// 截断到指定显示宽度，超出以 … 结尾
export function truncate(str, width) {
  if (displayWidth(str) <= width) return str;
  let out = '';
  let w = 0;
  for (const ch of str) {
    const cw = charWidth(ch.codePointAt(0));
    if (w + cw > width - 1) break;
    out += ch;
    w += cw;
  }
  return out + '…';
}

export function pad(str, width) {
  const gap = width - displayWidth(str);
  return gap > 0 ? str + ' '.repeat(gap) : str;
}

// 渲染简单对齐表格。cols: [{ title, width }]，最后一列自动吃掉剩余宽度并截断。
export function renderTable(cols, rows, totalWidth) {
  const fixed = cols.slice(0, -1).reduce((sum, c) => sum + c.width + 2, 0);
  const lastWidth = Math.max(16, totalWidth - fixed - 2);
  const widths = [...cols.slice(0, -1).map((c) => c.width), lastWidth];
  const lines = [];
  lines.push(cols.map((c, i) => pad(truncate(c.title, widths[i]), widths[i])).join('  '));
  lines.push(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const row of rows) {
    lines.push(row.map((cell, i) => pad(truncate(String(cell ?? ''), widths[i]), widths[i])).join('  '));
  }
  return lines.join('\n');
}

export function termWidth() {
  return process.stdout.columns || 120;
}
