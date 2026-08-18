import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverSkillSources } from '../src/sourceDiscovery.js';

test('source discovery：只发送 skill 名称查询并验证 SKILL.md', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.startsWith('https://api.github.com/search/code')) {
      return response(JSON.stringify({ items: [{
        path: 'skills/demo/SKILL.md',
        download_url: 'https://raw.githubusercontent.com/acme/repo/main/skills/demo/SKILL.md',
        repository: { full_name: 'acme/repo', html_url: 'https://github.com/acme/repo', default_branch: 'main', name: 'repo' },
      }] }));
    }
    return response('---\nname: demo\nversion: 1.2.3\ndescription: Demo\n---\n');
  };

  const result = await discoverSkillSources('demo', { fetchImpl, githubToken: 'secret-token' });

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].source, 'https://github.com/acme/repo/tree/main/skills/demo');
  assert.equal(result.candidates[0].version, '1.2.3');
  assert.equal(result.candidates[0].evidence.matchedFrontmatterName, true);
  const searchUrl = new URL(requests[0].url);
  assert.equal(searchUrl.searchParams.get('q'), 'demo filename:SKILL.md');
  assert.match(requests[0].options.headers.authorization, /^Bearer /);
  assert.equal(requests[0].options.headers.authorization, 'Bearer secret-token');
  assert.ok(requests.some(({ url }) => url.includes('raw.githubusercontent.com')));
});

test('source discovery：无效或低相关候选不会进入保存列表', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/search/code')) return response(JSON.stringify({ items: [
      { path: 'docs/SKILL.md', repository: { full_name: 'acme/unrelated', html_url: 'https://github.com/acme/unrelated', default_branch: 'main', name: 'unrelated' }, download_url: 'https://raw.githubusercontent.com/acme/unrelated/main/docs/SKILL.md' },
      { path: 'README.md', repository: { full_name: 'acme/demo', html_url: 'https://github.com/acme/demo', default_branch: 'main', name: 'demo' }, download_url: 'https://raw.githubusercontent.com/acme/demo/main/README.md' },
    ] }));
    return response('---\nname: something-else\n---\n');
  };
  const result = await discoverSkillSources('demo', { fetchImpl, githubToken: 'token' });
  assert.deepEqual(result.candidates, []);
});

test('source discovery：无 token 时通过官方仓库搜索与文件树降级', async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url.includes('/search/repositories')) return response(JSON.stringify({ items: [{
      full_name: 'acme/skills', html_url: 'https://github.com/acme/skills', default_branch: 'main', name: 'skills',
    }] }));
    if (url.includes('/git/trees/')) return response(JSON.stringify({ tree: [
      { type: 'blob', path: 'demo/SKILL.md' },
      { type: 'blob', path: 'README.md' },
    ] }));
    return response('---\nname: demo\nversion: 1.0.0\n---\n');
  };
  const result = await discoverSkillSources('demo', { fetchImpl, githubToken: '' });
  assert.equal(result.query, '"demo" SKILL.md in:readme');
  assert.equal(result.candidates[0].source, 'https://github.com/acme/skills/tree/main/demo');
  assert.ok(requests.some((url) => url.includes('/search/repositories')));
  assert.ok(requests.every((url) => !url.includes('/search/code')));
});

test('source discovery：仓库文件树限流会明确失败而不是伪装成无结果', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/search/repositories')) return response(JSON.stringify({ items: [{
      full_name: 'acme/skills', html_url: 'https://github.com/acme/skills', default_branch: 'main', name: 'skills',
    }] }));
    return response(JSON.stringify({ message: 'API rate limit exceeded' }), 403);
  };
  await assert.rejects(
    discoverSkillSources('demo', { fetchImpl, githubToken: '' }),
    /rate limit/i,
  );
});

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}
