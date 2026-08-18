(() => {
  'use strict';

  const LANG_STORAGE_KEY = 'skm-web-lang';
  const state = {
    data: null,
    labels: {},
    lang: 'zh-CN',
    skillFilter: '',
    skillUsageFilter: 'all',
    skillPage: 1,
    skillPageSize: 10,
    skillSortKey: 'usage',
    skillSortDirection: 'desc',
    sourceTooltipTimer: 0,
    cmdQuery: '',
    cmdGroup: 'all',
    cmdFavorites: new Set(),
    cmdTerminals: new Map(), // id -> { status, output }
    governance: { skill: null, sessionId: null, candidates: [], error: '', returnFocus: null },
    graph: {
      enabledTypes: new Set(),
      positions: new Map(),
      projected: [],
      query: '',
      selectedId: null,
      focusId: null,
      scopeId: null,
      rotationX: -0.18,
      rotationY: 0.35,
      zoom: 1,
      pointer: null,
      frame: 0,
    },
  };
  const initialLang = normalizeLang(document.documentElement.lang) || 'zh-CN';
  const url = new URL(window.location.href);
  const urlLang = normalizeLang(url.searchParams.get('lang'));
  const storedLang = normalizeLang(readStorage(LANG_STORAGE_KEY));
  if (!urlLang && storedLang && storedLang !== initialLang) {
    url.searchParams.set('lang', storedLang);
    window.location.replace(url.toString());
    return;
  }
  state.lang = urlLang || storedLang || initialLang;
  if (urlLang || !storedLang) writeStorage(LANG_STORAGE_KEY, state.lang);
  const initialLabel = (zhText, enText) => (state.lang === 'en' ? enText : zhText);

  const $ = (id) => document.getElementById(id);
  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return '';
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // 本地存储不可用时仍允许页面以当前 URL 的语言和主题继续运行。
    }
  }

  function normalizeLang(value) {
    const text = String(value || '').trim().toLowerCase();
    if (text === 'en' || text.startsWith('en-')) return 'en';
    if (text === 'zh' || text === 'zh-cn' || text.startsWith('zh-')) return 'zh-CN';
    return null;
  }
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
  const fmtDate = (value) => {
    if (!value) return '-';
    try { return new Date(value).toLocaleString(); } catch { return '-'; }
  };
  const pill = (text, cls = '') => `<span class="pill ${cls}">${esc(text)}</span>`;

  function setTheme(theme) {
    document.body.dataset.theme = theme;
    writeStorage('skm-web-theme', theme);
    document.querySelectorAll('.theme-btn').forEach((button) => {
      button.classList.toggle('active', button.dataset.themeTarget === theme);
      button.setAttribute('aria-pressed', String(button.dataset.themeTarget === theme));
    });
    scheduleGraph();
  }

  function setLanguage(lang) {
    const next = normalizeLang(lang) || 'zh-CN';
    if (next === state.lang) return;
    writeStorage(LANG_STORAGE_KEY, next);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set('lang', next);
    window.location.assign(nextUrl.toString());
  }

  function toast(message) {
    const element = $('toast');
    element.textContent = message;
    element.classList.add('show');
    window.setTimeout(() => element.classList.remove('show'), 1800);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast(state.labels.copied);
    } catch {
      toast(text);
    }
  }

  async function loadDashboard(refresh = false) {
    const labels = state.labels;
    $('loader-title').textContent = refresh ? labels.refreshingTitle || initialLabel('正在刷新清单', 'Refreshing inventory') : labels.loadingTitle || initialLabel('正在读取本机治理数据', 'Loading local governance data');
    $('loader-text').textContent = refresh ? labels.refreshingText || initialLabel('正在运行与 skm scan 相同的只读扫描路径。', 'Running the same read-only scan path as skm scan.') : labels.loadingText || initialLabel('正在读取 catalog、使用缓存、会话索引和图谱信号。不会修改 AIDE 文件。', 'Reading catalog, usage cache, session index, and graph signals. No AIDE files are modified.');
    const response = await fetch(apiUrl('/api/dashboard', refresh ? { refresh: '1' } : {}));
    if (!response.ok) throw new Error(await response.text());
    state.data = await response.json();
    state.labels = state.data.labels || {};
    initializeGraph();
    loadCmdFavorites();
    renderAll();
  }

  async function postJson(path, body) {
    const response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || result.error || state.labels.cmdError || 'Request failed');
    return result;
  }

  async function runVersionCheck(force = false) {
    const buttons = [$('version-check-btn'), $('version-refresh-btn')].filter(Boolean);
    buttons.forEach((button) => { button.disabled = true; });
    $('loader-title').textContent = state.labels.versionChecking;
    $('loader-text').textContent = state.labels.versionRefreshHint;
    try {
      const result = await postJson('/api/versions/check', { refresh: force });
      state.data = result.dashboard;
      state.labels = state.data.labels || state.labels;
      renderAll();
      const versions = state.data.overview?.domains?.versions || {};
      const incomplete = versions.unchecked || versions.failed || versions.unknown || versions.untracked;
      toast(incomplete ? state.labels.versionCheckIncomplete : state.labels.versionCheckDone);
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  function apiUrl(path, params = {}) {
    const url = new URL(path, window.location.origin);
    url.searchParams.set('lang', state.lang);
    Object.entries(params).forEach(([key, value]) => {
      if (value == null || value === '') return;
      url.searchParams.set(key, value);
    });
    return `${url.pathname}${url.search}`;
  }

  function renderAll() {
    renderTerminal();
    renderMetrics();
    renderSkills();
    renderGraphInsights();
    renderGraphFilters();
    renderGraphDetail();
    renderCommands();
    scheduleGraph();
  }

  function renderTerminal() {
    const data = state.data;
    $('terminal-lines').textContent = [
      '$ skm web',
      `> ${state.labels.terminalScore || initialLabel('得分', 'score')} ${data.overview.score}/100 · ${state.labels.terminalSkills || initialLabel('skill', 'skills')} ${data.overview.skills} · ${state.labels.terminalMcp || initialLabel('MCP', 'MCP')} ${data.overview.mcpServers}`,
      `> ${state.labels.terminalCatalog || initialLabel('目录', 'catalog')} ${fmtDate(data.catalog.scannedAt)}`,
      `> ${state.labels.localOnly}`,
    ].join('\n');
    $('loader-title').textContent = state.labels.readyTitle;
    $('loader-text').textContent = state.labels.readyText;
  }

  function metric(title, value, note, cls = '') {
    return `<article class="card metric"><b class="${cls}">${esc(value)}</b><span>${esc(title)}</span><p>${esc(note || '')}</p></article>`;
  }

  function renderMetrics() {
    const data = state.data;
    const health = data.report.health;
    const labels = state.labels;
    const versions = data.overview?.domains?.versions || {};
    $('overview').innerHTML = [
      metric(labels.healthScore, `${data.overview.score} / 100`, labels.scoreNote, data.overview.score >= 80 ? 'good' : data.overview.score >= 60 ? 'warn' : 'bad'),
      metric(labels.skillMetricTitle || initialLabel('Skill 总量', 'Skills'), data.overview.skills, labels.skillMetric),
      metric(labels.mcpMetricTitle || initialLabel('MCP 总量', 'MCP servers'), data.overview.mcpServers, labels.mcpMetric),
      metric(labels.neverUsed, health.neverUsed, labels.neverUsedNote),
      metric(labels.duplicates, health.duplicateInstalls, labels.duplicateNote),
      metric(labels.sessionBytes, bytes(health.sessionBytes), labels.sessionNote),
      metric(labels.reclaimable, bytes(health.reclaimableBytes), labels.reclaimNote),
      metric(labels.security, [data.catalog.security.high, data.catalog.security.medium, data.catalog.security.low].join(' / '), labels.securityNote),
      metric(labels.versionState, `${versions.outdated || 0} / ${versions.diverged || 0}`, `${labels.versionOutdated} / ${labels.versionDiverged}`),
    ].join('');
  }

  function bytes(value) {
    const size = Number(value) || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
    return `${(size / 1024 ** 3).toFixed(1)} GB`;
  }

  function renderSkills() {
    const query = state.skillFilter.toLowerCase();
    const filtered = state.data.skills.filter((skill) => {
      const usageMatches = state.skillUsageFilter === 'used'
        ? (Number(skill.usageCount) || 0) > 0
        : state.skillUsageFilter === 'unused'
          ? (Number(skill.usageCount) || 0) === 0
          : true;
      const queryMatches = !query || [
        skill.name, skill.category, skill.description, ...(skill.tools || []),
      ].join(' ').toLowerCase().includes(query);
      return usageMatches && queryMatches;
    }).map((skill, index) => ({ skill, index }));
    const direction = state.skillSortDirection === 'asc' ? 1 : -1;
    const valueOf = state.skillSortKey === 'context'
      ? (skill) => Number(skill.descTokens) || 0
      : (skill) => Number(skill.usageCount) || 0;
    filtered.sort((a, b) => {
      const difference = (valueOf(a.skill) - valueOf(b.skill)) * direction;
      return difference || a.skill.name.localeCompare(b.skill.name) || a.index - b.index;
    });
    const totalPages = Math.max(1, Math.ceil(filtered.length / state.skillPageSize));
    state.skillPage = Math.min(Math.max(1, state.skillPage), totalPages);
    const start = (state.skillPage - 1) * state.skillPageSize;
    const rows = filtered.slice(start, start + state.skillPageSize).map(({ skill }) => skill);
    $('skill-rows').innerHTML = rows.map((skill) => `<tr>
      <td><button class="skill-name" data-skill-name="${esc(skill.name)}">${esc(skill.name)}</button></td>
      <td>${esc(skill.category)}</td>
      <td>${(skill.tools || []).map((tool) => pill(tool)).join('')}</td>
      <td>${esc(skill.usageCount)}<br><span class="muted">${esc(fmtDate(skill.lastUsed))}</span></td>
      <td>${esc(skill.descTokens)} token</td>
      <td><button class="source-status ${skill.sourceStatus === 'missing' ? 'missing' : skill.sourceStatus === 'partial' ? 'partial' : ''}" data-source-skill="${esc(skill.name)}" aria-label="${esc(skill.sourceStatus === 'tracked' ? state.labels.sourceTooltipTitle : state.labels.sourceEdit)}">${esc(sourceStatusLabel(skill.sourceStatus))}</button></td>
      <td>${versionStatusHtml(skill)}</td>
    </tr>`).join('') || `<tr><td colspan="7">${esc(query ? state.labels.noMatch : state.labels.noSkills)}</td></tr>`;
    document.querySelectorAll('.skill-page-summary').forEach((element) => {
      element.textContent = `${state.labels.totalPrefix} ${filtered.length} ${state.labels.pageSummary} ${state.skillPage} ${state.labels.pageOf} ${totalPages}${state.labels.pageEnd}`;
    });
    document.querySelectorAll('[data-skill-page="prev"]').forEach((button) => { button.disabled = state.skillPage <= 1; });
    document.querySelectorAll('[data-skill-page="next"]').forEach((button) => { button.disabled = state.skillPage >= totalPages; });
    document.querySelectorAll('[data-skill-sort]').forEach((button) => {
      const active = button.dataset.skillSort === state.skillSortKey;
      const heading = button.closest('th');
      heading.setAttribute('aria-sort', active ? (state.skillSortDirection === 'desc' ? 'descending' : 'ascending') : 'none');
      button.classList.toggle('active', active);
      button.querySelector('.sort-indicator').textContent = active ? (state.skillSortDirection === 'desc' ? '↓' : '↑') : '↕';
    });
  }

  function sourceStatusLabel(status) {
    if (status === 'partial') return state.labels.sourcePartial;
    if (status === 'missing') return state.labels.sourceMissing;
    return state.labels.sourceTracked;
  }

  function versionStatusLabel(status) {
    return state.labels[`version${String(status || '').charAt(0).toUpperCase()}${String(status || '').slice(1)}`] || status || state.labels.versionUnknown;
  }

  function versionStatusHtml(skill) {
    const freshness = skill.freshness || { status: 'untracked' };
    const status = freshness.status || 'unknown';
    const cls = ['outdated', 'diverged', 'unknown', 'unchecked', 'untracked'].includes(status) ? 'warn' : 'read';
    const checked = freshness.checkedAt ? `${state.labels.versionChecked} ${fmtDate(freshness.checkedAt)}` : state.labels.versionUnchecked;
    const previews = (skill.updateTargets || []).map((target) => `<button data-preview-update="${esc(skill.name)}" data-preview-instance="${esc(target.instanceId)}">${esc(state.labels.versionUpdatePreview)} · ${esc(target.tool || '-')}</button>`).join('');
    return `<div class="version-status">${pill(versionStatusLabel(status), cls)}<span class="version-meta">${esc(checked)}${freshness.cached ? ` · ${esc(state.labels.versionCached)}` : ''}</span>${previews}</div>`;
  }

  function showSourceTooltip(target) {
    window.clearTimeout(state.sourceTooltipTimer);
    const skill = state.data.skills.find((item) => item.name === target.dataset.sourceSkill);
    if (!skill?.sources?.length) return;
    const tooltip = $('source-tooltip');
    const provenance = (skill.instances || []).flatMap((instance) => instance.sourceDiscovery ? [{ ...instance.sourceDiscovery, tool: instance.tool, scope: instance.scope }] : []);
    tooltip.innerHTML = `<strong>${esc(state.labels.sourceTooltipTitle)}</strong>${skill.sources.map((source) => {
      const safeUrl = /^https?:\/\//i.test(source);
      return safeUrl ? `<a href="${esc(source)}" target="_blank" rel="noreferrer">${esc(source)}</a>` : `<code>${esc(source)}</code>`;
    }).join('')}${provenance.length ? `<div class="source-provenance">${provenance.map((item) => `<span>${esc(state.labels.sourceMethod)}: ${esc(item.method || '-')} · ${esc(item.provider || '')}${item.tool ? ` · ${esc(item.tool)}/${esc(item.scope || '-')}` : ''}</span><span>${esc(state.labels.sourceConfidence)}: ${item.confidence == null ? '-' : `${Math.round(item.confidence * 100)}%`} · ${esc(state.labels.sourceVerifiedAt)}: ${esc(fmtDate(item.verifiedAt))}</span>`).join('')}</div>` : ''}`;
    tooltip.classList.remove('hidden');
    const rect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const left = Math.max(12, Math.min(window.innerWidth - tooltipRect.width - 12, rect.right - tooltipRect.width));
    const below = rect.bottom + 8;
    const top = below + tooltipRect.height <= window.innerHeight - 12 ? below : Math.max(12, rect.top - tooltipRect.height - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function openGovernanceModal(skillName) {
    const skill = state.data.skills.find((item) => item.name === skillName);
    if (!skill) return;
    state.governance = { skill, sessionId: null, candidates: [], error: '', returnFocus: document.activeElement };
    renderSourceDialog();
    const modal = $('governance-modal');
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    modal.querySelector('.governance-dialog')?.focus();
  }

  function closeGovernanceModal() {
    const modal = $('governance-modal');
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    state.governance.returnFocus?.focus?.();
    state.governance = { skill: null, sessionId: null, candidates: [], error: '', returnFocus: null };
  }

  function selectedSourceTargets() {
    return [...document.querySelectorAll('[data-governance-target]:checked')].map((input) => input.value);
  }

  function targetRows(skill) {
    return (skill.instances || []).filter((instance) => !instance.hasSource);
  }

  function renderSourceDialog() {
    const skill = state.governance.skill;
    if (!skill) return;
    const targets = targetRows(skill);
    $('governance-title').textContent = `${state.labels.sourceDialogTitle}: ${skill.name}`;
    $('governance-subtitle').textContent = state.labels.sourceDialogText;
    const candidates = state.governance.candidates;
    const error = state.governance.error ? `<div class="governance-error" role="alert">${esc(state.governance.error)}</div>` : '';
    const targetHtml = targets.length ? `<div class="governance-targets">${targets.map((target, index) => `<label class="governance-target"><input type="checkbox" data-governance-target value="${esc(target.instanceId)}" checked><span>${esc(target.tool || '-')} / ${esc(target.scope || '-')} · ${esc(target.currentVersion || '-')} ${index === 0 && targets.length === 1 ? '' : ''}</span></label>`).join('')}</div>` : `<p>${esc(state.labels.sourceTracked)}</p>`;
    const candidateHtml = candidates.length ? `<div class="governance-section"><h4>${esc(state.labels.sourceCandidatesTitle)}</h4><div class="candidate-list">${candidates.map((candidate) => `<label class="candidate-option"><input type="radio" name="source-candidate" value="${esc(candidate.index)}"><span><strong>${esc(candidate.name || candidate.path || candidate.source)}</strong><small>${esc(candidate.source)}${candidate.version ? ` · ${esc(candidate.version)}` : ''} · ${Math.round((candidate.confidence || 0) * 100)}%</small><small>${esc(candidate.description || '')}</small></span></label>`).join('')}</div><div class="governance-actions"><button class="action-btn primary" data-source-candidate-save>${esc(state.labels.sourceCandidateSave)}</button></div></div>` : '';
    $('governance-body').innerHTML = `${error}<div class="governance-section"><h4>${esc(state.labels.sourceTargets)}</h4>${targetHtml}</div><div class="governance-section"><h4>${esc(state.labels.sourceManualTitle)}</h4><p>${esc(state.labels.sourceManualHint)}</p><form class="governance-form" id="source-manual-form"><label for="source-url">${esc(state.labels.sourceUrlLabel)}</label><input id="source-url" type="text" inputmode="url" autocomplete="url" placeholder="${esc(state.labels.sourceUrlPlaceholder)}" required><div class="governance-actions"><button class="action-btn primary" type="submit" data-source-manual-save>${esc(state.labels.sourceSave)}</button></div></form></div><div class="governance-section"><h4>${esc(state.labels.sourceSearchTitle)}</h4><p>${esc(state.labels.sourceSearchHint)}</p><div class="governance-actions"><button class="action-btn" data-source-search>${esc(state.labels.sourceAllowSearch)}</button></div></div>${candidateHtml}`;
  }

  async function saveManualSource() {
    const skill = state.governance.skill;
    const targets = selectedSourceTargets();
    const source = $('source-url')?.value.trim();
    if (!targets.length) return setGovernanceError(state.labels.sourceTargetRequired);
    if (!source) return setGovernanceError(state.labels.invalidSource || state.labels.sourceUrlLabel);
    await withGovernanceBusy(async () => {
      await postJson('/api/sources/manual', { skill: skill.name, source, instanceIds: targets });
      closeGovernanceModal();
      await loadDashboard(false);
      toast(state.labels.sourceSaved);
    });
  }

  async function searchSources() {
    const skill = state.governance.skill;
    await withGovernanceBusy(async () => {
      const result = await postJson('/api/sources/discover', { skill: skill.name, consent: true });
      state.governance.sessionId = result.sessionId;
      state.governance.candidates = result.candidates || [];
      state.governance.error = state.governance.candidates.length ? '' : state.labels.sourceNoCandidates;
      renderSourceDialog();
    });
  }

  async function saveSelectedCandidate() {
    const skill = state.governance.skill;
    const targetIds = selectedSourceTargets();
    const selected = document.querySelector('input[name="source-candidate"]:checked');
    if (!targetIds.length) return setGovernanceError(state.labels.sourceTargetRequired);
    if (!selected) return setGovernanceError(state.labels.sourceChooseCandidate);
    await withGovernanceBusy(async () => {
      await postJson('/api/sources/confirm', { sessionId: state.governance.sessionId, candidateIndex: Number(selected.value), instanceIds: targetIds });
      closeGovernanceModal();
      await loadDashboard(false);
      toast(state.labels.sourceSaved);
    });
  }

  function setGovernanceError(message) {
    state.governance.error = message;
    renderSourceDialog();
  }

  async function withGovernanceBusy(action) {
    const buttons = document.querySelectorAll('#governance-body button, #governance-body input');
    buttons.forEach((element) => { element.disabled = true; });
    try { await action(); } catch (error) { state.governance.error = error.message; renderSourceDialog(); }
    finally { buttons.forEach((element) => { element.disabled = false; }); }
  }

  async function previewUpdate(skill, instanceId) {
    openGlassModal();
    const modal = $('glass-modal');
    const titleEl = modal.querySelector('.glass-term-title');
    const outputEl = modal.querySelector('.glass-term-body pre');
    const exitEl = modal.querySelector('.glass-term-exit');
    const durationEl = modal.querySelector('.glass-term-duration');
    const command = `skm update ${quoteArg(skill)} --instance ${quoteArg(instanceId)} --dry-run`;
    titleEl.textContent = command;
    outputEl.textContent = `$ ${command}\n\n`;
    exitEl.textContent = state.labels.cmdLoading;
    exitEl.className = 'glass-term-exit';
    const start = Date.now();
    try {
      const result = await postJson('/api/update/preview', { skill, instanceId });
      outputEl.textContent += `${result.stdout || state.labels.cmdNoOutput}${result.stderr ? `\n\n--- stderr ---\n${result.stderr}` : ''}`;
      exitEl.textContent = result.exitCode === 0 ? '✓ success' : `✕ exit ${result.exitCode}`;
      exitEl.classList.add(result.exitCode === 0 ? 'ok' : 'err');
    } catch (error) {
      outputEl.textContent += `\n[error] ${error.message}`;
      exitEl.textContent = '✕ error';
      exitEl.classList.add('err');
    }
    durationEl.textContent = `${((Date.now() - start) / 1000).toFixed(2)}s`;
  }

  function showSkillTooltip(target) {
    window.clearTimeout(state.sourceTooltipTimer);
    const skill = state.data.skills.find((item) => item.name === target.dataset.skillName);
    if (!skill) return;
    const tooltip = $('source-tooltip');
    tooltip.innerHTML = `<strong>${esc(state.labels.skillDescriptionTitle)}</strong><p>${esc(skill.description || state.labels.skillNoDescription || '-')}</p>`;
    tooltip.classList.remove('hidden');
    positionTooltip(target, tooltip);
  }

  function positionTooltip(target, tooltip) {
    const rect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const left = Math.max(12, Math.min(window.innerWidth - tooltipRect.width - 12, rect.right - tooltipRect.width));
    const below = rect.bottom + 8;
    const top = below + tooltipRect.height <= window.innerHeight - 12 ? below : Math.max(12, rect.top - tooltipRect.height - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function scheduleSourceTooltipHide() {
    window.clearTimeout(state.sourceTooltipTimer);
    state.sourceTooltipTimer = window.setTimeout(() => $('source-tooltip').classList.add('hidden'), 240);
  }

  function initializeGraph() {
    const graph = state.data.graph;
    state.graph.enabledTypes = new Set(Object.entries(graph.edgeTypes || {})
      .filter(([, meta]) => meta.defaultVisible).map(([type]) => type));
    state.graph.positions.clear();
    const total = Math.max(1, graph.nodes.length);
    graph.nodes.forEach((node, index) => {
      const y = 1 - (index / Math.max(1, total - 1)) * 2;
      const radius = Math.sqrt(Math.max(0, 1 - y * y));
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      const spread = 185 + Math.min(90, Math.sqrt(total) * 5);
      state.graph.positions.set(node.id, {
        x: Math.cos(angle) * radius * spread,
        y: y * spread,
        z: Math.sin(angle) * radius * spread,
      });
    });
  }

  function renderGraphInsights() {
    const labels = state.labels;
    const graph = state.data.graph;
    const definitions = [
      { types: ['same_family'], title: labels.graphInsightSuite, hint: labels.graphInsightSuiteHint },
      { types: ['strong_alternative', 'weak_alternative', 'duplicate'], title: labels.graphInsightOverlap, hint: labels.graphInsightOverlapHint },
      { types: ['pipeline', 'upstream_downstream', 'reverse_transform'], title: labels.graphInsightFlow, hint: labels.graphInsightFlowHint },
      { types: ['uses_mcp'], title: labels.graphInsightDependency, hint: labels.graphInsightDependencyHint },
    ];
    $('graph-insights').innerHTML = definitions.map((item) => {
      const count = item.types.reduce((sum, type) => sum + (graph.stats.edgeTypes?.[type] || 0), 0);
      return `<button class="graph-insight" data-focus-types="${esc(item.types.join(','))}"><strong>${esc(item.title)}</strong><small>${esc(item.hint)}</small><b>${count}</b></button>`;
    }).join('');
  }

  function renderGraphFilters() {
    const graph = state.data.graph;
    const relationGroups = [
      { label: state.labels.graphGroupMembership, types: ['same_family', 'same_category', 'shared_platform'] },
      { label: state.labels.graphGroupRisk, types: ['duplicate', 'strong_alternative', 'weak_alternative'] },
      { label: state.labels.graphGroupWorkflow, types: ['pipeline', 'upstream_downstream', 'reverse_transform', 'shared_io_format'] },
      { label: state.labels.graphGroupDependency, types: ['same_platform_action', 'uses_mcp'] },
    ];
    const options = graphScopeOptions(graph);
    const scopeSelect = `<label class="graph-scope-label" for="graph-scope-select">${esc(state.labels.graphScopeFilter)}</label>
      <select class="graph-scope-select" id="graph-scope-select">
        <option value="">${esc(state.labels.graphScopeAll)}</option>
        ${['family', 'platform', 'category'].map((type) => {
          const items = options.filter((item) => item.type === type);
          if (!items.length) return '';
          const groupLabel = type === 'family' ? state.labels.graphScopeSuites : type === 'platform' ? state.labels.graphScopePlatforms : state.labels.graphScopeCategories;
          return `<optgroup label="${esc(groupLabel)}">${items.map((item) => `<option value="${esc(item.id)}"${item.id === state.graph.scopeId ? ' selected' : ''}>${esc(item.label)} (${item.count})</option>`).join('')}</optgroup>`;
        }).join('')}
      </select><small class="graph-scope-hint">${esc(state.labels.graphScopeHint)}</small>`;
    const relationFilters = relationGroups.map((group) => {
      const controls = group.types.filter((type) => graph.edgeTypes?.[type]).map((type) => {
        const meta = graph.edgeTypes[type];
        const count = graph.stats.edgeTypes?.[type] || 0;
        const checked = state.graph.enabledTypes.has(type) ? ' checked' : '';
        return `<label class="relation-option"><input type="checkbox" data-edge-type="${esc(type)}"${checked}><span class="relation-swatch" style="background:${esc(meta.color)}"></span><span class="relation-help" tabindex="0" data-help="${esc(meta.description)}">${esc(meta.label)} <small>${count}</small></span></label>`;
      }).join('');
      return controls ? `<div class="relation-group"><b>${esc(group.label)}</b>${controls}</div>` : '';
    }).join('');
    $('graph-filters').innerHTML = `${scopeSelect}<strong>${esc(state.labels.graphEdgeFilter)}</strong>${relationFilters}`;
  }

  function graphScopeOptions(graph) {
    const membershipType = { family: 'same_family', category: 'same_category', platform: 'shared_platform' };
    return graph.nodes.filter((node) => membershipType[node.type]).map((node) => ({
      id: node.id,
      label: node.label,
      type: node.type,
      count: graph.edges.filter((edge) => edge.type === membershipType[node.type] && (edge.source === node.id || edge.target === node.id)).length,
    })).filter((item) => item.count > 0)
      .sort((a, b) => a.type.localeCompare(b.type) || b.count - a.count || a.label.localeCompare(b.label));
  }

  function visibleGraph() {
    const graph = state.data.graph;
    const enabled = state.graph.enabledTypes;
    let edges = graph.edges.filter((edge) => enabled.has(edge.type));
    if (state.graph.scopeId) {
      const scope = graph.nodes.find((node) => node.id === state.graph.scopeId);
      const membershipType = { family: 'same_family', category: 'same_category', platform: 'shared_platform' }[scope?.type];
      const membershipEdges = graph.edges.filter((edge) => edge.type === membershipType
        && (edge.source === state.graph.scopeId || edge.target === state.graph.scopeId));
      const scopeIds = new Set([state.graph.scopeId]);
      membershipEdges.forEach((edge) => {
        scopeIds.add(edge.source);
        scopeIds.add(edge.target);
      });
      edges = edges.filter((edge) => scopeIds.has(edge.source) && scopeIds.has(edge.target));
    }
    const query = state.graph.query.trim().toLowerCase();
    let matched = null;
    if (query) {
      matched = new Set(graph.nodes.filter((node) => [node.label, node.category, node.description, node.type]
        .join(' ').toLowerCase().includes(query)).map((node) => node.id));
      edges = edges.filter((edge) => matched.has(edge.source) || matched.has(edge.target));
    }
    if (state.graph.focusId) {
      edges = edges.filter((edge) => edge.source === state.graph.focusId || edge.target === state.graph.focusId);
    }
    const ids = new Set();
    edges.forEach((edge) => { ids.add(edge.source); ids.add(edge.target); });
    if (matched) matched.forEach((id) => ids.add(id));
    if (state.graph.focusId) ids.add(state.graph.focusId);
    return { edges, nodes: graph.nodes.filter((node) => ids.has(node.id)) };
  }

  function scheduleGraph() {
    if (state.graph.frame) return;
    state.graph.frame = requestAnimationFrame(() => {
      state.graph.frame = 0;
      drawGraph();
    });
  }

  function drawGraph() {
    if (!state.data) return;
    const canvas = $('graph-canvas');
    const box = $('graph-box');
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(320, box.clientWidth);
    const height = Math.max(420, box.clientHeight);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const visible = visibleGraph();
    const styles = getComputedStyle(document.body);
    const textColor = styles.getPropertyValue('--text').trim() || '#fff';
    const muted = styles.getPropertyValue('--muted').trim() || '#94a3b8';
    drawGraphBackdrop(context, width, height, styles, visible);
    const projected = visible.nodes.map((node) => projectNode(node, width, height)).sort((a, b) => a.z - b.z);
    const byId = new Map(projected.map((node) => [node.id, node]));
    state.graph.projected = projected;
    visible.edges.forEach((edge) => {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (!source || !target) return;
      const depthGap = Math.abs(source.z - target.z);
      const edgeAlpha = Math.max(0.16, Math.min(0.62, 0.48 - depthGap / 880));
      context.beginPath();
      context.moveTo(source.screenX, source.screenY);
      context.lineTo(target.screenX, target.screenY);
      context.strokeStyle = colorWithAlpha(state.data.graph.edgeTypes[edge.type]?.color || muted, edgeAlpha);
      context.lineWidth = Math.max(0.7, Math.min(2.6, (source.scale + target.scale) * 0.72));
      context.shadowColor = colorWithAlpha(state.data.graph.edgeTypes[edge.type]?.color || muted, edgeAlpha * 0.8);
      context.shadowBlur = 6;
      context.stroke();
    });
    context.shadowBlur = 0;
    projected.forEach((node) => drawNode(context, node, textColor));
    $('graph-stats').textContent = `${state.labels.graphNodes} ${projected.length} · ${state.labels.graphEdges} ${visible.edges.length}`;
    $('graph-empty').classList.toggle('hidden', projected.length > 0);
  }

  function drawGraphBackdrop(context, width, height, styles, visible) {
    const accent = styles.getPropertyValue('--accent').trim() || '#00f5ff';
    const accent2 = styles.getPropertyValue('--accent-2').trim() || '#ff2bd6';
    const base = context.createLinearGradient(0, 0, 0, height);
    base.addColorStop(0, 'rgba(3,7,18,.16)');
    base.addColorStop(0.48, colorWithAlpha(accent, 0.04));
    base.addColorStop(1, 'rgba(2,6,23,.62)');
    context.fillStyle = base;
    context.fillRect(0, 0, width, height);

    const glow = context.createRadialGradient(width * 0.5, height * 0.36, 10, width * 0.5, height * 0.42, Math.max(width, height) * 0.78);
    glow.addColorStop(0, colorWithAlpha(accent, 0.2));
    glow.addColorStop(0.4, colorWithAlpha(accent2, 0.08));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);

    context.save();
    context.lineWidth = 1;
    context.strokeStyle = colorWithAlpha(accent, 0.1);
    const horizon = height * 0.45;
    for (let row = 0; row <= 7; row++) {
      const ratio = row / 7;
      const y = horizon + Math.pow(ratio, 1.8) * (height - horizon - 16);
      context.globalAlpha = 0.07 + ratio * 0.08;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
    const vanishX = width * 0.5;
    for (let column = -7; column <= 7; column++) {
      const offset = column * width * 0.08;
      context.globalAlpha = 0.04 + Math.abs(column) * 0.004;
      context.beginPath();
      context.moveTo(vanishX + offset * 0.14, horizon);
      context.lineTo(vanishX + offset, height);
      context.stroke();
    }
    context.restore();

    const particles = visible.nodes.slice(0, Math.min(48, visible.nodes.length));
    particles.forEach((node, index) => {
      const hash = hashText(node.id) + index * 131;
      const x = (hash % 997) / 996 * width;
      const y = ((hash >> 2) % 811) / 810 * height * 0.74;
      const alpha = 0.03 + ((hash >> 5) % 100) / 1000;
      context.fillStyle = colorWithAlpha(nodeColor(node), alpha);
      context.beginPath();
      context.arc(x, y, 0.8 + ((hash >> 7) % 3) * 0.35, 0, Math.PI * 2);
      context.fill();
    });
  }

  function projectNode(node, width, height) {
    const point = state.graph.positions.get(node.id) || { x: 0, y: 0, z: 0 };
    const cosY = Math.cos(state.graph.rotationY);
    const sinY = Math.sin(state.graph.rotationY);
    const x1 = point.x * cosY - point.z * sinY;
    const z1 = point.x * sinY + point.z * cosY;
    const cosX = Math.cos(state.graph.rotationX);
    const sinX = Math.sin(state.graph.rotationX);
    const y2 = point.y * cosX - z1 * sinX;
    const z2 = point.y * sinX + z1 * cosX;
    const perspective = 520 / Math.max(220, 520 - z2 * 0.48);
    const scale = perspective * state.graph.zoom;
    return {
      ...node, z: z2, scale,
      screenX: width / 2 + x1 * scale,
      screenY: height / 2 + y2 * scale,
    };
  }

  function drawNode(context, node, textColor) {
    const base = node.type === 'mcp' ? 8 : node.type === 'skill' ? 7 : 9;
    const radius = Math.max(4, Math.min(18, (base + Math.sqrt(node.usageCount || 0)) * node.scale));
    const selected = node.id === state.graph.selectedId;
    const color = nodeColor(node);
    const halo = radius * (selected ? 2.1 : 1.6);
    const glow = context.createRadialGradient(node.screenX - radius * 0.35, node.screenY - radius * 0.4, 1, node.screenX, node.screenY, radius);
    glow.addColorStop(0, '#ffffff');
    glow.addColorStop(0.22, color);
    glow.addColorStop(1, '#07111f');
    context.save();
    context.shadowColor = color;
    context.shadowBlur = selected ? 30 : 14;
    context.beginPath();
    context.arc(node.screenX, node.screenY, halo, 0, Math.PI * 2);
    context.strokeStyle = colorWithAlpha(color, selected ? 0.24 : 0.12);
    context.lineWidth = selected ? 1.8 : 1.1;
    context.stroke();
    context.beginPath();
    context.arc(node.screenX, node.screenY, radius, 0, Math.PI * 2);
    context.fillStyle = glow;
    context.fill();
    context.lineWidth = selected ? 3 : 1;
    context.strokeStyle = selected ? '#ffffff' : color;
    context.stroke();
    context.restore();
    if (node.scale > 0.68 && (state.graph.projected.length < 90 || node.usageCount || selected)) {
      context.font = `${selected ? 600 : 500} 11px ui-sans-serif, system-ui`;
      context.fillStyle = textColor;
      context.shadowColor = '#000000';
      context.shadowBlur = 4;
      context.fillText(short(node.label, 20), node.screenX + radius + 5, node.screenY + 4);
      context.shadowBlur = 0;
    }
  }

  function nodeColor(node) {
    if (node.type === 'mcp') return '#f472b6';
    if (node.type === 'category') return '#fbbf24';
    if (node.type === 'family') return '#a78bfa';
    if (node.type === 'platform') return '#34d399';
    return '#22d3ee';
  }

  function colorWithAlpha(color, alpha) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
    const value = Number.parseInt(color.slice(1), 16);
    return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
  }

  function hashText(value) {
    let hash = 0;
    for (const char of String(value || '')) {
      hash = Math.imul(31, hash) + char.codePointAt(0);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function short(value, max) {
    const text = String(value || '');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function renderGraphDetail() {
    const panel = $('graph-detail');
    const graph = state.data.graph;
    const node = graph.nodes.find((item) => item.id === state.graph.selectedId);
    if (!node) {
      panel.innerHTML = `<div class="detail-empty">${esc(state.labels.graphDetailEmpty)}</div>`;
      return;
    }
    const related = graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
    const commands = suggestedGraphCommands(node, related);
    panel.innerHTML = `<span class="pill">${esc(graphNodeLabel(node.type))}</span><h4>${esc(node.label)}</h4>
      <p>${esc(node.description || node.category || '-')}</p>
      <dl><dt>${esc(state.labels.usage)}</dt><dd>${esc(node.usageCount || 0)}</dd><dt>${esc(state.labels.graphRelated)}</dt><dd>${related.length}</dd></dl>
      <div class="graph-actions">
        <button class="primary" data-focus-node="${esc(node.id)}">${esc(state.labels.graphFocusNeighbors)}</button>
        ${node.type === 'skill' ? `<button data-locate-skill="${esc(node.label)}">${esc(state.labels.graphLocateSkill)}</button>` : ''}
      </div>
      <strong>${esc(state.labels.graphSuggestedCommands)}</strong>
      <div class="graph-actions">${commands.map((command) => `<button data-copy="${esc(command)}">${esc(command)}</button>`).join('')}</div>
      <strong>${esc(state.labels.graphRelationshipEvidence)}</strong>
      <div class="detail-relations">${related.slice().sort((a, b) => confidenceRank(a.confidence) - confidenceRank(b.confidence)).slice(0, 16).map((edge) => {
        const otherId = edge.source === node.id ? edge.target : edge.source;
        const other = graph.nodes.find((item) => item.id === otherId);
        return `<button data-select-node="${esc(otherId)}"><span style="background:${esc(graph.edgeTypes[edge.type]?.color)}"></span><b>${esc(graph.edgeTypes[edge.type]?.label)} · ${esc(other?.label || otherId)}</b><em>${esc(confidenceLabel(edge.confidence))}</em>${edge.reason ? `<small>${esc(edge.reason)}</small>` : ''}</button>`;
      }).join('')}</div>`;
  }

  function confidenceRank(value) {
    return value === 'explicit' ? 0 : value === 'structural' ? 1 : 2;
  }

  function confidenceLabel(value) {
    if (value === 'explicit') return state.labels.graphConfidenceExplicit;
    if (value === 'structural') return state.labels.graphConfidenceStructural;
    return state.labels.graphConfidenceInferred;
  }

  function graphNodeLabel(type) {
    if (type === 'skill') return state.labels.graphNodeSkill || initialLabel('Skill', 'Skill');
    if (type === 'mcp') return state.labels.graphNodeMcp || initialLabel('MCP', 'MCP');
    if (type === 'category') return state.labels.graphNodeCategory || initialLabel('分类', 'Category');
    if (type === 'family') return state.labels.graphNodeFamily || initialLabel('套件', 'Suite');
    if (type === 'platform') return state.labels.graphNodePlatform || initialLabel('平台', 'Platform');
    return type;
  }

  function suggestedGraphCommands(node, related) {
    const value = quoteCliArg(node.label);
    const commands = [];
    if (node.type === 'skill') {
      commands.push(`skm eval ${value}`, `skm search ${value}`);
      if (related.some((edge) => ['duplicate', 'strong_alternative', 'weak_alternative'].includes(edge.type))) commands.push('skm dupes');
      const skill = state.data.skills.find((item) => item.name === node.label);
      if (!skill?.hasSource) commands.push('skm sources missing');
    } else if (node.type === 'category') commands.push(`skm list --category ${value}`);
    else if (node.type === 'mcp') commands.push('skm list --mcp', 'skm audit');
    else if (node.type === 'family') commands.push(`skm search ${quoteCliArg(node.label.replace(/\*$/, ''))}`);
    else commands.push(`skm search ${value}`);
    return [...new Set(commands)].slice(0, 3);
  }

  function quoteCliArg(value) {
    const text = String(value || '');
    return /^[a-z0-9._-]+$/i.test(text) ? text : `"${text.replace(/["\\]/g, '\\$&')}"`;
  }

  function focusGraphTypes(types) {
    state.graph.enabledTypes = new Set(types.filter((type) => state.data.graph.edgeTypes[type]));
    state.graph.query = '';
    state.graph.focusId = null;
    state.graph.scopeId = null;
    state.graph.selectedId = null;
    $('graph-search').value = '';
    renderGraphFilters();
    renderGraphDetail();
    scheduleGraph();
  }

  function resetGraph() {
    initializeGraph();
    state.graph.query = '';
    state.graph.selectedId = null;
    state.graph.focusId = null;
    state.graph.scopeId = null;
    state.graph.rotationX = -0.18;
    state.graph.rotationY = 0.35;
    state.graph.zoom = 1;
    $('graph-search').value = '';
    renderGraphFilters();
    renderGraphDetail();
    scheduleGraph();
  }

  // ── 命令中心 ──────────────────────────────────────────────────

  const CMD_ICONS = {
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
    radar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/><path d="M12 3v18M3 12h18M5.5 5.5l13 13M18.5 5.5l-13 13"/></svg>',
    stethoscope: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3v6a4 4 0 0 0 8 0V3"/><circle cx="6" cy="3" r="1.5"/><circle cx="14" cy="3" r="1.5"/><path d="M10 13v3a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="14" r="1.5"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="5" cy="6" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="5" cy="18" r="1" fill="currentColor"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l1.8 4.5L18 9l-4.2 1.5L12 15l-1.8-4.5L6 9l4.2-1.5L12 3z"/><path d="M19 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z"/><path d="M5 15l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6.6-1.5z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 7"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7L12.5 17"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 5 5v1"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M7 4l14 8-14 8V4z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h6M14 6h6M4 12h4M16 12h4M4 18h8M16 18h4"/><circle cx="12" cy="6" r="2"/><circle cx="14" cy="12" r="2"/><circle cx="14" cy="18" r="2"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l2.9 6.3 6.9.7-5.2 4.6 1.5 6.6L12 17.8 5.9 21.2l1.5-6.6L2.2 10l6.9-.7L12 3z"/></svg>',
    graph: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="18" r="2"/><circle cx="18" cy="16" r="2"/><circle cx="12" cy="6" r="2"/><path d="M7.5 16.5 11 7.5M13 7.5l3.5 7"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6z"/><path d="M14 3v6h6"/></svg>',
  };

  const CMD_GROUPS = [
    { key: 'all', labelKey: 'cmdAll' },
    { key: 'diagnosis', labelKey: 'cmdGroupDiagnosis' },
    { key: 'explore', labelKey: 'cmdGroupExplore' },
    { key: 'audit', labelKey: 'cmdGroupAudit' },
    { key: 'lifecycle', labelKey: 'cmdGroupLifecycle' },
  ];

  const CMD_WORKFLOWS = [
    {
      id: 'quick-check',
      steps: [
        { cmd: 'status', label: '1. 健康体检' },
        { cmd: 'risks', label: '2. 风险扫描' },
        { cmd: 'doctor', label: '3. 环境诊断' },
      ],
    },
    {
      id: 'deep-audit',
      steps: [
        { cmd: 'audit', label: '1. 使用审计' },
        { cmd: 'dupes', label: '2. 重复检测' },
        { cmd: 'outdated', label: '3. 版本检查' },
      ],
    },
    {
      id: 'cleanup',
      steps: [
        { cmd: 'sessions', label: '1. 会话清理计划' },
        { cmd: 'disable', label: '2. 软禁用预览' },
        { cmd: 'policy', label: '3. 策略检查' },
      ],
    },
  ];

  function loadCmdFavorites() {
    try {
      const raw = localStorage.getItem('skm-cmd-favorites');
      if (raw) state.cmdFavorites = new Set(JSON.parse(raw));
    } catch { /* ignore */ }
  }

  function saveCmdFavorites() {
    try {
      localStorage.setItem('skm-cmd-favorites', JSON.stringify([...state.cmdFavorites]));
    } catch { /* ignore */ }
  }

  function toggleFavorite(id) {
    if (state.cmdFavorites.has(id)) state.cmdFavorites.delete(id);
    else state.cmdFavorites.add(id);
    saveCmdFavorites();
    renderCommands();
  }

  function filteredCommands() {
    const all = state.data.commands || [];
    const q = state.cmdQuery.trim().toLowerCase();
    let list = all;
    if (state.cmdGroup === 'favorites') {
      list = all.filter((c) => state.cmdFavorites.has(c.id));
    } else if (state.cmdGroup !== 'all') {
      list = all.filter((c) => c.group === state.cmdGroup);
    }
    if (q) {
      list = list.filter((c) =>
        c.id.toLowerCase().includes(q) ||
        c.command.toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q)
      );
    }
    return list;
  }

  function renderCmdFilterTabs() {
    const labels = state.labels;
    const tabs = [...CMD_GROUPS, { key: 'favorites', labelKey: 'cmdFavorites' }];
    $('cmd-filter-tabs').innerHTML = tabs.map((tab) => {
      const active = state.cmdGroup === tab.key ? 'active' : '';
      return `<button class="cmd-tab ${active}" data-cmd-group="${esc(tab.key)}">${esc(labels[tab.labelKey] || tab.key)}</button>`;
    }).join('');
  }

  function renderWorkflows() {
    const labels = state.labels;
    const items = [
      { key: 'quick-check', label: labels.cmdWorkflowQuickCheck, cmds: ['status', 'risks', 'doctor'] },
      { key: 'deep-audit', label: labels.cmdWorkflowDeepAudit, cmds: ['audit', 'dupes', 'outdated'] },
      { key: 'cleanup', label: labels.cmdWorkflowCleanup, cmds: ['sessions', 'disable', 'policy'] },
    ];
    $('cmd-workflows').innerHTML = `
      <div class="cmd-workflows-header"><span>${esc(labels.cmdWorkflows)}</span></div>
      <div class="cmd-workflows-list">
        ${items.map((w) => `
          <div class="workflow-card">
            <div class="workflow-title">${esc(w.label)}</div>
            <div class="workflow-steps">
              ${w.cmds.map((cmd, i) => {
                const item = (state.data.commands || []).find((c) => c.id === cmd);
                if (!item) return '';
                return `<button class="workflow-step" data-workflow-step="${esc(cmd)}">
                  <span class="step-index">${i + 1}</span>
                  <span class="step-cmd">${esc(item.command.replace(/\s*<[^>]+>/g, ''))}</span>
                </button>`;
              }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderCommands() {
    const labels = state.labels;
    renderCmdFilterTabs();
    renderWorkflows();

    const list = filteredCommands();
    const groups = {};
    for (const item of list) {
      const g = item.group || 'other';
      if (!groups[g]) groups[g] = [];
      groups[g].push(item);
    }

    const groupOrder = ['diagnosis', 'explore', 'audit', 'lifecycle', 'other'];
    let html = '';
    for (const gkey of groupOrder) {
      const items = groups[gkey];
      if (!items?.length) continue;
      const groupLabel = labels[`cmdGroup${gkey.charAt(0).toUpperCase() + gkey.slice(1)}`] || gkey;
      html += `<div class="cmd-group">
        <h4 class="cmd-group-title">${esc(groupLabel)} <span class="cmd-group-count">${items.length}</span></h4>
        <div class="cmd-grid">${items.map(renderCommandCard).join('')}</div>
      </div>`;
    }
    if (!list.length) html = `<div class="cmd-empty">${esc(labels.noResults || '无结果')}</div>`;
    $('command-list').innerHTML = html;
  }

  function renderCommandCard(item) {
    const labels = state.labels;
    const icon = CMD_ICONS[item.icon] || CMD_ICONS.star;
    const isFav = state.cmdFavorites.has(item.id);
    const modeBadge = item.mode === 'dry-run'
      ? pill(labels.dryRunBadge || 'dry-run', 'dry')
      : item.mode === 'write'
      ? pill(labels.writeBadge || 'write', 'write')
      : pill(labels.readonly, 'read');

    const paramsHtml = (item.params || []).map((p) => {
      const isBool = p.type === 'bool' || p.type === 'subcommand';
      const hasValues = p.values && p.values.length;
      return `<div class="param-chip" data-param="${esc(item.id)}:${esc(p.flag)}" title="${esc(p.hint || '')}">
        <span class="param-name">${esc(p.flag)}</span>
        ${isBool ? '' : hasValues
          ? `<select class="param-select" data-param-select="${esc(item.id)}:${esc(p.flag)}">
              <option value="">—</option>
              ${p.values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}
            </select>`
          : `<input class="param-input" data-param-input="${esc(item.id)}:${esc(p.flag)}" placeholder="${esc(p.label || '')}" size="6">`}
      </div>`;
    }).join('');

    const examplesHtml = (item.examples || []).map((ex) =>
      `<button class="example-chip" data-example="${esc(item.id)}" data-example-text="${esc(ex)}" title="${esc(labels.cmdClickToFill || '')}">${esc(ex)}</button>`
    ).join('');

    const runButton = item.executable
      ? `<button class="action-btn primary" data-run-command="${esc(item.id)}">${esc(labels.cmdRun)}</button>`
      : '';

    const favTitle = isFav ? (labels.cmdUnfavorite || '取消收藏') : (labels.cmdFavorite || '收藏');
    const favIcon = isFav ? '★' : '☆';

    return `<article class="card command-card" data-command-card="${esc(item.id)}">
      <div class="command-head">
        <div class="cmd-title-wrap">
          <span class="cmd-icon" aria-hidden="true">${icon}</span>
          <div class="cmd-title-text">
            <strong>${esc(item.id)}</strong>
            ${modeBadge}
          </div>
        </div>
        <div class="cmd-head-actions">
          <button class="icon-button cmd-fav-btn ${isFav ? 'active' : ''}" data-fav="${esc(item.id)}" title="${esc(favTitle)}">${favIcon}</button>
          <button class="icon-button" data-copy="${esc(item.command)}" title="${esc(labels.copyCommand)}">⧉</button>
        </div>
      </div>
      <p class="cmd-desc">${esc(item.description)}</p>
      <button class="command-line" data-command-click="${esc(item.id)}">${esc(item.command)}</button>
      <div class="cmd-params-block">
        <div class="cmd-params-label">${esc(labels.cmdParameters)}</div>
        <div class="param-chips">${paramsHtml || `<span class="muted">${esc(labels.cmdNoParameters)}</span>`}</div>
      </div>
      <details class="cmd-details">
        <summary>${esc(labels.cmdHelp)}</summary>
        <p class="cmd-hint">${esc(item.hint)}</p>
        <div class="cmd-examples-label">${esc(labels.cmdExamples)}</div>
        <div class="command-examples">${examplesHtml}</div>
      </details>
      <div class="command-actions">
        ${runButton}
        <button class="action-btn" data-copy-command="${esc(item.id)}">${esc(labels.copyCommand)}</button>
      </div>
    </article>`;
  }

  function fillExample(id, text) {
    const item = state.data.commands.find((c) => c.id === id);
    if (!item) return;
    // 提取 base command 和额外参数
    const base = item.command.replace(/\s*<[^>]+>/g, '').trim();
    const extra = text.slice(base.length).trim();
    const input = document.querySelector(`[data-command-args="${cssEscape(id)}"]`);
    if (input) {
      input.value = extra;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // 更新命令行显示
    const lineBtn = document.querySelector(`[data-command-click="${cssEscape(id)}"]`);
    if (lineBtn) lineBtn.textContent = text;
  }

  function commandText(item) {
    if (!item) return '';
    const params = item.params || [];
    const parts = [];
    for (const p of params) {
      if (p.type === 'positional') {
        const input = document.querySelector(`[data-param-input="${cssEscape(item.id)}:${cssEscape(p.flag)}"]`);
        if (input?.value) parts.push(quoteArg(input.value.trim()));
      } else if (p.type === 'bool') {
        const chip = document.querySelector(`[data-param="${cssEscape(item.id)}:${cssEscape(p.flag)}"]`);
        if (chip?.classList.contains('active')) parts.push(p.flag);
      } else if (p.type === 'subcommand') {
        const chip = document.querySelector(`[data-param="${cssEscape(item.id)}:${cssEscape(p.flag)}"]`);
        if (chip?.classList.contains('active')) parts.push(p.flag.replace(/^--/, ''));
      } else {
        const select = document.querySelector(`[data-param-select="${cssEscape(item.id)}:${cssEscape(p.flag)}"]`);
        const input = document.querySelector(`[data-param-input="${cssEscape(item.id)}:${cssEscape(p.flag)}"]`);
        let val = '';
        if (select && select.value) val = select.value;
        else if (input && input.value) val = input.value.trim();
        if (val) parts.push(`${p.flag} ${quoteArg(val)}`);
      }
    }
    const base = item.command.replace(/\s*<[^>]+>/g, '').trim();
    return `${base} ${parts.join(' ')}`.trim();
  }

  function quoteArg(value) {
    if (/^[a-z0-9._=/:-]+$/i.test(value)) return value;
    return `"${String(value).replace(/"/g, '\\"')}"`;
  }

  function openGlassModal() {
    const modal = $('glass-modal');
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  function closeGlassModal() {
    const modal = $('glass-modal');
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  async function runCommand(id) {
    const item = state.data.commands.find((command) => command.id === id);
    if (!item?.executable) {
      copy(commandText(item));
      return;
    }
    const fullCmd = commandText(item);
    openGlassModal();

    const modal = $('glass-modal');
    const titleEl = modal.querySelector('.glass-term-title');
    const outputEl = modal.querySelector('.glass-term-body pre');
    const timeEl = modal.querySelector('.glass-term-time');
    const exitEl = modal.querySelector('.glass-term-exit');
    const durationEl = modal.querySelector('.glass-term-duration');
    const copyBtn = modal.querySelector('.glass-term-copy-btn');

    titleEl.textContent = fullCmd;
    outputEl.textContent = '';
    timeEl.textContent = '';
    exitEl.textContent = '';
    exitEl.className = 'glass-term-exit';
    durationEl.textContent = '';
    copyBtn.onclick = () => copy(outputEl.textContent);

    const startTime = Date.now();
    const updateTimer = setInterval(() => {
      timeEl.textContent = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
    }, 100);

    // 打字机效果显示命令行
    await typeText(outputEl, `$ ${fullCmd}\n\n`, 12);

    const base = item.command.replace(/\s*<[^>]+>/g, '').trim();
    const argsStr = fullCmd.slice(base.length).trim();

    try {
      const response = await fetch(apiUrl('/api/run', { cmd: id, args: argsStr }));
      const result = await response.json();
      outputEl.textContent = `$ ${result.command}\n`;
      if (!response.ok) {
        const msg = result.message || result.error || state.labels.cmdError;
        await typeText(outputEl, `\n[error] ${msg}`, 5, outputEl.textContent);
        exitEl.textContent = '✕ error';
        exitEl.classList.add('err');
      } else {
        const body = result.isJson ? JSON.stringify(result.data, null, 2) : (result.stdout || state.labels.cmdNoOutput);
        const exitCode = result.exitCode ?? 0;
        const fullOutput = `\n[exit ${exitCode}]\n\n${body}${result.stderr ? `\n\n--- stderr ---\n${result.stderr}` : ''}`;
        await typeText(outputEl, fullOutput, 2, outputEl.textContent);
        if (exitCode === 0) {
          exitEl.textContent = '✓ success';
          exitEl.classList.add('ok');
        } else {
          exitEl.textContent = `✕ exit ${exitCode}`;
          exitEl.classList.add('err');
        }
      }
    } catch (err) {
      outputEl.textContent += `\n\n[error] ${err.message || state.labels.cmdError}`;
      exitEl.textContent = '✕ error';
      exitEl.classList.add('err');
    }

    clearInterval(updateTimer);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    timeEl.textContent = elapsed + 's';
    durationEl.textContent = `took ${elapsed}s`;
  }


  async function typeText(target, text, speedMs = 5, prefix = '') {
    return new Promise((resolve) => {
      let i = 0;
      const total = text.length;
      const step = Math.max(1, Math.floor(total / 200));
      function tick() {
        if (i >= total) {
          target.textContent = prefix + text;
          resolve();
          return;
        }
        i += step;
        target.textContent = prefix + text.slice(0, Math.min(i, total));
        target.scrollTop = target.scrollHeight;
        setTimeout(tick, speedMs);
      }
      tick();
    });
  }

  function cssEscape(value) {
    return window.CSS?.escape ? window.CSS.escape(value) : String(value).replace(/[^a-z0-9_-]/gi, '\\$&');
  }


  async function recommend() {
    const query = $('recommend-input').value.trim();
    if (!query) return toast(state.labels.needQuery);
    const response = await fetch(apiUrl('/api/recommend', { q: query, top: '6' }));
    const data = await response.json();
    $('recommend-rows').innerHTML = data.items.map((item) => `<tr><td><strong>${esc(item.name)}</strong><br><span class="muted">${esc(item.description).slice(0, 130)}</span></td><td>${esc(item.category)}<br>${(item.tools || []).map((tool) => pill(tool)).join('')}</td><td>${esc(item.score)}</td><td>${esc((item.reasons || []).join(' · '))}</td></tr>`).join('') || `<tr><td colspan="4">${esc(state.labels.noRecommendation)}</td></tr>`;
  }

  function graphPointerDown(event) {
    const rect = $('graph-canvas').getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = [...state.graph.projected].reverse().find((node) => Math.hypot(node.screenX - x, node.screenY - y) < 16);
    state.graph.pointer = { id: event.pointerId, x, y, nodeId: hit?.id || null, moved: false };
    $('graph-canvas').setPointerCapture(event.pointerId);
  }

  function graphPointerMove(event) {
    const pointer = state.graph.pointer;
    if (!pointer || pointer.id !== event.pointerId) return;
    const rect = $('graph-canvas').getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const dx = x - pointer.x;
    const dy = y - pointer.y;
    pointer.moved ||= Math.abs(dx) + Math.abs(dy) > 2;
    if (pointer.nodeId) {
      const point = state.graph.positions.get(pointer.nodeId);
      point.x += dx / state.graph.zoom;
      point.y += dy / state.graph.zoom;
    } else {
      state.graph.rotationY += dx * 0.007;
      state.graph.rotationX = Math.max(-1.25, Math.min(1.25, state.graph.rotationX + dy * 0.007));
    }
    pointer.x = x;
    pointer.y = y;
    scheduleGraph();
  }

  function graphPointerUp(event) {
    const pointer = state.graph.pointer;
    if (!pointer || pointer.id !== event.pointerId) return;
    if (pointer.nodeId && !pointer.moved) {
      state.graph.selectedId = pointer.nodeId;
      const node = state.data.graph.nodes.find((item) => item.id === pointer.nodeId);
      if (['family', 'platform', 'category'].includes(node?.type)) setGraphScope(pointer.nodeId, false);
      renderGraphDetail();
      scheduleGraph();
    }
    state.graph.pointer = null;
  }

  function setGraphScope(scopeId, clearSelection = true) {
    state.graph.scopeId = scopeId || null;
    const scope = state.data.graph.nodes.find((node) => node.id === state.graph.scopeId);
    const membershipType = { family: 'same_family', category: 'same_category', platform: 'shared_platform' }[scope?.type];
    if (membershipType) state.graph.enabledTypes.add(membershipType);
    state.graph.query = '';
    state.graph.focusId = null;
    if (clearSelection) state.graph.selectedId = scopeId || null;
    $('graph-search').value = '';
    renderGraphFilters();
    renderGraphDetail();
    scheduleGraph();
  }

  document.addEventListener('click', (event) => {
    const glassClose = event.target.closest('[data-glass-close]');
    if (glassClose) closeGlassModal();
    const governanceClose = event.target.closest('[data-governance-close]');
    if (governanceClose) closeGovernanceModal();
    const termDotClose = event.target.closest('.glass-term-dots span:nth-child(1)');
    if (termDotClose) closeGlassModal();
    const sourceButton = event.target.closest('[data-source-skill]');
    const skillButton = event.target.closest('[data-skill-name]');
    if (sourceButton && ['missing', 'partial'].some((name) => sourceButton.classList.contains(name))) openGovernanceModal(sourceButton.dataset.sourceSkill);
    else if (sourceButton) showSourceTooltip(sourceButton);
    else if (skillButton) showSkillTooltip(skillButton);
    else if (!event.target.closest('#source-tooltip')) $('source-tooltip').classList.add('hidden');
    const theme = event.target.closest('[data-theme-target]');
    if (theme) setTheme(theme.dataset.themeTarget);
    const language = event.target.closest('[data-lang-target]');
    if (language) setLanguage(language.dataset.langTarget);
    const sortButton = event.target.closest('[data-skill-sort]');
    if (sortButton) {
      const key = sortButton.dataset.skillSort;
      if (state.skillSortKey === key) state.skillSortDirection = state.skillSortDirection === 'desc' ? 'asc' : 'desc';
      else {
        state.skillSortKey = key;
        state.skillSortDirection = 'desc';
      }
      state.skillPage = 1;
      renderSkills();
    }
    const pageButton = event.target.closest('[data-skill-page]');
    if (pageButton && !pageButton.disabled) {
      state.skillPage += pageButton.dataset.skillPage === 'next' ? 1 : -1;
      renderSkills();
      document.querySelector('.skill-pagination.top')?.scrollIntoView({ block: 'nearest' });
    }
    const copyButton = event.target.closest('[data-copy]');
    if (copyButton) copy(copyButton.dataset.copy);
    const copyCommand = event.target.closest('[data-copy-command]');
    if (copyCommand) {
      const item = state.data.commands.find((command) => command.id === copyCommand.dataset.copyCommand);
      copy(commandText(item));
    }
    const cmdGroupBtn = event.target.closest('[data-cmd-group]');
    if (cmdGroupBtn) { state.cmdGroup = cmdGroupBtn.dataset.cmdGroup; renderCommands(); }
    const favBtn = event.target.closest('[data-fav]');
    if (favBtn) toggleFavorite(favBtn.dataset.fav);
    const exampleBtn = event.target.closest('[data-example]');
    if (exampleBtn) fillExample(exampleBtn.dataset.example, exampleBtn.dataset.exampleText);
    const paramChip = event.target.closest('[data-param]');
    if (paramChip && event.target.tagName !== 'INPUT' && event.target.tagName !== 'SELECT') {
      const paramData = paramChip.dataset.param;
      const chip = document.querySelector(`[data-param="${cssEscape(paramData)}"]`);
      if (chip) {
        // 仅 bool / subcommand 类型可整体点击切换
        const [cid, pflag] = paramData.split(':', 2);
        const item = state.data.commands.find((c) => c.id === cid);
        const p = (item?.params || []).find((x) => x.flag === pflag);
        if (p && (p.type === 'bool' || p.type === 'subcommand')) {
          chip.classList.toggle('active');
          const lineBtn = document.querySelector(`[data-command-click="${cssEscape(cid)}"]`);
          if (lineBtn) lineBtn.textContent = commandText(item);
        }
      }
    }
    const workflowStep = event.target.closest('[data-workflow-step]');
    if (workflowStep) {
      const cmd = workflowStep.dataset.workflowStep;
      // 滚动到对应命令卡片并高亮
      const card = document.querySelector(`[data-command-card="${cssEscape(cmd)}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.style.transition = 'box-shadow 0.4s';
        card.style.boxShadow = '0 0 0 2px var(--accent-1), 0 8px 30px rgba(0,0,0,.3)';
        setTimeout(() => { card.style.boxShadow = ''; }, 1200);
      }
    }
    const runButton = event.target.closest('[data-run-command], [data-command-click]');
    if (runButton) runCommand(runButton.dataset.runCommand || runButton.dataset.commandClick).catch((error) => toast(error.message));
    const insight = event.target.closest('[data-focus-types]');
    if (insight) focusGraphTypes(insight.dataset.focusTypes.split(','));
    const selected = event.target.closest('[data-select-node]');
    if (selected) {
      state.graph.selectedId = selected.dataset.selectNode;
      const node = state.data.graph.nodes.find((item) => item.id === state.graph.selectedId);
      if (['family', 'platform', 'category'].includes(node?.type)) setGraphScope(node.id, false);
      renderGraphDetail();
      scheduleGraph();
    }
    const focusNode = event.target.closest('[data-focus-node]');
    if (focusNode) {
      state.graph.focusId = focusNode.dataset.focusNode;
      scheduleGraph();
    }
    const locateSkill = event.target.closest('[data-locate-skill]');
    if (locateSkill) {
      state.skillFilter = locateSkill.dataset.locateSkill;
      state.skillPage = 1;
      $('skill-filter').value = state.skillFilter;
      renderSkills();
      $('skills').scrollIntoView({ block: 'start' });
    }
    const preview = event.target.closest('[data-preview-update]');
    if (preview) previewUpdate(preview.dataset.previewUpdate, preview.dataset.previewInstance).catch((error) => toast(error.message));
    const manualSave = event.target.closest('[data-source-manual-save]');
    if (manualSave && manualSave.type !== 'submit') saveManualSource();
    const search = event.target.closest('[data-source-search]');
    if (search) searchSources();
    const candidateSave = event.target.closest('[data-source-candidate-save]');
    if (candidateSave) saveSelectedCandidate();
  });

  document.addEventListener('submit', (event) => {
    if (event.target.id !== 'source-manual-form') return;
    event.preventDefault();
    saveManualSource();
  });

  document.addEventListener('pointerover', (event) => {
    const source = event.target.closest('[data-source-skill]');
    if (source) showSourceTooltip(source);
    const skill = event.target.closest('[data-skill-name]');
    if (skill) showSkillTooltip(skill);
    if (event.target.closest('#source-tooltip')) window.clearTimeout(state.sourceTooltipTimer);
  });

  document.addEventListener('pointerout', (event) => {
    if (event.target.closest('[data-source-skill], [data-skill-name], #source-tooltip')) scheduleSourceTooltipHide();
  });

  document.addEventListener('focusin', (event) => {
    const source = event.target.closest('[data-source-skill]');
    if (source) showSourceTooltip(source);
    const skill = event.target.closest('[data-skill-name]');
    if (skill) showSkillTooltip(skill);
  });

  document.addEventListener('focusout', (event) => {
    if (event.target.closest('[data-source-skill], [data-skill-name]')) scheduleSourceTooltipHide();
  });

  document.addEventListener('change', (event) => {
    if (event.target.id === 'graph-scope-select') {
      setGraphScope(event.target.value);
      return;
    }
    const type = event.target.dataset.edgeType;
    if (!type) return;
    if (event.target.checked) state.graph.enabledTypes.add(type);
    else state.graph.enabledTypes.delete(type);
    state.graph.selectedId = null;
    renderGraphDetail();
    const paramSelect = event.target.closest('[data-param-select]');
    if (paramSelect) {
      const [cid] = paramSelect.dataset.paramSelect.split(':', 1);
      const item = state.data.commands.find((c) => c.id === cid);
      const lineBtn = document.querySelector(`[data-command-click="${cssEscape(cid)}"]`);
      if (lineBtn && item) lineBtn.textContent = commandText(item);
    }
    scheduleGraph();
  });

  $('refresh-btn').addEventListener('click', () => loadDashboard(true).catch((error) => toast(error.message)));
  $('version-check-btn').addEventListener('click', () => runVersionCheck(false).catch((error) => toast(error.message)));
  $('version-refresh-btn').addEventListener('click', () => runVersionCheck(true).catch((error) => toast(error.message)));
  $('skill-filter').addEventListener('input', (event) => { state.skillFilter = event.target.value; state.skillPage = 1; renderSkills(); });
  $('skill-usage-filter').addEventListener('change', (event) => { state.skillUsageFilter = event.target.value; state.skillPage = 1; renderSkills(); });
  $('graph-search').addEventListener('input', (event) => { state.graph.query = event.target.value; scheduleGraph(); });
  $('graph-reset').addEventListener('click', resetGraph);
  $('recommend-btn').addEventListener('click', () => recommend().catch((error) => toast(error.message)));
  $('recommend-input').addEventListener('keydown', (event) => { if (event.key === 'Enter') recommend().catch((error) => toast(error.message)); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('glass-modal').classList.contains('hidden')) {
      closeGlassModal();
    }
    const governance = $('governance-modal');
    if (event.key === 'Escape' && governance && !governance.classList.contains('hidden')) {
      closeGovernanceModal();
      return;
    }
    if (event.key === 'Tab' && governance && !governance.classList.contains('hidden')) {
      const focusable = [...governance.querySelectorAll('button:not(:disabled), input:not(:disabled), [href], select, textarea')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  const cmdSearch = $('cmd-search');
  if (cmdSearch) cmdSearch.addEventListener('input', (e) => { state.cmdQuery = e.target.value; renderCommands(); });
  // 参数输入框实时更新命令行显示
  document.addEventListener('input', (event) => {
    const paramInput = event.target.closest('[data-param-input]');
    if (paramInput) {
      const [cid] = paramInput.dataset.paramInput.split(':', 1);
      const item = state.data.commands.find((c) => c.id === cid);
      const lineBtn = document.querySelector(`[data-command-click="${cssEscape(cid)}"]`);
      if (lineBtn && item) lineBtn.textContent = commandText(item);
    }
  });
  $('graph-canvas').addEventListener('pointerdown', graphPointerDown);
  $('graph-canvas').addEventListener('pointermove', graphPointerMove);
  $('graph-canvas').addEventListener('pointerup', graphPointerUp);
  $('graph-canvas').addEventListener('pointercancel', graphPointerUp);
  $('graph-canvas').addEventListener('wheel', (event) => {
    event.preventDefault();
    state.graph.zoom = Math.max(0.45, Math.min(2.5, state.graph.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
    scheduleGraph();
  }, { passive: false });
  window.addEventListener('resize', scheduleGraph);
  window.addEventListener('scroll', scheduleSourceTooltipHide, { passive: true });

  setTheme(readStorage('skm-web-theme') || 'cyberpunk');
  loadDashboard().catch((error) => {
    $('loader-title').textContent = state.labels.loadFailed || initialLabel('加载失败', 'Load failed');
    $('loader-text').textContent = error.message;
    toast(error.message);
  });
})();
