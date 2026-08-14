import fs from 'node:fs';
import path from 'node:path';

const LARGE_SKILL_MD_BYTES = 64 * 1024;
const LARGE_DIR_FILES = 1000;
const LARGE_DIR_BYTES = 50 * 1024 * 1024;

const SECRET_WORD = String.raw`(?:secret|token|api[_ -]?key|password|passwd|credential|private[_ -]?key|\.env|密钥|私钥|令牌|密码|凭据)`;
const HIGH_SECRET_WORD = String.raw`(?:secret|api[_ -]?key|password|passwd|credential|private[_ -]?key|\.env|密钥|私钥|密码|凭据)`;

const SKILL_TEXT_RULES = [
  {
    ruleId: 'skill.secretExfiltration',
    severity: 'high',
    pattern: new RegExp(String.raw`(?:upload|send|post|exfiltrat|leak(?:s|ed|ing)?\b|外发|上传|发送|泄露|提交).{0,50}${HIGH_SECRET_WORD}|${HIGH_SECRET_WORD}.{0,50}(?:upload|send|post|exfiltrat|leak(?:s|ed|ing)?\b|外发|上传|发送|泄露|提交)`, 'iu'),
  },
  {
    ruleId: 'skill.secretAccess',
    severity: 'medium',
    pattern: new RegExp(String.raw`(?:read|open|collect|scan|读取|打开|收集|扫描).{0,40}${SECRET_WORD}|${SECRET_WORD}.{0,40}(?:read|open|collect|scan|读取|打开|收集|扫描)`, 'iu'),
  },
  {
    ruleId: 'skill.promptInjection',
    severity: 'medium',
    pattern: /ignore\s+(?:all\s+)?(?:previous|system|developer)\s+instructions|reveal\s+(?:the\s+)?system\s+prompt|忽略.{0,20}(?:系统|开发者|之前).{0,10}指令|泄露.{0,10}系统提示词/iu,
  },
  {
    ruleId: 'skill.destructiveCommand',
    severity: 'high',
    pattern: /rm\s+-rf\s+(?:\/|~|\$HOME|\*)|Remove-Item\b.{0,60}-Recurse\b.{0,60}-Force|format\s+[a-z]:|del\s+\/[sq]\s+[a-z]:\\|chmod\s+777|mkfs\.[a-z0-9]+/iu,
  },
  {
    ruleId: 'skill.remoteScript',
    severity: 'high',
    pattern: /(?:curl|wget|irm|iwr|Invoke-WebRequest)\b.{0,100}\|\s*(?:sh|bash|zsh|pwsh|powershell|iex|Invoke-Expression)\b/iu,
  },
  {
    ruleId: 'skill.encodedPowerShell',
    severity: 'high',
    pattern: /powershell(?:\.exe)?\s+(?:-enc|-encodedcommand)\b/iu,
  },
  {
    ruleId: 'skill.privilegedCommand',
    severity: 'medium',
    pattern: /sudo\s+(?:rm|chmod|chown|dd|mkfs|mount|tee|bash|sh)\b/iu,
  },
];

