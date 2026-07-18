import fs from 'node:fs';
import { RULES_PATH } from './paths.js';

// 规则按顺序匹配，命中即停：先前缀（最可靠），再关键词（名称+描述）。
// 单个 skill 的精确归类走 overrides（内置 DEFAULT_OVERRIDES + 用户 rules.json 的 overrides，用户优先），
// 不要把具体 skill 名混进有序规则表——排序靠前的宽泛关键词会把它们静默截胡。
export const DEFAULT_OVERRIDES = {
  'skill-navigator': 'Skill 开发与管理',
  'skill-creator': 'Skill 开发与管理',
  'nuwa-skill': 'Skill 开发与管理',
  'darwin-skill': 'Skill 开发与管理',
  'template-skill': 'Skill 开发与管理',
  'release-skills': 'Skill 开发与管理',
  'yueban-image-to-code': '设计与 UI',
  'kb-retriever': '数据与图谱',
  'file-organizer': '研发辅助',
  'changelog-generator': '研发辅助',
  'connect-apps': '第三方服务集成',
};

export const DEFAULT_RULES = [
  { category: '办公协作（飞书）', prefixes: ['lark-'] },
  { category: '前端动画（GSAP）', prefixes: ['gsap-', 'animejs'] },
  { category: 'Skill 开发与管理', keywords: ['skill 开发', 'create skills', 'how to find and use skills'] },
  { category: 'Agent 工作流', keywords: ['subagent', 'superpowers', 'worktree', 'parallel agents', 'implementation plan', 'dispatching', 'requesting-code-review', 'claim work is complete', 'concise plan'] },
  { category: '小程序开发', keywords: ['小程序', 'miniprogram', 'weapp', 'uni-app', 'taro', 'skyline'] },
  { category: '发布分发', prefixes: ['baoyu-post-'], keywords: ['post-to', 'post to wechat', 'weibo', '公众号', '发布到'] },
  { category: '内容抓取与转换', keywords: ['url-to', 'to-markdown', 'markdown-to', 'transcript', 'summary', 'extract', 'format-markdown', '抓取', '转成', 'html 转', 'electron-extract', 'gemini-web'] },
  { category: '演示文稿（PPT/Slides）', keywords: ['ppt', 'slide', 'slides', 'presentation', 'deck', '演示文稿', 'keynote'] },
  { category: '图像与视觉', keywords: ['image', 'comic', 'illustrator', 'cover', 'infographic', 'xhs-images', 'poster', '图像', '图片', '插图', '封面', '海报', 'compress-image', 'photo'] },
  { category: '设计与 UI', keywords: ['design', ' ui ', 'ui-', 'ux', 'pencil', 'figma', '界面设计', 'component'] },
  { category: '动画与视频', keywords: ['hyperframes', 'lottie', 'animation', 'keyframe', 'gif', 'video', '视频', '动画', 'three.js', 'webgl'] },
  { category: '第三方服务集成', keywords: ['composio', 'linear', 'notion', 'sentry', 'datadog', 'stripe', 'supabase', 'vercel', 'jira', 'slack', 'gitlab', 'helium'] },
  { category: '翻译与写作', prefixes: ['writing-'], keywords: ['translate', 'translation', '翻译', 'writer', '文案', '写作'] },
  { category: '商务与文书', keywords: ['email', 'resume', '简历', '邮件', 'internal comms', 'lead', 'domain name', 'support ticket'] },
  { category: '数据与图谱', keywords: ['graph', 'knowledge', '知识图谱', '知识库', 'dataviz', 'chart', '图谱', 'diagram', 'drawio'] },
  { category: '研发辅助', keywords: ['codex', 'code review', 'refactor', 'debug', 'test', 'migrate', '代码', 'github', 'deploy', 'issue', 'pr ', 'ci ', 'changelog', 'downloader'] },
];

export const FALLBACK_CATEGORY = '未分类';

export function loadRules() {
  let userRules = [];
  let userOverrides = {};
  try {
    const data = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
    if (Array.isArray(data.rules)) userRules = data.rules;
    if (data.overrides && typeof data.overrides === 'object') userOverrides = data.overrides;
  } catch {
    /* 没有用户规则文件时用默认规则 */
  }
  return { rules: [...userRules, ...DEFAULT_RULES], overrides: { ...DEFAULT_OVERRIDES, ...userOverrides } };
}

export function classify(skill, { rules, overrides }) {
  if (overrides[skill.dirName]) return overrides[skill.dirName];
  const dirName = skill.dirName.toLowerCase();
  // 关键词匹配面向 名称+描述，前后加空格便于匹配 " ui " 这类带边界的词
  const haystack = ` ${skill.dirName} ${skill.name} ${skill.description} `.toLowerCase();
  for (const rule of rules) {
    if ((rule.prefixes || []).some((p) => dirName.startsWith(p.toLowerCase()))) return rule.category;
    if ((rule.keywords || []).some((k) => haystack.includes(k.toLowerCase()))) return rule.category;
  }
  return FALLBACK_CATEGORY;
}
