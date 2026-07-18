import { mergeByDirName, toolLabel } from '../catalog.js';
import { renderTable, termWidth } from '../table.js';
import { ensureCatalog } from './scan.js';

const TOP = 15;

// 关键词搜索：在 名称/分类/描述 中匹配，按相关度排序（名称命中权重最高）
export function runSearch({ cwd, keywords, json = false }) {
  if (!keywords.length) {
    console.error('用法：skm search <关键词> [更多关键词]');
    process.exitCode = 1;
    return;
  }
  const catalog = ensureCatalog(cwd);
  const merged = mergeByDirName(catalog.skills);
  const terms = keywords.map((k) => k.toLowerCase());

  const scored = merged
    .map((m) => {
      const name = `${m.dirName} ${m.name}`.toLowerCase();
      const category = m.category.toLowerCase();
      const desc = m.description.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (name.includes(t)) score += 3;
        else if (category.includes(t)) score += 2;
        else if (desc.includes(t)) score += 1;
      }
      return { m, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP);

  if (json) {
    console.log(JSON.stringify(scored.map(({ m, score }) => ({
      dirName: m.dirName, category: m.category, tools: m.tools, description: m.description, score,
    })), null, 2));
    return;
  }

  if (!scored.length) {
    console.log(`没有匹配"${keywords.join(' ')}"的 skill，可尝试换关键词或 skm list 浏览分类。`);
    return;
  }
  console.log(renderTable(
    [{ title: '名称', width: 30 }, { title: '工具', width: 6 }, { title: '分类', width: 18 }, { title: '描述', width: 0 }],
    scored.map(({ m }) => [m.dirName, toolLabel(m.tools), m.category, m.description || '（无描述）']),
    termWidth(),
  ));
  console.log(`\n共 ${scored.length} 个结果（按相关度排序）`);
}
