// 健康分（0-100，启发式）：僵尸率最高扣 40，实体双份每组扣 1（上限 20），
// 闲置 MCP 每个扣 5（上限 15），会话日志每 GB 扣 10（上限 15）
export function computeHealthScore({ zombieRate, dupGroups, idleMcp, logBytes }) {
  let score = 100;
  score -= Math.round(zombieRate * 40);
  score -= Math.min(20, dupGroups);
  score -= Math.min(15, idleMcp * 5);
  score -= Math.min(15, Math.round((logBytes / 1e9) * 10));
  return Math.max(0, score);
}
