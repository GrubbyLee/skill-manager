import { isDupEntity } from './catalog.js';

// 清理建议生成（status 仪表盘与 audit 报告共用，保证两处命令与口径完全一致）。
// 返回 tips: [{ text, command, note }]，着色由调用方决定；
// 省略号等提示信息放在 note 里而非命令内部，用户整段复制命令不会带入非法参数
export function buildCleanupTips({ merged, usageOf, idleMcp }) {
  const tips = [];
  const dupSet = new Set(merged.filter(isDupEntity).map((m) => m.dirName));
  const primary = merged
    .filter((m) => usageOf(m).count === 0 && dupSet.has(m.dirName))
    .map((m) => m.dirName);
  if (primary.length) {
    tips.push({
      text: `双份且从未使用 ${primary.length} 个，最优先清理`,
      command: `skm disable ${primary.slice(0, 5).join(' ')}`,
      note: primary.length > 5 ? `（先清前 5 个，完整清单见 skm audit --json）` : '',
    });
  }
  if (idleMcp.length) {
    tips.push({ text: '禁用闲置 MCP', command: `skm disable --mcp ${idleMcp.join(' ')}`, note: '' });
  }
  return { tips, primary };
}

// 闲置 MCP 判定：使用信号只来自 Claude 侧日志，因此只对 Claude 侧配置的 server 下"闲置"结论；
// 仅 Codex 侧配置的 server 无法观测，绝不能据此建议禁用
export function findIdleMcp(mcpServers, usage) {
  const claudeNames = [...new Set(mcpServers.filter((s) => s.tool === 'claude-code').map((s) => s.name))];
  const codexOnly = [...new Set(mcpServers.filter((s) => s.tool !== 'claude-code').map((s) => s.name))]
    .filter((n) => !claudeNames.includes(n));
  return {
    idle: claudeNames.filter((n) => !(usage.mcp[n]?.count > 0)),
    unobservable: codexOnly,
  };
}
