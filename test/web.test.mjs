import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createWebServer, isAllowedHost, isAllowedOrigin, renderWebHtml } from '../src/commands/web.js';

test('web：页面包含三主题、3D 加载动画与只读 API 入口', () => {
  const html = renderWebHtml('zh-CN');
  assert.match(html, /data-theme-target="cyberpunk"/);
  assert.match(html, /data-theme-target="galaxy"/);
  assert.match(html, /data-theme-target="sky"/);
  assert.match(html, /class="cube"/);
  assert.match(html, /class="face f1"/);
  assert.equal(html.includes('/api/dashboard'), true);
  assert.equal(html.includes('/api/recommend'), true);
});

test('web：英文页面文案可渲染', () => {
  const html = renderWebHtml('en');
  assert.match(html, /skill-manager Web Console/);
  assert.match(html, /Cyberpunk/);
  assert.match(html, /Galaxy/);
  assert.match(html, /Sky/);
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

    const badHost = await request(address.port, '/', { Host: `attacker.example:${port}` });
    assert.equal(badHost.status, 403);
    assert.match(badHost.body, /forbidden_host/);

    const badOrigin = await request(address.port, '/api/dashboard', { Host: `127.0.0.1:${port}`, Origin: `http://attacker.example:${port}` });
    assert.equal(badOrigin.status, 403);
    assert.match(badOrigin.body, /forbidden_origin/);

    const crossSite = await request(address.port, '/api/dashboard', { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'cross-site' });
    assert.equal(crossSite.status, 403);
    assert.match(crossSite.body, /forbidden_origin/);
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
