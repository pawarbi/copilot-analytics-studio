import { PACKS, SKILLS, PROFILES, applyPack, skillFromCatalog, normalizeHttps } from './catalog.js';
import { defineAgentGuide } from './agent-guide.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  chart: '<path d="M4 20V10m8 10V4m8 16v-7"/><path d="M2 22h20"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  source: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  pen: '<path d="m16 3 5 5L8 21H3v-5zM13 6l5 5"/>',
  skill: '<path d="m12 3 2.7 5.5L21 9.4l-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.4l6.3-.9z"/>',
  file: '<path d="M14 2H5v20h14V7zm0 0v6h5M8 13h8m-8 4h6"/>',
  rocket: '<path d="M14 4c3-2 6-1 6-1s1 3-1 6l-7 7-5-5zM7 11H3l4-5h5m0 10v5l5-4v-6M7 16l-3 4m0-4-1 1"/><circle cx="16" cy="7" r="1"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  save: '<path d="M3 3h15l3 3v15H3zm4 0v7h10V3M7 21v-7h10v7"/>',
  logout: '<path d="M10 3H4v18h6m4-14 5 5-5 5m-6-5h11"/>',
  link: '<path d="m10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 0)"/>',
  folder: '<path d="M3 6h7l2 3h9v12H3z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  book: '<path d="M12 5C8 2 4 3 2 4v15c3-1 6-1 10 2 4-3 7-3 10-2V4c-2-1-6-2-10 1zm0 0v16"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  briefcase: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12c6 4 12 4 18 0m-9 1v4"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-18a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v3"/>',
  calculator: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h1m6 0h1m-8 4h1m6 0h1m-8 4h1m6 0h1"/>',
  flow: '<rect x="8" y="2" width="8" height="5" rx="1"/><rect x="2" y="17" width="7" height="5" rx="1"/><rect x="15" y="17" width="7" height="5" rx="1"/><path d="M12 7v5m-7 5v-5h14v5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  moon: '<path d="M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10z"/>',
  spark: '<path d="m12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2zM20 2v4m-2-2h4"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.info}</svg>`;
defineAgentGuide(icon);
const brand = () => `<div class="brand"><span class="brand-mark">${icon('book')}</span><div><strong>Agent Studio</strong><span>Power BI agents · Fabric IQ</span></div></div>`;
const fabricCredit = () => `<a class="fabric-credit" href="https://learn.microsoft.com/fabric/iq/connectors/microsoft-365-copilot-overview" target="_blank" rel="noopener noreferrer"><img src="/icons/fabric_32_color.svg" width="22" height="22" alt=""><span>Data answers powered by <strong>Fabric IQ</strong></span>${icon('arrow')}</a>`;
const packTone = id => id === 'sales' || id === 'customers' ? 'expertise' : id === 'finance' || id === 'executive' ? 'rules' : 'source';
function notebookScene() {
  return `<div class="notebook-scene" aria-hidden="true">
    <div class="note-sheet sheet-rules tone-rules"><span class="sheet-label">${icon('pen')} Instructions</span><strong>Response<br>requirements</strong><div class="note-lines"><i></i><i></i><i></i></div><span class="note-annotation">Default behavior</span></div>
    <div class="note-sheet sheet-report tone-source"><span class="sheet-label">${icon('chart')} Power BI</span><strong>Report source</strong><svg class="note-chart" viewBox="0 0 180 65" fill="none"><path class="chart-grid" d="M0 20h180M0 45h180"/><path class="chart-area" d="M0 53 24 42 48 47 76 25 102 31 130 13 154 21 180 5v60H0Z"/><path class="chart-line" d="m0 53 24-11 24 5 28-22 26 6 28-18 24 8 26-16"/><circle cx="130" cy="13" r="4"/></svg></div>
    <div class="note-sheet sheet-skill tone-expertise"><span class="feature-icon">${icon('book')}</span><div><strong>Skills</strong><span>Task-specific instructions</span></div></div>
  </div>`;
}
const state = {
  token: '', account: null, authLoading: true, entered: false, projects: [], project: null, tab: 'reports',
  dirty: false, busy: false, saving: false, saveError: false, change: 0, files: null, selectedFile: 0,
  parsed: {}, sourceErrors: {}, job: null, activePack: 'general', nameTouched: true,
  hosting: { mode: 'local' }, library: { kind: 'packs', query: '', category: 'All', selected: null, creating: false }
};
let toastTimer, saveTimer, savePromise;
const isPublishing = () => state.job?.status === 'running' && state.job.kind === 'publish' && state.job.projectId === state.project?.id;
const storageText = () => state.hosting.mode === 'hosted' ? 'Saved to your account' : 'Saved on this computer';
const tabs = [
  ['reports', 'source', 'Data sources'], ['overview', 'grid', 'Agent details'],
  ['instructions', 'pen', 'Instructions'], ['skills', 'skill', 'Skills'], ['files', 'rocket', 'Review & publish']
];