const RULE_TEXT = {
  'skill.secretExfiltration': {
    zh: ['疑似外发敏感信息', '复核该 skill 是否要求上传或发送 token、密钥、密码、.env 等敏感内容。'],
    en: ['Possible secret exfiltration', 'Review whether this skill asks to upload or send tokens, keys, passwords, .env content, or other secrets.'],
  },
  'skill.secretAccess': {
    zh: ['疑似读取敏感信息', '确认该 skill 是否确有必要读取密钥、私钥、凭据或 .env；默认不要授权读取。'],
    en: ['Possible secret access', 'Confirm whether this skill truly needs to read keys, private keys, credentials, or .env files.'],
  },
  'skill.promptInjection': {
    zh: ['疑似提示词注入', '复核是否包含忽略系统/开发者指令、泄露系统提示词等高风险描述。'],
    en: ['Possible prompt injection', 'Review wording that asks the assistant to ignore system/developer instructions or reveal system prompts.'],
  },
  'skill.destructiveCommand': {
    zh: ['疑似破坏性命令', '手动检查该命令是否会删除、格式化或大范围改写文件；不要直接执行。'],
    en: ['Possible destructive command', 'Manually inspect whether this command deletes, formats, or broadly rewrites files; do not run it blindly.'],
  },
  'skill.remoteScript': {
    zh: ['疑似远程脚本直连执行', '避免 curl/wget 管道直连 shell；先下载、审阅并固定版本。'],
    en: ['Possible remote script execution', 'Avoid piping curl/wget output directly into a shell; download, review, and pin versions first.'],
  },
  'skill.encodedPowerShell': {
    zh: ['疑似编码 PowerShell', '编码命令不透明，建议先解码审阅后再决定是否保留该 skill。'],
    en: ['Possible encoded PowerShell', 'Encoded commands are opaque; decode and review before keeping this skill.'],
  },
  'skill.privilegedCommand': {
    zh: ['疑似高权限命令', '高权限操作应逐条确认影响范围，避免在 skill 中默认执行。'],
    en: ['Possible privileged command', 'Privileged operations should be reviewed line by line before they are allowed in a skill.'],
  },
  'skill.missingFrontmatter': {
    zh: ['缺少 frontmatter', '补齐 name/description，提升可审计性、搜索和推荐质量。'],
    en: ['Missing frontmatter', 'Add name/description frontmatter to improve auditability, search, and recommendation quality.'],
  },
  'skill.missingDescription': {
    zh: ['缺少 description', '补齐 description，避免无法判断 skill 的真实用途。'],
    en: ['Missing description', 'Add a description so the skill purpose can be reviewed.'],
  },
  'skill.largeSkillMd': {
    zh: ['SKILL.md 过大', '正文过大时应拆分引用文件，降低常驻审阅成本并方便安全复核。'],
    en: ['Large SKILL.md', 'Split large instructions into referenced files to reduce review cost and make security checks easier.'],
  },
  'skill.largeDirectory': {
    zh: ['skill 目录过大', '目录体积或文件数异常时建议检查是否误放缓存、构建产物或大仓库软链。'],
    en: ['Large skill directory', 'Check whether cache files, build outputs, or a large repository symlink were placed under the skill directory.'],
  },
  'skill.symlink': {
    zh: ['软链安装', '软链本身不是风险；确认真实路径来源可信，避免指向可被他人改写的位置。'],
    en: ['Symlink install', 'A symlink is not a risk by itself; confirm the real target is trusted and not writable by others.'],
  },
  'mcp.secretInCommand': {
    zh: ['MCP 启动命令疑似携带密钥', '避免把 token/API key/password 放在命令行参数中；优先使用安全的本地凭据机制。'],
    en: ['MCP command may contain secrets', 'Avoid putting tokens, API keys, or passwords in command-line arguments; prefer a safer local credential mechanism.'],
  },
  'mcp.insecureHttp': {
    zh: ['MCP 使用明文 HTTP', '远程 MCP 应使用 HTTPS；仅本机回环地址可按低风险处理。'],
    en: ['MCP uses plain HTTP', 'Remote MCP endpoints should use HTTPS; localhost loopback can be treated as lower risk.'],
  },
  'mcp.shellEval': {
    zh: ['MCP 启动命令经过 shell 求值', 'shell -c 或管道执行会扩大注入面，建议改成直接命令和固定参数。'],
    en: ['MCP command uses shell evaluation', 'shell -c or piped execution expands injection surface; prefer direct commands with fixed arguments.'],
  },
  'mcp.remoteRunner': {
    zh: ['MCP 使用动态包运行器', 'npx/uvx/bunx 等会在启动时解析包；建议固定版本并复核来源。'],
    en: ['MCP uses a dynamic package runner', 'npx/uvx/bunx resolve packages at launch; pin versions and review the source.'],
  },
  'mcp.privilegedContainer': {
    zh: ['MCP 容器权限过高', '避免 --privileged 或挂载宿主根目录；改用最小权限与精确目录挂载。'],
    en: ['MCP container is over-privileged', 'Avoid --privileged or mounting the host root; use least privilege and narrow mounts.'],
  },
  'mcp.trustedWithoutConfirm': {
    zh: ['MCP 配置为免确认信任', '确认来源可信后再使用免确认配置；不确定时改回需要确认。'],
    en: ['MCP is trusted without confirmation', 'Only use trust/always-allow settings for sources you have reviewed.'],
  },
};

