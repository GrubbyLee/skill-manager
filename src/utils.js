import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { StringDecoder } from 'node:string_decoder';

export const DAY_MS = 86400e3;

// ---------- 时间：统一按 Asia/Shanghai 展示（数据层仍存 ISO/UTC） ----------
const TZ = 'Asia/Shanghai';

function tzParts(t) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null; // 脏时间戳不显示 "Invalid Date"
  // sv-SE locale 恰好输出 'YYYY-MM-DD HH:mm:ss'
  const s = d.toLocaleString('sv-SE', { timeZone: TZ });
  const [date, time] = s.split(' ');
  return { date, time };
}

export function fmtDay(t) {
  return (t == null ? null : tzParts(t)?.date) ?? '—';
}

export function fmtDateTime(t) {
  const p = t == null ? null : tzParts(t);
  return p ? `${p.date} ${p.time.slice(0, 5)}` : '—';
}

// 文件名安全的时间戳（本地时区，含秒）
export function fileStamp(t = Date.now()) {
  const p = tzParts(t);
  return `${p.date}T${p.time.replace(/:/g, '-')}`;
}

// 相对时间：按 Asia/Shanghai 的日历日计算（昨晚 23:30 在今晨查看应显示"昨天"而非"今天"）；
// 未来时间与脏数据回退到绝对日期
export function fmtAgo(t, nowMs = Date.now()) {
  if (t == null) return '—';
  const target = tzParts(t);
  if (!target) return '—';
  const days = Math.round((Date.parse(tzParts(nowMs).date) - Date.parse(target.date)) / DAY_MS);
  if (days < 0) return fmtDay(t);
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.min(11, Math.floor(days / 30))} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}

// ---------- 字节格式化 ----------
export function fmtBytes(n) {
  return n >= 1e9 ? (n / 1e9).toFixed(1) + 'GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'MB' : Math.round(n / 1e3) + 'KB';
}

// ---------- 终端颜色：按目标流独立判断（stdout/stderr 可能一个是 TTY 一个被重定向） ----------
function makePaint(stream) {
  const enabled = !!stream.isTTY && !process.env.NO_COLOR;
  const code = (n) => (s) => (enabled ? `\u001b[${n}m${s}\u001b[0m` : String(s));
  return { red: code(31), green: code(32), yellow: code(33), cyan: code(36), gray: code(90), bold: code(1) };
}
export const paint = makePaint(process.stdout);
export const paintErr = makePaint(process.stderr);

// ---------- 字符串 ----------
export function stripQuotes(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// ---------- 集合 ----------
export function groupBy(list, fn) {
  const map = new Map();
  for (const item of list) {
    const key = fn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

// ---------- 文件系统 ----------
// 递归收集指定后缀的文件（含 stat）；目录/文件均跟随软链（Dirent 方法不跟随，需补 stat 判断）
export function walkFiles(root, { ext = '.jsonl', maxDepth = 4 } = {}) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      const isDir = ent.isDirectory() || (ent.isSymbolicLink() && safeStatIsDir(p));
      if (isDir) walk(p, depth + 1);
      else if (ent.name.endsWith(ext)) {
        try {
          const st = fs.statSync(p);
          out.push({ path: p, size: st.size, mtimeMs: st.mtimeMs });
        } catch {
          /* 文件可能在扫描期间被删除，或为断链 */
        }
      }
    }
  };
  walk(root, 0);
  return out;
}

function safeStatIsDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false; // 断链
  }
}

// 同步流式逐行读取：1MB 块 + StringDecoder 处理多字节边界。
// 相比整文件 readFileSync：内存峰值为常数级，且不受 Node 字符串约 512MB 上限限制。
export function forEachLine(file, onLine) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    const decoder = new StringDecoder('utf8');
    let carry = '';
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length)) > 0) {
      const chunk = carry + decoder.write(buf.subarray(0, n));
      const lines = chunk.split('\n');
      carry = lines.pop();
      for (const line of lines) onLine(line);
    }
    const tail = carry + decoder.end();
    if (tail) onLine(tail);
  } finally {
    fs.closeSync(fd);
  }
}

// ---------- JSON 存储：原子写入（tmp + rename），避免写一半崩溃损坏缓存 ----------
export function loadJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function saveJsonFile(file, data, { pretty = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, pretty ? 2 : 0));
  fs.renameSync(tmp, file);
}

// ---------- 交互确认（sessions --clean 与 disable/enable --mcp 共用） ----------
export async function confirm(question, { yes = false } = {}) {
  if (yes) return true;
  if (!process.stdin.isTTY) {
    console.error('非交互环境需加 --yes 确认。');
    process.exitCode = 1;
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('已取消。');
    return false;
  }
  return true;
}
