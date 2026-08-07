import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import vm from 'node:vm';
import { createWebServer, isAllowedHost, isAllowedOrigin, parseWebArgs, renderWebHtml, skillSourceUrls } from '../src/commands/web.js';

test('web：页面包含三主题、3D 加载动画与只读 API 入口', () => {
  const html = renderWebHtml('zh-CN');
  assert.match(html, /data-lang-target="zh-CN"/);
  assert.match(html, /data-lang-target="en"/);
  assert.match(html, /data-theme-target="cyberpunk"/);
  assert.match(html, /data-theme-target="galaxy"/);
  assert.match(html, /data-theme-target="sky"/);
  assert.match(html, /class="cube"/);
  assert.match(html, /class="face f1"/);
  assert.match(html, /rel="icon" href="\/favicon\.svg"/);
  assert.match(html, /id="graph-canvas"/);
  assert.match(html, /id="graph-insights"/);
  assert.equal((html.match(/class="skill-page-summary"/g) || []).length, 2);
  assert.equal((html.match(/data-skill-page="prev"/g) || []).length, 2);
  assert.equal((html.match(/data-skill-page="next"/g) || []).length, 2);
  assert.match(html, /id="skill-usage-filter"/);
  assert.match(html, /data-skill-sort="usage"/);
  assert.match(html, /data-skill-sort="context"/);
  assert.match(html, /<script src="\/app\.js"><\/script>/);
  assert.doesNotMatch(html, /<script>\s*const state/);
  assert.doesNotMatch(html, /id="domains"/);
});

test('web：Skill 来源地址去重、兼容 git remote 并脱敏凭据', () => {
  const sources = skillSourceUrls({
    entries: [
      { upstream: { source: 'https://example.com/skill', repository: 'https://example.com/repo', urls: ['https://example.com/skill'] } },
      { upstream: { git: { remote: 'git@example.com:org/repo.git' }, homepage: 'https://user:secret@example.com/docs?token=abc' } },
    ],
  });
  assert.deepEqual(sources, [
    'https://example.com/skill',
    'https://example.com/repo',
    'https://REDACTED@example.com/docs?token=REDACTED',
    'git@example.com:org/repo.git',
  ]);
});

test('web：参数解析支持引号且拒绝未闭合引号', () => {
  assert.deepEqual(parseWebArgs('--category "图像 视觉" --raw'), ['--category', '图像 视觉', '--raw']);
  assert.deepEqual(parseWebArgs("'two words' plain"), ['two words', 'plain']);
  assert.deepEqual(parseWebArgs('C:\\Users\\demo\\skills'), ['C:\\Users\\demo\\skills']);
  assert.throws(() => parseWebArgs('--category "未闭合'), /引号未闭合/);
});

test('web：英文页面文案可渲染', () => {
  const html = renderWebHtml('en');
  assert.match(html, /skill-manager Web Console/);
  assert.match(html, /Cyberpunk/);
  assert.match(html, /Galaxy/);
  assert.match(html, /Sky/);
  assert.match(html, /data-lang-target="zh-CN"/);
  assert.match(html, /data-lang-target="en"/);
});

test('web：仅允许本机 Host 访问', () => {
  assert.equal(isAllowedHost('127.0.0.1:17361', 17361), true);
  assert.equal(isAllowedHost('localhost:17361', 17361), true);
  assert.equal(isAllowedHost('[::1]:17361', 17361), true);
  assert.equal(isAllowedHost('attacker.example:17361', 17361), false);
});