export function auditSkillSecurity(text, skill) {
  const findings = auditSkillText(text, skill, 'SKILL.md');
  findings.push(...auditSkillMetadata(skill));
  return findings;
}

export function auditSkillDirectory(dir, skill, skillText = null) {
  const findings = [];
  const root = path.resolve(dir);
  const mainText = skillText ?? safeReadText(path.join(root, 'SKILL.md')) ?? '';
  findings.push(...auditSkillText(mainText, skill, 'SKILL.md'));
  findings.push(...auditSkillMetadata(skill));

  for (const file of auditableFiles(root)) {
    if (file.relative === 'SKILL.md') continue;
    const text = safeReadText(file.full);
    if (text != null) findings.push(...auditSkillText(text, skill, file.relative));
  }
  return findings;
}

export function auditSkillMetadata(skill) {
  const findings = [];
  if (skill.hasFrontmatter === false) findings.push(finding({ ruleId: 'skill.missingFrontmatter', severity: 'low', targetType: 'skill', skill }));
  if (!String(skill.description || '').trim()) findings.push(finding({ ruleId: 'skill.missingDescription', severity: 'low', targetType: 'skill', skill }));
  if ((skill.skillMdBytes || 0) >= LARGE_SKILL_MD_BYTES) findings.push(finding({ ruleId: 'skill.largeSkillMd', severity: 'low', targetType: 'skill', skill, evidence: `${skill.skillMdBytes} bytes` }));
  if ((skill.fileCount || 0) >= LARGE_DIR_FILES || (skill.totalBytes || 0) >= LARGE_DIR_BYTES) {
    findings.push(finding({ ruleId: 'skill.largeDirectory', severity: 'info', targetType: 'skill', skill, evidence: `${skill.fileCount || 0} files / ${skill.totalBytes || 0} bytes` }));
  }
  if (skill.isSymlink) findings.push(finding({ ruleId: 'skill.symlink', severity: 'info', targetType: 'skill', skill }));
  return findings;
}

export function auditMcpSecurity(server) {
  const findings = [];
  const command = String(server.command || '');
  const redacted = redactCommand(command);
  if (redacted !== command) findings.push(finding({ ruleId: 'mcp.secretInCommand', severity: 'high', targetType: 'mcp', mcp: server, evidence: redacted }));
  if (usesInsecureHttp(command)) {
    findings.push(finding({ ruleId: 'mcp.insecureHttp', severity: isLocalHttp(command) ? 'low' : 'medium', targetType: 'mcp', mcp: server, evidence: redactCommand(command) }));
  }
  if (/(?:\|\s*(?:sh|bash|zsh|pwsh|powershell|iex|Invoke-Expression)\b)|\b(?:sh|bash|cmd|powershell|pwsh)\s+(?:-c|\/c)\b/iu.test(command)) {
    findings.push(finding({ ruleId: 'mcp.shellEval', severity: 'high', targetType: 'mcp', mcp: server, evidence: redacted }));
  }
  if (/\b(?:npx|uvx|pipx|bunx|pnpx)\b|\byarn\s+dlx\b/iu.test(command)) {
    findings.push(finding({ ruleId: 'mcp.remoteRunner', severity: 'info', targetType: 'mcp', mcp: server, evidence: redacted }));
  }
  if (/docker\s+run\b(?=.*(?:--privileged|(?:-v|--volume)\s+\/:))/iu.test(command)) {
    findings.push(finding({ ruleId: 'mcp.privilegedContainer', severity: 'medium', targetType: 'mcp', mcp: server, evidence: redacted }));
  }
  if (server.trusted === true || server.alwaysAllow === true) {
    findings.push(finding({ ruleId: 'mcp.trustedWithoutConfirm', severity: 'medium', targetType: 'mcp', mcp: server }));
  }
  return findings;
}

