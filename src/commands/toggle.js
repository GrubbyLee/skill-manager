import fs from 'node:fs';
import path from 'node:path';
import { loadCatalog } from '../catalog.js';
import { runScan } from './scan.js';
import { confirm, fileStamp, loadJsonFile, saveJsonFile } from '../utils.js';
import { DATA_DIR, CLAUDE_SKILLS_DIR, CODEX_SKILLS_DIR, CLAUDE_CONFIG_FILE, CODEX_CONFIG_FILE } from '../paths.js';

const DISABLED_PREFIX = '_disabled-';
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MCP_STORE = path.join(DATA_DIR, 'mcp-disabled.json');

// skill 软禁用：目录改名加 _disabled- 前缀（扫描器会忽略 _ 开头目录，AIDE 也不再加载），完全可逆。
// MCP 禁用：Claude 侧从 ~/.claude.json 移出配置存入本工具存储；Codex 侧对 config.toml 行级注释。均先备份。
export async function runDisable(opts) {
  if (opts.mcp) return toggleMcp(opts, true);
  return toggleSkills(opts, true);
}

export async function runEnable(opts) {
  if (opts.mcp) return toggleMcp(opts, false);
  return toggleSkills(opts, false);
}

async function toggleSkills({ cwd, names }, disable) {
  const roots = [
    { dir: CLAUDE_SKILLS_DIR, label: 'claude/user' },
    { dir: path.join(cwd, '.claude', 'skills'), label: 'claude/project' },
    { dir: CODEX_SKILLS_DIR, label: 'codex/user' },
  ];

  if (!names.length) {
    // 无参数：disable 提示用法；enable 列出当前已禁用的
    const disabled = [];
    for (const r of roots) {
      for (const ent of safeReaddir(r.dir)) {
        if (ent.startsWith(DISABLED_PREFIX)) disabled.push(`${ent.slice(DISABLED_PREFIX.length)}（${r.label}）`);
      }
    }
    if (disable) {
      console.error('用法：skm disable <skill名> [更多名称] 或 skm disable --mcp <名称>');
      process.exitCode = 1;
    } else if (disabled.length) {
      console.log(`当前已禁用 ${disabled.length} 个 skill：\n  ${disabled.join('\n  ')}`);
      console.log('\n恢复：skm enable <skill名>');
    } else {
      console.log('当前没有被 skm 禁用的 skill。');
    }
    return;
  }

  const catalog = loadCatalog();
  let changed = 0;
  for (const name of names) {
    let found = false;
    for (const r of roots) {
      const from = path.join(r.dir, disable ? name : DISABLED_PREFIX + name);
      const to = path.join(r.dir, disable ? DISABLED_PREFIX + name : name);
      if (!exists(from)) continue;
      found = true;
      if (exists(to)) {
        console.error(`  跳过 ${r.label}/${name}：目标已存在（${to}）`);
        continue;
      }
      fs.renameSync(from, to);
      changed++;
      console.log(`  ${disable ? '已禁用' : '已恢复'} ${r.label}/${name}`);
    }
    if (!found) {
      const plugin = catalog?.skills?.find((s) => s.dirName === name && s.scope === 'plugin');
      if (plugin && disable) console.error(`  ${name}：属于插件（${plugin.source}），请通过插件管理卸载，skm 不做处理`);
      else console.error(`  未找到：${name}${disable ? '' : '（它可能没被禁用过）'}`);
    }
  }
  if (changed) {
    console.log('\n重新扫描目录…');
    runScan({ cwd });
  }
}

