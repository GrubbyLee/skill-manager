const INSTALL_COMMANDS = {
  npmLink: {
    posix: { command: 'npm', args: ['link'] },
    windows: 'npm.cmd link',
  },
  skmHelp: {
    posix: { command: 'skm', args: ['help'] },
    windows: 'skm.cmd help',
  },
};

export function installCommand(name, { platform = process.platform, env = process.env } = {}) {
  const spec = INSTALL_COMMANDS[name];
  if (!spec) throw new Error(`未知安装命令：${name}`);

  if (platform !== 'win32') return spec.posix;

  return {
    command: env.ComSpec || env.COMSPEC || 'cmd.exe',
    args: ['/d', '/s', '/c', spec.windows],
  };
}

export function spawnFailureDetail(result, lang) {
  const details = [];
  const english = lang === 'en';

  if (result.status !== null && result.status !== undefined) {
    details.push(english ? `exit code ${result.status}` : `退出码 ${result.status}`);
  }
  if (result.signal) details.push(english ? `signal ${result.signal}` : `信号 ${result.signal}`);
  if (result.error) {
    const code = result.error.code ? `${result.error.code}: ` : '';
    details.push(english ? `spawn error ${code}${result.error.message}` : `启动错误 ${code}${result.error.message}`);
  }

  return details.join('; ') || (english ? 'unknown process failure' : '未知进程错误');
}
