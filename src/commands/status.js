import { scanUsage } from '../usage.js';
import { buildSessionIndex } from '../sessionsIndex.js';
import { ensureCatalog } from './scan.js';
import { tr } from '../i18n.js';
import { buildOverview, renderOverview } from '../overview.js';
export { computeHealthScore } from '../health.js';

// skm 裸命令 = 治理总览：按 scan/risks/audit/outdated/sources/dupes/graph/sessions 分域展示摘要与下一步。
export function runStatus({ cwd, json = false, lang = 'zh-CN' }) {
  const catalog = ensureCatalog(cwd, lang);

  console.error(tr(lang, 'status.loading'));
  const usage = scanUsage({ log: (msg) => console.error(msg), lang });
  const sessions = buildSessionIndex();
  const overview = buildOverview({ catalog, usage, sessions, lang: json ? 'zh-CN' : lang });

  if (json) {
    console.log(JSON.stringify(overview, null, 2));
    return;
  }
  console.log(renderOverview(overview, lang));
}
