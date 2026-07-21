import { mergeByDirName, toolLabel } from '../catalog.js';
import { renderTable, termWidth } from '../table.js';
import { ensureCatalog } from './scan.js';
import { tr } from '../i18n.js';

const TOP = 15;

// 关键词搜索：在 名称/分类/描述 中匹配，按相关度排序（名称命中权重最高）
export function runSearch({ cwd, keywords, json = false, lang = 'zh-CN' }) {
  if (!keywords.length) {
    console.error(tr(lang, 'search.usage'));
    process.exitCode = 1;
    return;
  }
  const catalog = ensureCatalog(cwd, lang);
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
    console.log(tr(lang, 'search.noMatch', { query: keywords.join(' ') }));
    return;
  }
  console.log(renderTable(
    [{ title: tr(lang, 'search.col.name'), width: 30 }, { title: tr(lang, 'search.col.tool'), width: 6 }, { title: tr(lang, 'search.col.category'), width: 18 }, { title: tr(lang, 'search.col.description'), width: 0 }],
    scored.map(({ m }) => [m.dirName, localizedToolLabel(m.tools, lang), m.category, m.description || tr(lang, 'list.noDescription')]),
    termWidth(),
  ));
  console.log(`\n${tr(lang, 'search.summary', { count: scored.length })}`);
}

function localizedToolLabel(tools, lang) {
  const label = toolLabel(tools);
  return label === '两侧' ? tr(lang, 'tool.both') : label;
}
