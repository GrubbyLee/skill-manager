import { mergeByDirName, isDupEntity } from '../catalog.js';
import { tokenize, jaccard } from '../similarity.js';
import { ensureCatalog } from './scan.js';
import { groupBy, paint } from '../utils.js';
import { tr } from '../i18n.js';

const SIMILAR_THRESHOLD = 0.4;
const SIMILAR_TOP = 15;

// 四级重复检测：
//   1. 同名多处安装（多为 claude/codex 双份）—— 区分软链共享与实体双份
//   2. 名字不同但 SKILL.md 内容哈希相同 —— 纯复制
//   3. 同类多实现 —— 同一分类下存在多个不同家族的 skill，做同一件事需二选一
//   4. 名称+描述文本高度相似 —— 疑似换名复制
export function runDupes({ cwd, json = false, lang = 'zh-CN' }) {
  const catalog = ensureCatalog(cwd, lang);
  const skills = catalog.skills;
  const merged = mergeByDirName(skills);

  // 一级：同名。软链共享同一实体的并非真正重复（与 status/audit 的"实体双份"用同一谓词）
  const sameName = merged
    .filter((m) => m.entries.length > 1)
    .map((m) => ({
      dirName: m.dirName,
      shared: !isDupEntity(m),
      identical: new Set(m.entries.map((e) => e.skillMdHash)).size === 1,
      installs: m.entries.map((e) => ({ tool: e.tool, scope: e.scope, path: e.path, realPath: e.realPath, hash: e.skillMdHash })),
    }));

  // 二级：异名同内容（同一 realPath 的软链只算一份）
  const byHash = new Map();
  const seenReal = new Set();
  for (const s of skills) {
    if (seenReal.has(s.realPath)) continue;
    seenReal.add(s.realPath);
    if (!byHash.has(s.skillMdHash)) byHash.set(s.skillMdHash, []);
    byHash.get(s.skillMdHash).push(s);
  }
  const sameContent = [...byHash.values()]
    .filter((list) => new Set(list.map((s) => s.dirName)).size > 1)
    .map((list) => list.map((s) => ({ dirName: s.dirName, tool: s.tool, path: s.path })));

  // 三级：同类多实现。家族 = 目录名第一段（baoyu-xxx → baoyu）。
  // 同一家族内的多个 skill（如 lark-*、gsap-*）是有意拆分的套件，不算重叠；
  // 不同家族落在同一分类里，才是"做同一类事的多套实现"。
  const overlapCategories = [];
  for (const [category, list] of groupBy(merged, (m) => m.category)) {
    if (category === '未分类') continue;
    const families = groupBy(list, (m) => m.dirName.split('-')[0]);
    if (families.size >= 2 && list.length >= 3) {
      overlapCategories.push({
        category,
        count: list.length,
        families: [...families.entries()].map(([family, members]) => ({ family, members: members.map((m) => m.dirName) })),
      });
    }
  }
  overlapCategories.sort((a, b) => b.count - a.count);

  // 四级：文本高度相似（疑似换名复制）
  const withDesc = merged.filter((m) => m.description);
  const tokenCache = withDesc.map((m) => tokenize(`${m.dirName} ${m.name} ${m.description}`));
  const similar = [];
  for (let i = 0; i < withDesc.length; i++) {
    for (let j = i + 1; j < withDesc.length; j++) {
      const score = jaccard(tokenCache[i], tokenCache[j]);
      if (score >= SIMILAR_THRESHOLD) {
        similar.push({ a: withDesc[i].dirName, b: withDesc[j].dirName, score: Number(score.toFixed(2)) });
      }
    }
  }
  similar.sort((x, y) => y.score - x.score);
  const similarTop = similar.slice(0, SIMILAR_TOP);

  if (json) {
    console.log(JSON.stringify({ sameName, sameContent, categoryOverlap: overlapCategories, similar: similarTop }, null, 2));
    return;
  }

  console.log(tr(lang, 'dupes.sameNameTitle', { count: sameName.length }));
  if (!sameName.length) console.log(tr(lang, 'dupes.none'));
  for (const g of sameName) {
    const where = g.installs.map((i) => `${i.tool === 'claude-code' ? 'claude' : i.tool}/${i.scope}`).join(' + ');
    const verdict = g.shared
      ? paint.green(tr(lang, 'dupes.shared'))
      : g.identical
        ? paint.yellow(tr(lang, 'dupes.identical'))
        : paint.red(tr(lang, 'dupes.different'));
    console.log(`  ${g.dirName}  [${where}]  ${verdict}`);
  }

  console.log(`\n${tr(lang, 'dupes.sameContentTitle', { count: sameContent.length })}`);
  if (!sameContent.length) console.log(tr(lang, 'dupes.none'));
  for (const list of sameContent) {
    console.log(`  ${list.map((s) => s.dirName).join(' = ')}`);
    for (const s of list) console.log(`    - ${s.path}`);
  }

  console.log(`\n${tr(lang, 'dupes.categoryTitle', { count: overlapCategories.length })}`);
  if (!overlapCategories.length) console.log(tr(lang, 'dupes.none'));
  for (const oc of overlapCategories) {
    const familyDesc = oc.families
      .map((f) => (f.members.length > 1 ? tr(lang, 'dupes.familyCount', { family: f.family, count: f.members.length }) : f.members[0]))
      .join(' | ');
    console.log(tr(lang, 'dupes.categoryLine', { category: oc.category, count: oc.count, families: familyDesc }));
  }

  console.log(`\n${tr(lang, 'dupes.similarTitle', { threshold: SIMILAR_THRESHOLD, top: SIMILAR_TOP })}`);
  if (!similarTop.length) console.log(tr(lang, 'dupes.none'));
  for (const p of similarTop) {
    console.log(`  ${(p.score * 100).toFixed(0)}%  ${p.a}  ↔  ${p.b}`);
  }
  if (similar.length > SIMILAR_TOP) console.log(tr(lang, 'dupes.moreSimilar', { count: similar.length - SIMILAR_TOP }));

  console.log(`\n${tr(lang, 'dupes.note')}`);
}