export function collectSecurityReport(catalog) {
  const skillFindings = [];
  for (const skill of catalog.skills || []) {
    if (Array.isArray(skill.securityFindings)) {
      skillFindings.push(...skill.securityFindings);
    } else {
      skillFindings.push(...auditSkillMetadata(skill));
    }
  }
  const mcpFindings = (catalog.mcpServers || []).flatMap(auditMcpSecurity);
  const findings = [...skillFindings, ...mcpFindings].sort(compareSeverity);
  return {
    summary: summarizeFindings(findings),
    findings,
  };
}

export function summarizeFindings(findings) {
  const summary = { high: 0, medium: 0, low: 0, info: 0, total: 0 };
  for (const item of findings || []) {
    if (summary[item.severity] != null) summary[item.severity]++;
    summary.total++;
  }
  return summary;
}

export function formatSecuritySummary(summary, lang = 'zh-CN') {
  const s = summary || {};
  if (lang === 'en') return `high ${s.high || 0} / medium ${s.medium || 0} / low ${s.low || 0} / info ${s.info || 0}`;
  return `高 ${s.high || 0} / 中 ${s.medium || 0} / 低 ${s.low || 0} / 信息 ${s.info || 0}`;
}

export function localizeSecurityFinding(item, lang = 'zh-CN') {
  const text = RULE_TEXT[item.ruleId]?.[lang === 'en' ? 'en' : 'zh'] || [item.ruleId, ''];
  return {
    title: text[0],
    recommendation: text[1],
  };
}

export function severityRank(severity) {
  return { high: 0, medium: 1, low: 2, info: 3 }[severity] ?? 4;
}

export function redactCommand(command) {
  return String(command || '')
    .replace(/((?:--?(?:api[-_]?key|token|password|passwd|secret|credential)|[A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD)[A-Z0-9_]*)=)([^\s'"]+)/giu, '$1<redacted>')
    .replace(/(--?(?:api[-_]?key|token|password|passwd|secret|credential)\s+)([^\s'"]+)/giu, '$1<redacted>')
    .replace(/(bearer\s+)([A-Za-z0-9._~+/=-]+)/giu, '$1<redacted>');
}

function auditSkillText(text, skill, targetFile) {
  const findings = [];
  for (const rule of SKILL_TEXT_RULES) {
    const match = String(text || '').match(rule.pattern);
    if (match) findings.push(finding({ ruleId: rule.ruleId, severity: rule.severity, targetType: 'skill', skill, targetFile, evidence: cleanEvidence(match[0]) }));
  }
  return findings;
}

function auditableFiles(root) {
  const out = [];
  const walk = (dir, relative = '') => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!relative && entry.name === '.git') continue;
      const rel = path.join(relative, entry.name);
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile() && isAuditableFile(entry.name, full)) out.push({ full, relative: rel.split(path.sep).join('/') });
    }
  };
  walk(root);
  return out;
}

function isAuditableFile(name, file) {
  const ext = path.extname(name).toLowerCase();
  const allowed = new Set(['.md', '.txt', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.sh', '.bash', '.zsh', '.ps1', '.cmd', '.bat', '.json', '.yaml', '.yml', '.toml']);
  if (!allowed.has(ext) && !['Dockerfile', 'Makefile'].includes(name)) return false;
  try {
    return fs.statSync(file).size <= 2 * 1024 * 1024;
  } catch {
    return false;
  }
}

function safeReadText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function finding({ ruleId, severity, targetType, skill, mcp, targetFile = '', evidence = '' }) {
  const target = skill || mcp || {};
  return {
    severity,
    ruleId,
    targetType,
    targetName: target.dirName || target.name || '',
    tool: target.tool || '',
    scope: target.scope || '',
    targetFile,
    evidence,
  };
}

function compareSeverity(a, b) {
  return severityRank(a.severity) - severityRank(b.severity) || String(a.targetName).localeCompare(String(b.targetName));
}

function cleanEvidence(text) {
  return redactCommand(String(text || '').replace(/\s+/g, ' ').trim()).slice(0, 120);
}

function usesInsecureHttp(command) {
  return /\bhttp:\/\//iu.test(command);
}

function isLocalHttp(command) {
  try {
    const url = String(command).match(/\bhttp:\/\/[^\s'"]+/iu)?.[0];
    if (!url) return false;
    const host = new URL(url).hostname;
    return ['localhost', '127.0.0.1', '::1'].includes(host);
  } catch {
    return false;
  }
}