async function toggleMcp({ cwd, names, yes }, disable) {
  if (!names.length) {
    console.error(`用法：skm ${disable ? 'disable' : 'enable'} --mcp <名称>`);
    process.exitCode = 1;
    return;
  }
  const action = disable ? '禁用' : '恢复';
  console.log(`将${action} MCP：${names.join('、')}（会修改 AIDE 配置文件，修改前自动备份到 ${BACKUP_DIR}）`);
  if (!(await confirm('确认执行？输入 yes 继续，其他任意键取消：', { yes }))) return;

  let touchedAny = false;
  for (const name of names) {
    let touched = false;

    // Claude 侧：~/.claude.json 的 mcpServers
    if (exists(CLAUDE_CONFIG_FILE)) {
      const store = loadStore();
      const config = JSON.parse(fs.readFileSync(CLAUDE_CONFIG_FILE, 'utf8'));
      if (disable && config.mcpServers?.[name]) {
        const backupPath = backupFile(CLAUDE_CONFIG_FILE, `claude.json.${name}`);
        store.claude[name] = config.mcpServers[name];
        delete config.mcpServers[name];
        fs.writeFileSync(CLAUDE_CONFIG_FILE, JSON.stringify(config, null, 2));
        saveStore(store);
        console.log(`  claude：已从 ~/.claude.json 移除 ${name}（配置已存入 ${MCP_STORE}，备份：${backupPath}）`);
        touched = true;
        touchedAny = true;
      } else if (!disable && store.claude[name]) {
        // 用户已手动重新添加过同名配置时不覆盖；若两者内容一致则顺手清理暂存，避免残留
        if (config.mcpServers?.[name]) {
          if (JSON.stringify(config.mcpServers[name]) === JSON.stringify(store.claude[name])) {
            delete store.claude[name];
            saveStore(store);
            console.log(`  claude：~/.claude.json 中已有与暂存一致的 ${name} 配置，已清理暂存`);
          } else {
            console.error(`  claude：~/.claude.json 已存在 ${name} 配置且与暂存不同，跳过恢复以免覆盖（暂存仍保留在 ${MCP_STORE}）`);
          }
          touched = true;
          touchedAny = true;
        } else {
          const backupPath = backupFile(CLAUDE_CONFIG_FILE, `claude.json.${name}`);
          config.mcpServers ??= {};
          config.mcpServers[name] = store.claude[name];
          delete store.claude[name];
          fs.writeFileSync(CLAUDE_CONFIG_FILE, JSON.stringify(config, null, 2));
          saveStore(store);
          console.log(`  claude：已恢复 ${name} 到 ~/.claude.json（备份：${backupPath}）`);
          touched = true;
          touchedAny = true;
        }
      }
    }

    // Codex 侧：config.toml 行级注释（#skm# 前缀），不重写文件其他内容
    if (exists(CODEX_CONFIG_FILE)) {
      const text = fs.readFileSync(CODEX_CONFIG_FILE, 'utf8');
      const result = toggleTomlSection(text, name, disable);
      if (result.touched > 0) {
        const backupPath = backupFile(CODEX_CONFIG_FILE, `config.toml.${name}`);
        fs.writeFileSync(CODEX_CONFIG_FILE, result.text);
        console.log(`  codex：已${action} config.toml 中的 [mcp_servers.${name}]（${result.touched} 行，备份：${backupPath}）`);
        touched = true;
        touchedAny = true;
      }
    }

    if (!touched) console.error(`  ${name}：两侧均未找到${disable ? '' : '可恢复的'}该 MCP 配置`);
  }
  if (touchedAny) {
    console.log('\n重新扫描目录…');
    try {
      runScan({ cwd });
    } catch (e) {
      console.error(`目录刷新失败：${e.message}。MCP 配置已修改，可稍后手动运行 skm scan。`);
    }
  }
  console.log(`\n注意：MCP 变更对已打开的 AIDE 会话不生效，重启 claude / codex 后生效。`);
}

// 注释/取消注释 [mcp_servers.<name>] 及其子表（如 .env）的所有行
export function toggleTomlSection(text, name, disable) {
  const lines = text.split('\n');
  let inBlock = false;
  let touched = 0;
  for (let i = 0; i < lines.length; i++) {
    const clean = lines[i].startsWith('#skm# ') ? lines[i].slice(6) : lines[i];
    // 表头允许行尾注释（[section] # 说明），否则会漏判块边界、把无关节一并注释
    const header = clean.trim().match(/^\[([^\]]+)\]\s*(#.*)?$/);
    if (header) {
      const section = header[1].replace(/"/g, '');
      inBlock = section === `mcp_servers.${name}` || section.startsWith(`mcp_servers.${name}.`);
    } else if (/^#+\s*\[[^\]]+\]/.test(clean.trim())) {
      // 用户手工注释掉的表头（# [other]）同样视为块边界终止，避免其后的行被连带处理
      inBlock = false;
    }
    if (!inBlock || lines[i].trim() === '') continue;
    if (disable && !lines[i].startsWith('#skm# ')) {
      lines[i] = '#skm# ' + lines[i];
      touched++;
    } else if (!disable && lines[i].startsWith('#skm# ')) {
      lines[i] = lines[i].slice(6);
      touched++;
    }
  }
  return { text: lines.join('\n'), touched };
}

// 每次备份独立命名（含 MCP 名 + 秒级本地时间戳），同名存在时追加序号——
// 保证一次命令禁用多个、或同一秒内连续操作时，改动前的原始状态各自都有备份
function backupFile(file, label) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const base = path.join(BACKUP_DIR, `${label}.${fileStamp()}`);
  let target = base;
  for (let i = 2; fs.existsSync(target); i++) target = `${base}-${i}`;
  fs.copyFileSync(file, target);
  return target;
}

function loadStore() {
  const s = loadJsonFile(MCP_STORE) || {};
  s.claude ??= {};
  return s;
}

function saveStore(store) {
  saveJsonFile(MCP_STORE, store, { pretty: true });
}

function exists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}
