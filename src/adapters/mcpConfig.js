import { estimateMcpTokens } from './mcpCost.js';

export function pushJsonMcpServers(list, servers, { tool, scope, configFile }) {
  if (!servers || typeof servers !== 'object') return;
  for (const [name, cfg] of Object.entries(servers)) {
    if (!cfg || typeof cfg !== 'object') continue;
    const transport = cfg.type || cfg.transport || (cfg.httpUrl || cfg.url ? 'http' : 'stdio');
    const command = cfg.command ? [cfg.command, ...stringArgs(cfg.args)].join(' ') : cfg.httpUrl || cfg.url || '';
    list.push({
      name,
      tool,
      scope,
      transport,
      command,
      schemaTokens: estimateMcpTokens({ name, transport, command }),
      configFile,
      trusted: cfg.trust === true || cfg.trusted === true,
      alwaysAllow: cfg.alwaysAllow === true || cfg.always_allow === true,
    });
  }
}

function stringArgs(args) {
  return Array.isArray(args) ? args.map((arg) => String(arg)) : [];
}
