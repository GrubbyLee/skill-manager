import { estimateTokens } from './common.js';

// 不启动 MCP server，只按公开的 server 名称、transport 和启动命令做静态估算。
// 真正的 tool schema token 会随 server 暴露工具数量变化；该字段用于排序和风险提示。
export function estimateMcpTokens({ name, transport, command }) {
  return estimateTokens(`${name || ''} ${transport || ''} ${command || ''}`);
}
