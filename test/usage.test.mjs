import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanCodexFile } from '../src/usage.js';

test('Codex 使用统计：同一会话同一 skill 只计一次，并维护观察窗口', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skm-usage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'session.jsonl');
  const lines = [
    {
      type: 'response_item',
      timestamp: '2026-07-18T10:00:00Z',
      payload: {
        type: 'function_call',
        arguments: '{"cmd":"sed -n 1,80p /home/u/.codex/skills/foo/SKILL.md"}',
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-07-18T12:00:00Z',
      payload: {
        type: 'function_call',
        arguments: '{"cmd":"sed -n 1,80p /home/u/.codex/skills/foo/SKILL.md"}',
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-07-18T11:00:00Z',
      payload: {
        type: 'function_call',
        arguments: '{"cmd":"sed -n 1,80p /home/u/.codex/skills/nested/bar/SKILL.md"}',
      },
    },
    {
      type: 'response_item',
      timestamp: '2026-07-18T09:00:00Z',
      payload: {
        type: 'message',
        text: '/home/u/.codex/skills/not-used/SKILL.md',
      },
    },
  ];
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n'));

  const result = scanCodexFile(file);
  assert.deepEqual(result.skills.foo, { count: 1, lastUsed: '2026-07-18T12:00:00Z' });
  assert.deepEqual(result.skills.bar, { count: 1, lastUsed: '2026-07-18T11:00:00Z' });
  assert.equal(result.skills['not-used'], undefined);
  assert.equal(result.earliest, '2026-07-18T10:00:00Z');
});