test('web：API 仅接受本机 Origin', () => {
  assert.equal(isAllowedOrigin('', 17361), true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:17361', 17361), true);
  assert.equal(isAllowedOrigin('http://localhost:17361', 17361), true);
  assert.equal(isAllowedOrigin('http://localhost', 17361), false);
  assert.equal(isAllowedOrigin('https://127.0.0.1:17361', 17361), false);
  assert.equal(isAllowedOrigin('http://attacker.example:17361', 17361), false);
});

test('web：非法 Host / Origin / 跨站 API 请求返回 403', async () => {
  const port = 17361;
  const server = createWebServer({ cwd: process.cwd(), lang: 'en', port });
  await listen(server);
  const address = server.address();
  try {
    const validPage = await request(address.port, '/', { Host: `127.0.0.1:${port}` });
    assert.equal(validPage.status, 200);
    assert.match(validPage.body, /skill-manager Web Console/);

    const client = await request(address.port, '/app.js', { Host: `127.0.0.1:${port}` });
    assert.equal(client.status, 200);
    assert.doesNotThrow(() => new vm.Script(client.body));
    assert.match(client.body, /\/api\/dashboard/);
    assert.match(client.body, /\/api\/run/);
    assert.match(client.body, /skillPageSize: 10/);
    assert.match(client.body, /skillSortKey: 'usage'/);
    assert.match(client.body, /skillUsageFilter: 'all'/);
    assert.match(client.body, /skm-web-lang/);
    assert.match(client.body, /data-lang-target/);
    assert.match(client.body, /searchParams\.set\('lang'/);
    assert.match(client.body, /skill-name/);
    assert.match(client.body, /showSkillTooltip/);
    assert.match(client.body, /graphScopeOptions/);
    assert.match(client.body, /graph-scope-select/);
    assert.match(client.body, /data-focus-node/);
    assert.doesNotMatch(client.body, /renderDomains\(\)/);

    const favicon = await request(address.port, '/favicon.ico', { Host: `127.0.0.1:${port}` });
    assert.equal(favicon.status, 200);
    assert.match(favicon.body, /<svg/);

    const badHost = await request(address.port, '/', { Host: `attacker.example:${port}` });
    assert.equal(badHost.status, 403);
    assert.match(badHost.body, /forbidden_host/);

    const badOrigin = await request(address.port, '/api/dashboard', { Host: `127.0.0.1:${port}`, Origin: `http://attacker.example:${port}` });
    assert.equal(badOrigin.status, 403);
    assert.match(badOrigin.body, /forbidden_origin/);

    const crossSite = await request(address.port, '/api/dashboard', { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'cross-site' });
    assert.equal(crossSite.status, 403);
    assert.match(crossSite.body, /forbidden_origin/);

    const forbiddenCommand = await request(address.port, '/api/run?cmd=disable', { Host: `127.0.0.1:${port}` });
    assert.equal(forbiddenCommand.status, 400);
    assert.match(forbiddenCommand.body, /command_not_allowed/);

    const forbiddenFlag = await request(address.port, '/api/run?cmd=scan&args=--output%20report.json', { Host: `127.0.0.1:${port}` });
    assert.equal(forbiddenFlag.status, 400);
    assert.match(forbiddenFlag.body, /flag_not_allowed/);

    const unsafeClean = await request(address.port, '/api/run?cmd=sessions&args=--clean%20--days%2030', { Host: `127.0.0.1:${port}` });
    assert.equal(unsafeClean.status, 400);
    assert.match(unsafeClean.body, /flag_not_allowed/);
  } finally {
    await close(server);
  }
});

test('web：命令执行入口不依赖当前工作目录', async () => {
  const port = 17361;
  const server = createWebServer({ cwd: os.tmpdir(), lang: 'en', port });
  await listen(server);
  const address = server.address();
  try {
    const result = await request(address.port, '/api/run?cmd=doctor', { Host: `127.0.0.1:${port}` });
    assert.equal(result.status, 200);
    const data = JSON.parse(result.body);
    assert.equal(data.command.startsWith('skm doctor'), true);
    assert.doesNotMatch(data.stderr, /Cannot find module|MODULE_NOT_FOUND/);
  } finally {
    await close(server);
  }
});

test('web：status 通过裸命令路径执行并返回 skm', async () => {
  const port = 17361;
  const server = createWebServer({ cwd: os.tmpdir(), lang: 'en', port });
  await listen(server);
  const address = server.address();
  try {
    const result = await request(address.port, '/api/run?cmd=status', { Host: `127.0.0.1:${port}` });
    assert.equal(result.status, 200);
    const data = JSON.parse(result.body);
    assert.equal(data.command, 'skm');
  } finally {
    await close(server);
  }
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function request(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}
