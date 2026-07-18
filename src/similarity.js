// 文本相似度：用于"名字不同但功能疑似重叠"的检测。
// 词元化：连续拉丁字母/数字为一个词；CJK 逐字并两两组 bigram（中文短文本上比单字更有区分度）。
export function tokenize(text) {
  const tokens = new Set();
  const lower = text.toLowerCase();
  for (const word of lower.match(/[a-z0-9]+/g) || []) {
    if (word.length > 1) tokens.add(word);
  }
  const cjkChars = lower.match(/[⺀-鿿豈-﫿]/g) || [];
  for (let i = 0; i < cjkChars.length; i++) {
    tokens.add(cjkChars[i]);
    if (i + 1 < cjkChars.length) tokens.add(cjkChars[i] + cjkChars[i + 1]);
  }
  return tokens;
}

export function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