async function api(path, { method = 'GET', body, binary = false } = {}) {
  const response = await fetch(`/api${path}`, {
    method, headers: { 'X-Studio-Token': state.token, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) { state.entered = false; state.account = null; render(); }
    throw new Error(result.error || `Request failed (${response.status}).`);
  }
  return binary ? response.blob() : response.json();
}

function toast(message, error = false) {
  clearTimeout(toastTimer);
  const el = $('#toast');
  el.textContent = message; el.className = `toast${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => el.classList.add('hidden'), error ? 10000 : 4500);
}
async function perform(action) {
  if (state.busy) return;
  state.busy = true;
  try { await action(); } catch (error) { toast(error.message, true); }
  finally { state.busy = false; updateSaveStatus(); }
}
const field = (label, key, value, { help = '', placeholder = '', max = '', type = 'text', rows = 0, code = false, prefix = 'field' } = {}) => {
  const id = `${prefix}-${key.replaceAll('.', '-')}`;
  return `<div class="field"><label for="${esc(id)}">${label}</label>${rows
    ? `<textarea id="${esc(id)}" data-field="${esc(key)}" rows="${rows}" ${max ? `maxlength="${max}"` : ''} class="${code ? 'code-editor' : ''}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
    : `<input id="${esc(id)}" data-field="${esc(key)}" value="${esc(value)}" type="${type}" ${max ? `maxlength="${max}"` : ''} placeholder="${esc(placeholder)}">`}${help ? `<span class="help">${help}</span>` : ''}</div>`;
};
function publisherFields(prefix = 'field') {
  const d = state.project.developer;
  return `${field('Publisher name', 'developer.name', d.name, { max: 32, prefix })}
    ${field('Website', 'developer.website', d.website, { type: 'url', placeholder: 'https://your-organization.com', prefix })}
    <div class="grid-2">${field('Privacy policy URL', 'developer.privacy', d.privacy, { type: 'url', placeholder: 'https://…/privacy', prefix })}${field('Terms of use URL', 'developer.terms', d.terms, { type: 'url', placeholder: 'https://…/terms', prefix })}</div>`;
}
function accountTools() {
  const dark = document.documentElement.dataset.theme === 'dark';
  return `<button class="btn icon-only quiet" data-action="theme" aria-label="Switch to ${dark ? 'light' : 'dark'} theme" title="Switch theme">${icon(dark ? 'sun' : 'moon')}</button>
    ${state.account ? `<details class="account-menu"><summary aria-label="Account menu"><span class="avatar">${esc(state.account.slice(0, 1).toUpperCase())}</span></summary><div class="account-popover"><strong>Microsoft 365</strong><p>${esc(state.account)}</p><button class="btn full" data-action="signout">${icon('logout')} Sign out</button></div></details>` : ''}`;
}
function connectionBadge() {
  return `<span class="connection-pill">${icon(state.hosting.mode === 'hosted' ? 'shield' : 'folder')}${state.hosting.mode === 'hosted' ? 'Personal workspace' : 'Local workspace'}</span>`;
}

function renderSignIn() {
  return `<div class="welcome"><header class="welcome-header">${brand()}<div class="actions">${connectionBadge()}${accountTools()}</div></header>
    <main class="welcome-main"><section class="welcome-story"><span class="eyebrow">Microsoft 365 Copilot</span><h1>Declarative agents<br>for Microsoft Copilot</h1>
      ${fabricCredit()}
      <p class="lead">Use your Power BI reports and semantic models to answer business questions. Add instructions and reusable skills, then publish to Microsoft Copilot.</p>
      ${notebookScene()}
      <div class="welcome-links"><button class="text-btn" data-action="agent-guide">${icon('info')} How it works</button><button class="text-btn" data-library="packs">${icon('book')} Browse templates ${icon('arrow')}</button></div>
    </section><section class="signin-card card" aria-labelledby="signin-title"><span class="signin-kicker">${icon('folder')} Account</span><h2 id="signin-title">${state.account ? 'Continue to Agent Studio' : 'Sign in'}</h2><p>Use your Microsoft 365 work or school account.</p>
      ${state.authLoading ? `<div class="connection-box"><span class="spinner"></span><div><strong>Checking your connection</strong><p>Looking for your Microsoft 365 session.</p></div></div>`
        : state.account ? `<div class="connection-box">${icon('check')}<div><strong>Account connected</strong><p>${esc(state.account)}</p></div></div><button class="btn primary full" data-action="continue">Continue to studio ${icon('arrow')}</button><button class="text-btn section-space" data-action="signout">Use a different account</button>`
          : `<button class="btn primary full signin-button" data-action="signin"><span class="ms-icon" aria-hidden="true"><i></i><i></i><i></i><i></i></span> Sign in with Microsoft</button><details class="advanced-signin"><summary>Tenant settings</summary><div class="field"><label for="tenant">Tenant ID (optional)</label><input id="tenant" placeholder="Leave blank to choose during sign-in"><span class="help">Enter a tenant GUID only if your organization requires it.</span></div></details><button class="text-btn small" data-action="refresh-auth">Already connected? Check again</button>`}
      <div class="signin-divider"></div><div class="mini-feature">${icon('shield')}<span>Microsoft handles authentication. Source access uses your existing permissions.</span></div><div class="mini-feature">${icon('file')}<span>Project source files can be exported as a ZIP.</span></div>
      <p class="signin-footnote">${state.hosting.mode === 'hosted' ? 'Your account and projects are separate from other makers.' : 'Local edition · Publishing uses Microsoft 365 Agents Toolkit on this computer.'}</p>
    </section></main><div class="welcome-guide"><agent-guide></agent-guide></div><footer class="welcome-footer"><span>Agent Studio · A community project</span><span>Built for Microsoft 365 Copilot · Not an official Microsoft product</span></footer></div>`;
}
function readiness() {
  const p = state.project;
  return [
    { tab: 'reports', label: 'Data source', done: p.reports.some(r => r.url.trim() && r.name.trim()) },
    { tab: 'overview', label: 'Agent identity', done: Boolean(p.name.trim() && p.description.trim()) },
    { tab: 'instructions', label: 'Core behavior', done: Boolean(p.instructions.trim()) },
    { tab: 'skills', label: 'Skills', done: p.skills.length > 0, optional: true }
  ];
}
function render() {
  const app = $('#app');
  if (!state.entered) { app.innerHTML = renderSignIn(); return; }
  const p = state.project;
  app.innerHTML = `<div class="studio"><header class="appbar">${brand()}<div class="appbar-center">${connectionBadge()}</div><div class="actions"><button class="btn quiet help-launch" data-action="agent-guide" aria-label="How it works">${icon('info')} How it works</button><button class="btn quiet library-launch" data-library="packs">${icon('book')} Template library</button>${accountTools()}</div></header>
    <div class="studio-body"><aside class="sidebar"><button class="nav-button home-button ${!p ? 'active' : ''}" data-action="home">${icon('folder')} My agents</button><button class="btn quiet full sidebar-create" data-action="new">${icon('plus')} New agent</button>
      ${p ? `<div class="side-label">Project configuration</div><nav aria-label="Studio navigation">${tabs.map(([key, image, title]) => `<button class="nav-button ${state.tab === key ? 'active' : ''}" data-tab="${key}" ${state.tab === key ? 'aria-current="page"' : ''}><span class="nav-step">${icon(image)}</span><span>${title}</span>${key === 'skills' && p.skills.length ? `<span class="count">${p.skills.length}</span>` : ''}</button>`).join('')}</nav>` : `<div class="side-label">Templates</div><nav aria-label="Template shortcuts">${[['packs', 'book', 'Starter packs'], ['skills', 'skill', 'Skills'], ['profiles', 'pen', 'Behavior presets']].map(([kind, image, title]) => `<button class="nav-button" data-library="${kind}">${icon(image)} ${title}</button>`).join('')}</nav>`}
      <div class="sidebar-note"><strong>${icon('shield')} Personal publishing</strong><p>Your agents publish to your own Copilot.</p><a href="https://learn.microsoft.com/en-us/plugins/prerequisites#agent-capabilities-and-licensing-models" target="_blank" rel="noopener noreferrer">Permissions & licensing ${icon('arrow')}</a></div>
    </aside><div class="workspace"><div class="workspace-toolbar ${p ? '' : 'home-toolbar'}"><div class="breadcrumbs">${p ? `<button class="text-btn" data-action="home">My agents</button>${icon('chevron')}<strong>${esc(p.name || 'Untitled agent')}</strong>` : '<span>Home</span>'}</div><div class="actions">${state.job?.status === 'running' ? `<button class="btn small" data-action="show-job"><span class="spinner"></span> Operation running</button>` : ''}${p ? `<span class="save-status" id="save-status" role="status">${saveLabel()}</span><button class="btn small" data-action="save" id="save-button">${icon('save')} Save draft</button>` : ''}</div></div>
      <main class="content ${p ? 'editor-content' : 'home-content'}">${p ? renderEditor() : renderDashboard()}</main><footer class="workspace-footer"><span>Agent Studio · Community project</span><span>${state.hosting.mode === 'hosted' ? 'Personal workspace' : 'Saved on this computer.'}</span></footer></div></div></div>`;
  if (isPublishing()) {
    for (const control of app.querySelectorAll('input,textarea,[data-remove-report],[data-remove-skill],[data-template],[data-action="add-report"],[data-action="add-skill"]')) control.disabled = true;
  }
  updateSaveStatus();
  const nav = app.querySelector('nav[aria-label="Studio navigation"]');
  const current = nav?.querySelector('[aria-current="page"]');
  if (current && nav.scrollWidth > nav.clientWidth) {
    nav.scrollLeft = current.getBoundingClientRect().left - nav.getBoundingClientRect().left - 12;
  }
}
function saveLabel() {
  return state.saving ? 'Saving…' : state.saveError ? 'Couldn’t save' : state.dirty ? 'Unsaved changes' : storageText();
}
function renderDashboard() {
  return `<header class="workspace-intro"><div class="intro-copy"><span class="eyebrow">Personal workspace</span><h1>Agents</h1><p>Create and manage declarative agents<br>for Microsoft 365 Copilot.</p><button class="btn primary" data-action="new">${icon('plus')} Create an agent</button>${fabricCredit()}</div>${notebookScene()}</header>
    <div class="workspace-guide-link"><span>${icon('info')} A declarative agent configures Copilot with your sources, instructions and skills.</span><button class="text-btn" data-action="agent-guide">How it works ${icon('arrow')}</button></div>
    <section class="projects-section" aria-labelledby="projects-title"><div class="section-heading"><h2 id="projects-title">Projects <span class="counter">${state.projects.length}</span></h2><span class="section-note">${storageText()}</span></div>
    ${state.projects.length ? `<div class="project-list">${state.projects.map(p => `<article class="project-row tone-source"><span class="agent-document">${icon('file')}</span><div class="project-copy"><h3><button class="project-title" data-open="${esc(p.id)}">${esc(p.name)}</button></h3><p>${esc(p.description)}</p><div class="project-meta"><span>${p.reportCount} ${p.reportCount === 1 ? 'source' : 'sources'}</span><span>${p.skillCount} ${p.skillCount === 1 ? 'skill' : 'skills'}</span></div></div><div class="project-status"><span class="status-label ${p.deployment ? 'published' : ''}"><i></i>${p.deployment ? 'Published · Personal' : 'Draft'}</span><time datetime="${esc(p.updatedAt)}">Updated ${esc(new Date(p.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</time></div><button class="btn small quiet project-open" data-open="${esc(p.id)}" aria-label="Open workspace for ${esc(p.name)}">${icon('arrow')}</button></article>`).join('')}</div>` : `<div class="first-agent-note"><span class="feature-icon tone-source">${icon('file')}</span><div><strong>No projects yet</strong><p>Create a project or select a template below.</p></div><button class="text-btn" data-action="new">Create project ${icon('arrow')}</button></div>`}</section>
    <section class="starter-section"><div class="section-heading"><div><h2>Templates</h2><p>Preconfigured instructions and skills. Editable before publishing.</p></div><button class="text-btn" data-library="packs">View all templates ${icon('arrow')}</button></div>
    <div class="starter-grid">${PACKS.slice(0, 3).map(pack => `<button class="starter-card tone-${packTone(pack.id)}" data-create-pack="${pack.id}"><span class="starter-cover"><span class="cover-page">${icon(pack.icon)}<i></i><i></i></span><span class="cover-caption">${pack.category}</span></span><span class="starter-title">${pack.title}</span><span class="starter-copy">${pack.summary}</span><span class="starter-meta">${pack.skills.length} skills ${icon('arrow')}</span></button>`).join('')}</div></section>`;
}
function heading(step, title, description, actions = '') {
  const tone = step === 3 ? 'rules' : step === 4 ? 'expertise' : 'source';
  return `<div class="page-heading"><div><span class="chapter-mark tone-${tone}">${icon(tabs[step - 1][1])}</span><span class="eyebrow">Step ${step} of 5</span><h1>${title}</h1><p>${description}</p></div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}
function stepFooter(previous, next, label) {
  return `<div class="step-footer"><div>${previous ? `<button class="btn quiet" data-tab="${previous}">Back</button>` : '<span class="small muted">Up to 20 Power BI sources per agent.</span>'}</div><button class="btn primary" data-tab="${next}">${label} ${icon('arrow')}</button></div>`;
}
function setupAside() {
  const items = readiness(), done = items.filter(x => x.done).length;
  return `<aside class="setup-aside">
    <div class="readiness-card"><div class="spread"><h3>Project checklist</h3><span class="counter">${done} / ${items.length}</span></div>
      <div class="progress-track"><span class="progress-${done}"></span></div>
      ${items.map(item => `<button class="check-row" data-tab="${item.tab}"><span class="check-marker ${item.done ? 'done' : ''}">${item.done ? icon('check') : ''}</span><span>${item.label}${item.optional ? '<small>Optional</small>' : ''}</span>${icon('chevron')}</button>`).join('')}
      <p class="small muted">Publisher details are required at final review.</p>
    </div>
    <div class="tip-card"><h3>Instruction scope</h3><p>Core instructions apply to every conversation. Put task-specific workflows in skills.</p><button class="text-btn" data-library="skills">Browse skills ${icon('arrow')}</button></div>
  </aside>`;
}
function renderEditor() {
  const p = state.project;
  const banner = isPublishing() ? `<div class="notice accent publishing-banner"><span class="spinner"></span><span>Publishing this saved version. Editing resumes when the operation finishes.</span><button class="text-btn" data-action="show-job">View progress</button></div>` : '';
  if (state.tab === 'reports') return `${banner}${heading(1, 'Data sources', 'Add Power BI report or semantic model URLs. Fabric IQ provides the data answers.', `<button class="btn" data-action="add-report">${icon('plus')} Add source</button>`)}
    <div class="editor-layout"><div>${p.reports.length ? p.reports.map(renderReport).join('') : `<div class="empty-state source-empty"><span class="feature-icon large">${icon('source')}</span><h2>No data sources</h2><p>Copy the full report or semantic model URL from Power BI.</p><button class="btn primary" data-action="add-report">${icon('plus')} Add Power BI source</button></div>`}<div class="notice section-space">${icon('info')}<span>URL checks verify structure only, not data access or model contents. The agent uses the current user’s Power BI permissions.</span></div></div>${setupAside()}</div>
    ${stepFooter(null, 'overview', 'Name your agent')}`;
  if (state.tab === 'overview') return `${banner}${heading(2, 'Agent details', 'Set the name and description displayed in Microsoft 365 Copilot.')}
    <div class="editor-layout"><div><section class="card"><div class="card-header"><h2>Display information</h2><p>Shown in Microsoft 365 Copilot.</p></div><div class="card-body">${field('Agent name', 'name', p.name, { max: 30, help: 'Up to 30 characters.' })}${field('Description', 'description', p.description, { rows: 3, max: 128, help: 'Describe the supported tasks. Up to 128 characters.' })}<details class="disclosure"><summary>Package version</summary><div class="section-space">${field('Package version', 'version', p.version, { placeholder: '1.0.0', help: 'Use major.minor.patch format. Increment for updates.' })}</div></details></div></section>
    <details class="card publisher-disclosure"><summary>Publisher information <span class="counter">Required before publishing</span></summary><div class="card-body"><p class="small muted field">App-manifest information. Enter the publisher’s website and policy URLs.</p>${publisherFields()}</div></details></div><aside class="setup-aside"><div class="agent-preview"><span class="feature-icon large">${icon('chart')}</span><span class="eyebrow">Copilot preview</span><h3 id="preview-name">${esc(p.name || 'Agent name')}</h3><p id="preview-description">${esc(p.description)}</p><span class="pill">Personal declarative agent</span></div><div class="tip-card"><h3>Description</h3><p>Identify the business area and supported tasks. Avoid claims the configured sources cannot support.</p></div></aside></div>
    ${stepFooter('reports', 'instructions', 'Instructions')}`;
  if (state.tab === 'instructions') return `${banner}${heading(3, 'Instructions', 'Configure default behavior and response requirements.', `<button class="btn" data-library="profiles">${icon('book')} Behavior presets</button>`)}
    <div class="profile-grid">${PROFILES.map(profile => `<button class="profile-card ${p.instructions === profile.text ? 'selected' : ''}" data-profile="${profile.id}"><span class="selection-dot">${p.instructions === profile.text ? icon('check') : ''}</span><strong>${profile.title}</strong><span>${profile.summary}</span></button>`).join('')}</div>
    <div class="editor-layout"><section class="card"><div class="card-header spread"><div><h2>Core instructions</h2><p>Always-on rules for every conversation. Source routing is added automatically.</p></div><span class="pill">Editable Markdown</span></div><div class="card-body">${field('Agent behavior', 'instructions', p.instructions, { rows: 15, max: 8000, code: true, help: 'Final instructions plus source routing must fit within 8,000 characters. Put detailed workflows in skills.' })}<div class="editor-counter"><span id="instruction-count">${p.instructions.length.toLocaleString()} characters</span><span>Source routing added at generation</span></div></div></section>${setupAside()}</div>
    ${stepFooter('overview', 'skills', 'Skills')}`;
  if (state.tab === 'skills') return `${banner}${heading(4, 'Skills', 'Add task-specific instructions from the library, import a SKILL.md file, or create a custom skill.', `<button class="btn" data-action="import-skill">${icon('upload')} Import SKILL.md</button><button class="btn primary" data-library="skills">${icon('book')} Browse skills</button>`)}
    <input class="hidden" id="skill-import" type="file" accept=".md,text/markdown,text/plain">
    <div class="expertise-banner tone-expertise"><span class="feature-icon">${icon('skill')}</span><div><h3>${p.skills.length} of 8 skills configured</h3><p>Skills guide the workflow, not data access. Use definitions that match the configured models.</p></div><button class="btn" data-action="add-skill">${icon('plus')} Custom skill</button></div>
    ${p.skills.length ? `<div class="skills-list">${p.skills.map(renderSkill).join('')}</div>` : `<div class="starter-grid skill-suggestions">${SKILLS.filter(s => ['metric-definitions', 'rankings-and-share', 'grounded-charting'].includes(s.id)).map(skill => `<article class="card suggestion-card"><span class="feature-icon">${icon(skill.icon)}</span><h3>${skill.title}</h3><p>${skill.summary}</p><button class="btn small" data-add-skill="${skill.id}">${icon('plus')} Add skill</button></article>`).join('')}</div>`}
    ${stepFooter('instructions', 'files', 'Review and publish')}`;
  const checklist = readiness();
  return `${banner}${heading(5, 'Review and publish', 'Review generated files, export the project, or publish to your account.', `<button class="btn" data-action="download">${icon('download')} Export source</button><button class="btn primary" data-action="review-publish">${icon('rocket')} ${p.deployment ? 'Publish update' : 'Publish to Copilot'}</button>`)}
    ${p.deployment ? `<div class="deployment-card card"><span class="feature-icon success">${icon('check')}</span><div><h3>Published personally · v${esc(p.deployment.version)}</h3><p>Microsoft accepted this deployment. Discovery and runtime availability depend on account entitlements, tenant policies and propagation.</p><details class="deployment-identity"><summary>Deployment identity</summary><code>${esc(p.deployment.agentId)}</code></details></div><div class="actions"><a class="btn" href="${esc(p.deployment.shareLink)}" target="_blank" rel="noopener noreferrer">Open Copilot ${icon('arrow')}</a><button class="btn" data-action="download-package">${icon('download')} App package</button></div></div>` : ''}
    <div class="review-grid">${[['source', `${p.reports.length} sources`, p.reports.map(r => r.name).join(', ') || 'Add at least one source', 'reports'], ['pen', 'Core behavior', `${p.instructions.length.toLocaleString()} characters · source routing added automatically`, 'instructions'], ['skill', `${p.skills.length} skills`, p.skills.map(s => s.name).join(', ') || 'Optional · add a playbook for repeated tasks', 'skills']].map(([i, title, copy, tab]) => `<button class="review-tile card" data-tab="${tab}">${icon(i)}<strong>${esc(title)}</strong><span>${esc(copy)}</span>${icon('chevron')}</button>`).join('')}</div>
    <div class="notice section-space">${icon('shield')}<div><strong>Personal publishing, not organization-wide deployment.</strong><p>The Toolkit validates the package and creates or updates this project’s personal agent. Publishing does not grant Copilot or Power BI licenses.</p></div></div>
    ${state.files ? renderFiles() : `<section class="file-preview-prompt card"><span class="feature-icon">${icon('file')}</span><div><h3>Generated files</h3><p>Inspect manifests, instructions, skill files and the deployment workflow.</p></div><button class="btn" data-action="preview">${icon('file')} Generate file preview</button></section>`}
    ${!checklist[0].done ? '<p class="small muted section-space">Start by adding a Power BI source before exporting or publishing.</p>' : ''}`;
}
function renderReport(report, index) {
  const parsed = state.parsed[report.url], error = state.sourceErrors[report.url];
  return `<section class="card source-card"><div class="card-header spread"><div class="row"><span class="source-number">${index + 1}</span><div><h3>${esc(report.name || `Power BI source ${index + 1}`)}</h3><p>Report or semantic model</p></div></div><button class="btn icon-only quiet danger" data-remove-report="${index}" aria-label="Remove source ${index + 1}">${icon('trash')}</button></div><div class="card-body">
    <div class="field"><label for="report-url-${index}">Power BI link</label><input id="report-url-${index}" data-report="${index}" data-key="url" type="url" value="${esc(report.url)}" placeholder="https://app.powerbi.com/groups/…/reports/…" maxlength="2000" ${error ? 'aria-invalid="true"' : ''}><span class="help">Paste the full report URL, not a short sharing link. We’ll check it when you leave this field.</span>
    ${parsed ? `<div class="parsed-source">${icon('check')}<span>${esc(parsed.type)} ID extracted<code>${esc(parsed.artifactId)}</code></span></div>` : error ? `<span class="field-error">${icon('info')}${esc(error)}</span>` : ''}<div><button class="text-btn small" data-parse-report="${index}">${icon('link')} Check link structure</button></div></div>
    <div class="field"><label for="report-name-${index}">Source name</label><input id="report-name-${index}" data-report="${index}" data-key="name" value="${esc(report.name)}" placeholder="e.g. AdventureWorks Sales" maxlength="120"></div>
    <div class="field"><label for="report-context-${index}">Description &amp; source-specific guidance</label><textarea id="report-context-${index}" data-report="${index}" data-key="description" rows="3" maxlength="2000" placeholder="${esc(PACKS.find(p => p.id === state.activePack)?.guidance ?? PACKS[0].guidance)}">${esc(report.description)}</textarea><span class="help">Helpful context: business domain, preferred measures, date rules and common ambiguities. Only include verified definitions.</span></div></div></section>`;
}
function renderSkill(skill, index) {
  const known = SKILLS.find(s => s.name === skill.name);
  return `<details class="card skill-card tone-expertise" ${!known || index === 0 ? 'open' : ''}><summary><span class="feature-icon">${icon(known?.icon ?? 'skill')}</span><span class="skill-copy"><strong>${esc(known?.title ?? (skill.name || 'Custom skill'))}</strong><span>${esc(skill.description || 'No description')}</span></span><span class="pill">${known?.category ?? 'Custom'}</span>${icon('chevron')}</summary><div class="skill-editor"><div class="spread skill-file-line"><code>skills/${esc(skill.name || 'skill-name')}/SKILL.md</code><button class="btn small quiet danger" data-remove-skill="${index}" aria-label="Remove skill ${index + 1}">${icon('trash')} Remove</button></div>
    <div class="grid-2"><div class="field"><label for="skill-name-${index}">Skill name</label><input id="skill-name-${index}" data-skill="${index}" data-key="name" value="${esc(skill.name)}" maxlength="64" placeholder="territory-performance"><span class="help">Lowercase letters, digits and hyphens.</span></div><div class="field"><label for="skill-description-${index}">When to use this skill</label><input id="skill-description-${index}" data-skill="${index}" data-key="description" value="${esc(skill.description)}" maxlength="1024"></div></div>
    <div class="field"><label for="skill-body-${index}">Instructions &amp; business rules</label><textarea id="skill-body-${index}" data-skill="${index}" data-key="instructions" rows="10" maxlength="18000">${esc(skill.instructions)}</textarea><span class="help">Edit the playbook to fit your source. Do not invent model objects or business definitions.</span></div>
    <details class="disclosure" ${skill.recipes ? 'open' : ''}><summary>Reference definitions &amp; DAX recipes (optional)</summary><div class="field section-space"><label for="skill-recipes-${index}">references/dax-recipes.md</label><textarea id="skill-recipes-${index}" data-skill="${index}" data-key="recipes" rows="7" maxlength="50000" placeholder="Add reviewed, model-specific definitions and examples.">${esc(skill.recipes)}</textarea><span class="help">Reference material only. AskPowerBI receives a question and context, not a raw-DAX execution batch.</span></div></details></div></details>`;
}
function renderFiles() {
  const result = state.files;
  if (!result.valid) return `<section class="card section-space"><div class="card-body"><h2>Validation errors</h2><ul class="check-list errors">${result.errors.map(e => `<li>${icon('info')}<span>${esc(e)}</span></li>`).join('')}</ul><div class="actions section-space"><button class="btn" data-tab="overview">Edit agent details</button><button class="btn" data-action="preview">Refresh preview</button></div></div></section>`;
  const file = result.files[state.selectedFile] ?? result.files[0];
  return `<div class="section-heading section-space"><h2>Generated source <span class="counter">${result.files.length} files</span></h2><button class="btn small" data-action="preview">Refresh preview</button></div><section class="card file-layout"><nav class="file-tree" aria-label="Generated files"><span class="file-tree-title">Source package</span>${result.files.map((f, index) => `<button class="file-button ${index === state.selectedFile ? 'active' : ''}" data-file="${index}">${icon('file')}<span>${esc(f.path)}</span></button>`).join('')}</nav><div class="file-view"><div class="file-view-title">${esc(file?.path)}</div><pre>${esc(file?.content)}</pre></div></section><p class="small muted section-space">Source ZIP = editable project files. App package = the provisioned installable ZIP from your last successful publish.</p>`;
}

function openLibrary(kind = 'packs', creating = false) {
  state.library = { kind, creating, query: '', category: 'All', selected: null };
  renderLibrary();
  if (!$('#library-dialog').open) $('#library-dialog').showModal();
}
function libraryItems() {
  const lib = state.library, collection = lib.kind === 'packs' ? PACKS : lib.kind === 'skills' ? SKILLS : PROFILES;
  const query = lib.query.toLowerCase();
  return collection.filter(item => (lib.category === 'All' || item.category === lib.category) && `${item.title} ${item.summary} ${item.category ?? ''}`.toLowerCase().includes(query));
}
function libraryResults() {
  const lib = state.library, items = libraryItems();
  return items.length ? items.map(item => {
    const added = lib.kind === 'skills' && state.project?.skills.some(s => s.name === item.name);
    return `<article class="catalog-card tone-${lib.kind === 'packs' ? packTone(item.id) : lib.kind === 'skills' ? 'expertise' : 'rules'}"><div class="spread"><span class="feature-icon">${icon(item.icon ?? 'pen')}</span><span class="catalog-tag">${esc(item.category ?? 'Behavior')}</span></div><h3>${item.title}</h3><p>${item.summary}</p>${lib.kind === 'packs' ? `<div class="catalog-skill-names">${item.skills.map(id => `<span>${esc(SKILLS.find(s => s.id === id).title)}</span>`).join('')}</div>` : ''}<div class="catalog-actions"><button class="text-btn" data-catalog-preview="${item.id}">Preview</button><button class="btn small ${added ? '' : 'soft'}" data-catalog-use="${item.id}" ${added ? 'disabled' : ''}>${icon(added ? 'check' : 'plus')}${added ? 'Added' : lib.creating ? 'Use template' : lib.kind === 'packs' ? 'Add pack' : lib.kind === 'skills' ? 'Add skill' : 'Use preset'}</button></div></article>`;
  }).join('') : '<div class="empty-state"><h3>No matching templates</h3><p>Change the search term or category.</p></div>';
}
function renderLibrary() {
  const lib = state.library, dialog = $('#library-dialog');
  const collection = lib.kind === 'packs' ? PACKS : lib.kind === 'skills' ? SKILLS : PROFILES;
  const categories = ['All', ...new Set(collection.map(s => s.category).filter(Boolean))];
  const item = collection.find(s => s.id === lib.selected);
  dialog.innerHTML = `<div class="dialog-head"><div><span class="eyebrow">${lib.creating ? 'New project' : 'Templates'}</span><h2 id="library-title">${lib.creating ? 'Create an agent' : 'Template library'}</h2><p>${lib.creating ? 'Select a template or create an empty project.' : 'Select instructions and skills to add to the current project.'}</p></div><button class="btn icon-only quiet" data-close-dialog="library-dialog" aria-label="Close template library">${icon('close')}</button></div>
    <div class="library-tabs" role="tablist" aria-label="Template type">${[['packs', 'Starter packs'], ['skills', 'Skills'], ['profiles', 'Behavior presets']].filter(([kind]) => !lib.creating || kind === 'packs').map(([kind, title]) => `<button role="tab" aria-selected="${lib.kind === kind}" data-library-kind="${kind}">${title}<span>${kind === 'packs' ? PACKS.length : kind === 'skills' ? SKILLS.length : PROFILES.length}</span></button>`).join('')}</div>
    <div class="dialog-body library-body">${item ? `<button class="text-btn" data-catalog-back>${icon('chevron')} Back to collection</button><div class="catalog-detail-heading"><span class="feature-icon large">${icon(item.icon ?? 'pen')}</span><div><h2>${item.title}</h2><p>${item.summary}</p></div></div>${lib.kind === 'packs' ? `<div class="catalog-detail-skills">${item.skills.map(id => { const s = SKILLS.find(x => x.id === id); return `<div>${icon(s.icon)}<strong>${s.title}</strong><p>${s.summary}</p></div>`; }).join('')}</div><h3>Default behavior</h3><pre class="template-preview">${esc(PROFILES.find(p => p.id === item.profile).text)}</pre>` : `<pre class="template-preview">${esc(item.instructions ?? item.text)}</pre>`}<button class="btn primary" data-catalog-use="${item.id}">${icon('plus')}${lib.creating ? 'Create with this pack' : lib.kind === 'profiles' ? 'Use this behavior' : 'Add to my agent'}</button>` : `<div class="library-filterbar"><label class="search-input">${icon('search')}<input id="library-search" data-library-search type="search" value="${esc(lib.query)}" placeholder="Search playbooks, tasks or business areas…" aria-label="Search templates"></label>${categories.length > 1 ? `<select data-library-category aria-label="Template category">${categories.map(c => `<option ${lib.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select>` : ''}</div><div class="catalog-grid" id="library-results">${libraryResults()}</div>`}</div>
    <div class="dialog-footer library-footer"><span>Review templates against the configured models and business definitions.</span>${lib.creating ? '<button class="btn" data-action="create-blank">Empty project</button>' : ''}</div>`;
}
async function useCatalog(id) {
  const kind = state.library.kind;
  if (kind === 'packs' && state.library.creating) {
    $('#library-dialog').close(); await createProject(id); return;
  }
  if (!state.project) { toast('Connect your account and create an agent to use this template.'); return; }
  if (isPublishing()) throw new Error('Wait for publishing to finish before changing this agent.');
  if (kind === 'packs') {
    state.project = applyPack(state.project, id);
    markChanged(); render(); renderLibrary(); toast('Pack skills added. Your existing name and core instructions were kept.');
  } else if (kind === 'skills') {
    addCatalogSkill(id); renderLibrary();
  } else { applyProfile(id); $('#library-dialog').close(); }
}
function addCatalogSkill(id) {
  if (isPublishing()) throw new Error('Wait for publishing to finish before changing this agent.');
  const skill = skillFromCatalog(id);
  if (state.project.skills.some(s => s.name === skill.name)) { toast('This skill is already in your agent.'); return; }
  if (state.project.skills.length >= 8) throw new Error('An agent can have at most eight skills.');
  state.project.skills.push(skill); markChanged(); state.tab = 'skills'; render(); toast(`${SKILLS.find(s => s.id === id).title} added.`);
}
function applyProfile(id) {
  const profile = PROFILES.find(p => p.id === id);
  if (!profile || state.project.instructions === profile.text) return;
  if (!confirm('Replace the current core instructions with this preset? Your sources and skills will stay unchanged.')) return;
  state.project.instructions = profile.text; markChanged(); render(); toast('Behavior updated. You can edit every instruction.');
}

function updateSaveStatus() {
  const status = $('#save-status'), button = $('#save-button');
  if (status) { status.textContent = saveLabel(); status.classList.toggle('failed', state.saveError); }
  if (button) button.disabled = state.saving || isPublishing();
}
function markChanged() {
  if (isPublishing()) return;
  state.dirty = true; state.files = null; state.change++; updateSaveStatus();
  clearTimeout(saveTimer);
  if (!state.saveError) saveTimer = setTimeout(() => { void save().catch(error => toast(error.message, true)); }, 1100);
}
async function save() {
  clearTimeout(saveTimer);
  if (savePromise) { await savePromise; return save(); }
  if (!state.project || !state.dirty || isPublishing()) return;
  const id = state.project.id, change = state.change;
  const payload = structuredClone(state.project);
  state.saving = true; updateSaveStatus();
  savePromise = (async () => {
    try {
      const saved = await api(`/projects/${id}`, { method: 'PUT', body: payload });
      if (state.project?.id === id) {
        state.project.revision = saved.revision;
        if (state.change === change) { state.project = saved; state.dirty = false; }
        state.saveError = false;
      }
    } catch (error) { state.saveError = true; throw error; }
    finally { state.saving = false; savePromise = null; updateSaveStatus(); }
  })();
  await savePromise;
}
async function enterWorkspace() {
  state.projects = await api('/projects'); state.entered = true; render();
}
async function createProject(packId = null) {
  await save();
  let project = await api('/projects', { method: 'POST', body: {} });
  let publisher;
  try { publisher = JSON.parse(localStorage.getItem('studio-publisher')); } catch {}
  if (publisher && typeof publisher === 'object') {
    for (const key of ['name', 'website', 'privacy', 'terms']) if (typeof publisher[key] === 'string') project.developer[key] = publisher[key];
  }
  if (packId) project = applyPack(project, packId, { newAgent: true });
  else project.instructions = PROFILES[0].text;
  state.project = project; state.tab = 'reports'; state.files = null; state.parsed = {}; state.sourceErrors = {};
  state.nameTouched = false; state.activePack = packId ?? 'general'; state.saveError = false;
  markChanged(); await save(); render();
}
async function openProject(id) {
  await save();
  state.project = await api(`/projects/${id}`); state.tab = 'reports'; state.dirty = false; state.saveError = false;
  state.files = null; state.parsed = {}; state.sourceErrors = {}; state.nameTouched = true; render();
}
async function parseReport(index) {
  const report = state.project?.reports[index];
  if (!report || !report.url.trim()) return;
  const projectId = state.project.id, url = report.url;
  if (state.parsed[url]) return;
  try {
    const parsed = await api('/sources/parse', { method: 'POST', body: { url } });
    state.parsed[url] = parsed; delete state.sourceErrors[url];
  } catch (error) { state.sourceErrors[url] = error.message; }
  if (state.project?.id === projectId && state.tab === 'reports' && !document.activeElement?.matches('[data-report]')) render();
}
async function preview() {
  await save(); state.files = await api(`/projects/${state.project.id}/files`); state.selectedFile = 0; state.tab = 'files'; render();
}
async function download(kind) {
  await save();
  const blob = await api(`/projects/${state.project.id}/${kind}`, { binary: true });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = kind === 'package' ? 'analytics-agent-app.zip' : 'analytics-agent-source.zip';
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function reviewPublish(check) {
  const p = state.project, dialog = $('#publish-dialog');
  dialog.innerHTML = `<div class="dialog-head"><div><span class="eyebrow">Personal deployment</span><h2 id="publish-title">Publish to your Copilot</h2><p>The saved project will be validated and published for this account.</p></div><button class="btn icon-only quiet" data-close-dialog="publish-dialog" aria-label="Close">${icon('close')}</button></div><div class="dialog-body">
    <div class="publish-summary"><span class="feature-icon large">${icon('chart')}</span><div><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p></div></div><div class="summary-row"><span>Account</span><strong>${esc(state.account)}</strong></div><div class="summary-row"><span>Audience</span><strong>Only you · Personal</strong></div><div class="summary-row"><span>Package</span><strong>v${esc(p.version)} · ${p.reports.length} sources · ${p.skills.length} skills</strong></div>
    <details class="publisher-review section-space" ${check.errors.some(e => /Publisher|Privacy|Terms|publisher/.test(e)) ? 'open' : ''}><summary>Publisher details <span class="counter">Required by Microsoft 365</span></summary><div class="section-space">${publisherFields('review')}<label class="checkbox-label"><input id="remember-publisher" type="checkbox"> Remember these publisher details for new agents in this browser</label></div></details>
    ${check.valid ? `<div class="notice success section-space">${icon('check')}<span>Local checks passed. Microsoft Toolkit will run official package validation next.</span></div>` : `<ul class="check-list errors">${check.errors.map(e => `<li>${icon('info')}<span>${esc(e)}</span></li>`).join('')}</ul>`}
    <details class="disclosure section-space"><summary>Availability and permissions</summary><p class="small muted section-space">Publishing does not grant Microsoft 365 Copilot, Fabric IQ or Power BI entitlements. Tenant policies and propagation can affect discovery and use. Source links are structurally checked, not validated against live data.</p></details>
    </div><div class="dialog-footer"><button class="btn" data-action="recheck-publish">Save &amp; recheck</button><button class="btn primary" data-action="confirm-publish" ${check.valid ? '' : 'disabled'}>${icon('rocket')} Confirm personal publish</button></div>`;
  if (!dialog.open) dialog.showModal();
}
function renderJob() {
  const job = state.job;
  if (!job) return;
  const running = job.status === 'running', success = job.status === 'succeeded', dialog = $('#operation-dialog');
  dialog.innerHTML = `<div class="dialog-head"><div><h2 id="operation-title">${job.kind === 'login' ? 'Microsoft 365 sign-in' : 'Publishing your agent'}</h2><p>${running ? 'You can leave this panel open or keep working.' : 'Operation finished.'}</p></div><button class="btn icon-only quiet" data-close-dialog="operation-dialog" aria-label="Close operation details">${icon('close')}</button></div><div class="dialog-body">
    <div class="operation-status ${job.status === 'failed' ? 'failed' : ''}">${running ? '<span class="spinner"></span>' : icon(success ? 'check' : 'info')}<span>${running ? job.kind === 'login' ? 'Complete sign-in in Microsoft’s browser window' : 'Microsoft Toolkit is validating and publishing…' : success ? job.kind === 'login' ? 'Connected to Microsoft 365' : 'Personal deployment completed' : 'Operation needs attention'}</span></div>
    ${job.error ? `<div class="notice error">${icon('info')}<span>${esc(job.error)}</span></div>` : ''}<details class="operation-details" ${job.status === 'failed' ? 'open' : ''}><summary>Technical log</summary><pre class="job-log" tabindex="0">${esc(job.logs.join('\n') || 'Starting…')}</pre></details>
    ${success && job.kind === 'publish' ? `<div class="notice success section-space">${icon('check')}<span>Microsoft accepted the deployment. Search All agents in Copilot if it is not in the sidebar yet. Availability still depends on licensing and tenant policies.</span></div>` : ''}</div><div class="dialog-footer">${success && job.result?.deployment ? `<a class="btn" href="${esc(job.result.deployment.shareLink)}" target="_blank" rel="noopener noreferrer">Open Copilot ${icon('arrow')}</a>` : ''}<button class="btn ${running ? '' : 'primary'}" data-close-dialog="operation-dialog">${running ? 'Keep working' : 'Done'}</button></div>`;
}
async function monitorJob(job) {
  state.job = job; sessionStorage.setItem('studio-job', job.id);
  renderJob(); if (!$('#operation-dialog').open) $('#operation-dialog').showModal();
  const poll = async () => {
    try {
      state.job = await api(`/jobs/${job.id}`); renderJob();
      if (state.job.status === 'running') return setTimeout(poll, 1200);
      sessionStorage.removeItem('studio-job');
      if (state.job.status === 'succeeded') {
        if (state.job.kind === 'login') { state.account = state.job.result.account; state.authLoading = false; await enterWorkspace(); }
        else if (state.project?.id === state.job.projectId) {
          state.project = await api(`/projects/${state.project.id}`); state.dirty = false; state.files = null; render();
        } else if (state.entered) { state.projects = await api('/projects'); render(); }
      } else render();
      updateSaveStatus();
    } catch (error) { toast(error.message, true); sessionStorage.removeItem('studio-job'); }
  };
  await poll();
}
function rememberPublisher() {
  if ($('#remember-publisher')?.checked) {
    try { localStorage.setItem('studio-publisher', JSON.stringify(state.project.developer)); }
    catch { toast('Your browser could not remember publisher details. The current draft will still be saved.'); }
  }
}

document.addEventListener('input', event => {
  const el = event.target;
  if (el.dataset.librarySearch !== undefined) { state.library.query = el.value; $('#library-results').innerHTML = libraryResults(); return; }
  if (!state.project || isPublishing()) return;
  if (el.dataset.field) {
    const keys = el.dataset.field.split('.');
    if (keys.length === 2) state.project[keys[0]][keys[1]] = el.value;
    else state.project[keys[0]] = el.value;
    if (el.dataset.field === 'name') { state.nameTouched = true; if ($('#preview-name')) $('#preview-name').textContent = el.value; }
    if (el.dataset.field === 'description' && $('#preview-description')) $('#preview-description').textContent = el.value;
    if (el.dataset.field === 'instructions' && $('#instruction-count')) $('#instruction-count').textContent = `${el.value.length.toLocaleString()} characters`;
  } else if (el.dataset.report !== undefined) state.project.reports[+el.dataset.report][el.dataset.key] = el.value;
  else if (el.dataset.skill !== undefined) state.project.skills[+el.dataset.skill][el.dataset.key] = el.value;
  else return;
  if ($('#publish-dialog').open) $('#publish-dialog [data-action="confirm-publish"]').disabled = true;
  markChanged();
});
document.addEventListener('focusout', event => {
  const el = event.target;
  if (!state.project || isPublishing()) return;
  if (el.dataset.field?.startsWith('developer.') && el.type === 'url') {
    const value = normalizeHttps(el.value);
    if (value !== el.value) { el.value = value; state.project.developer[el.dataset.field.split('.')[1]] = value; markChanged(); }
  }
  if (el.dataset.report !== undefined && el.dataset.key === 'url') {
    const report = state.project.reports[+el.dataset.report], value = normalizeHttps(el.value);
    if (value !== report.url) { report.url = value; el.value = value; markChanged(); }
    void parseReport(+el.dataset.report);
  }
  if (el.dataset.report === '0' && el.dataset.key === 'name' && !state.nameTouched && el.value.trim()) {
    state.project.name = `${el.value.trim()} insights`.slice(0, 30); markChanged();
  }
});
document.addEventListener('click', event => {
  const el = event.target.closest('button,a');
  if (!el || el.disabled) return;
  if (el.dataset.closeDialog) return $(`#${el.dataset.closeDialog}`).close();
  if (el.dataset.tab) { state.tab = el.dataset.tab; render(); return; }
  if (el.dataset.file !== undefined) { state.selectedFile = +el.dataset.file; render(); return; }
  if (el.dataset.library) { openLibrary(el.dataset.library); return; }
  if (el.dataset.libraryKind) { Object.assign(state.library, { kind: el.dataset.libraryKind, query: '', category: 'All', selected: null }); renderLibrary(); return; }
  if (el.dataset.catalogPreview) { state.library.selected = el.dataset.catalogPreview; renderLibrary(); return; }
  if (el.dataset.catalogBack !== undefined) { state.library.selected = null; renderLibrary(); return; }
  void perform(async () => {
    if (isPublishing() && (el.dataset.removeReport !== undefined || el.dataset.removeSkill !== undefined || ['add-report', 'add-skill', 'import-skill'].includes(el.dataset.action))) {
      throw new Error('Wait for publishing to finish before changing this agent.');
    }
    if (el.dataset.open) return openProject(el.dataset.open);
    if (el.dataset.createPack) { if (!state.entered) return; return createProject(el.dataset.createPack); }
    if (el.dataset.catalogUse) return useCatalog(el.dataset.catalogUse);
    if (el.dataset.profile) { if (isPublishing()) throw new Error('Wait for publishing to finish.'); return applyProfile(el.dataset.profile); }
    if (el.dataset.addSkill) return addCatalogSkill(el.dataset.addSkill);
    if (el.dataset.removeReport !== undefined) { state.project.reports.splice(+el.dataset.removeReport, 1); markChanged(); render(); return; }
    if (el.dataset.removeSkill !== undefined) { state.project.skills.splice(+el.dataset.removeSkill, 1); markChanged(); render(); return; }
    if (el.dataset.parseReport !== undefined) { await parseReport(+el.dataset.parseReport); render(); return; }
    switch (el.dataset.action) {
      case 'agent-guide': {
        const dialog = $('#guide-dialog');
        dialog.innerHTML = `<div class="guide-dialog-header"><span>Agent Studio / Documentation</span><button class="btn icon-only quiet" data-close-dialog="guide-dialog" aria-label="Close agent guide">${icon('close')}</button></div><div class="dialog-body"><agent-guide></agent-guide></div>`;
        dialog.showModal();
        break;
      }
      case 'theme': {
        const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = theme;
        try { localStorage.setItem('studio-theme', theme); } catch {}
        render(); break;
      }
      case 'signin': {
        const result = await api('/auth/login', { method: 'POST', body: { tenant: $('#tenant')?.value.trim() || '' } });
        if (result.redirect) { window.location.assign(result.redirect); break; }
        await monitorJob(result); break;
      }
      case 'continue': await enterWorkspace(); break;
      case 'refresh-auth': {
        state.authLoading = true; render();
        try { const account = await api('/auth/status'); state.account = account.account; }
        finally { state.authLoading = false; render(); }
        break;
      }
      case 'signout':
        if (!confirm(state.hosting.mode === 'hosted' ? 'Sign out of your Agent Studio session?' : 'Sign out of Microsoft 365 Agents Toolkit on this computer? Other local Toolkit sessions share this connection.')) break;
        await save();
        await api('/auth/logout', { method: 'POST', body: {} });
        state.account = null; state.project = null; state.dirty = false; state.entered = false; render(); break;
      case 'new': openLibrary('packs', true); break;
      case 'create-blank': $('#library-dialog').close(); await createProject(); break;
      case 'home': await save(); state.project = null; await enterWorkspace(); break;
      case 'save': await save(); toast('Draft saved.'); break;
      case 'add-report':
        if (state.project.reports.length >= 20) throw new Error('Add at most 20 sources.');
        state.project.reports.push({ name: `Power BI source ${state.project.reports.length + 1}`, url: '', description: '' });
        markChanged(); render(); $(`#report-url-${state.project.reports.length - 1}`)?.focus(); break;
      case 'add-skill':
        if (state.project.skills.length >= 8) throw new Error('An agent can have at most eight skills.');
        state.project.skills.push({ name: '', description: '', instructions: '', recipes: '' }); markChanged(); render(); break;
      case 'import-skill': $('#skill-import').click(); break;
      case 'preview': await preview(); break;
      case 'download': await download('download'); break;
      case 'download-package': await download('package'); break;
      case 'review-publish':
      case 'recheck-publish':
        rememberPublisher(); await save(); reviewPublish(await api(`/projects/${state.project.id}/check`)); break;
      case 'confirm-publish': {
        rememberPublisher(); await save(); $('#publish-dialog').close();
        const job = await api(`/projects/${state.project.id}/publish`, { method: 'POST', body: { confirmPersonal: true } });
        await monitorJob(job); render(); break;
      }
      case 'show-job': renderJob(); if (!$('#operation-dialog').open) $('#operation-dialog').showModal(); break;
    }
  });
});
document.addEventListener('change', event => {
  if (event.target.dataset.libraryCategory !== undefined) {
    state.library.category = event.target.value; $('#library-results').innerHTML = libraryResults(); return;
  }
  if (event.target.id !== 'skill-import') return;
  void perform(async () => {
    if (!state.project || isPublishing()) throw new Error('Open an editable agent before importing a skill.');
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 100000) throw new Error('Import a SKILL.md smaller than 100 KB.');
    const content = await file.text(), match = /^---\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/.exec(content);
    if (!match) throw new Error('The file needs YAML frontmatter with name and description.');
    const read = key => {
      const value = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(match[1])?.[1]?.trim() ?? '';
      if (value.startsWith('"')) { try { return JSON.parse(value); } catch { throw new Error(`Use a single-line ${key} value.`); } }
      return value.replace(/^'(.*)'$/, '$1');
    };
    if (state.project.skills.length >= 8) throw new Error('An agent can have at most eight skills.');
    const name = read('name'), description = read('description');
    if (!name || !description || ['|', '>'].includes(description)) throw new Error('Use single-line name and description frontmatter.');
    if (state.project.skills.some(s => s.name === name)) throw new Error('A skill with this name is already in the agent.');
    state.project.skills.push({ name, description, instructions: match[2].trim(), recipes: '' }); markChanged(); render();
    toast('Skill imported. Supporting files are not imported; add their guidance in the recipe editor.');
  });
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && state.project) {
    event.preventDefault(); void perform(async () => { await save(); toast('Draft saved.'); });
  }
  if (event.key === 'Escape') for (const menu of document.querySelectorAll('.account-menu[open]')) menu.open = false;
});
window.addEventListener('beforeunload', event => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
async function init() {
  render();
  try {
    const bootstrap = await fetch('/api/bootstrap').then(r => { if (!r.ok) throw new Error('Local server is unavailable.'); return r.json(); });
    state.token = bootstrap.csrfToken; state.hosting = bootstrap.hosting ?? { mode: 'local' };
    const account = await api('/auth/status'); state.account = account.account;
  } catch (error) { toast(error.message, true); }
  state.authLoading = false; render();
  const pendingJob = sessionStorage.getItem('studio-job');
  if (pendingJob) {
    try { await monitorJob(await api(`/jobs/${pendingJob}`)); }
    catch { sessionStorage.removeItem('studio-job'); }
  }
}
void init();
