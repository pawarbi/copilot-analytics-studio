import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_INSTRUCTIONS = `Answer business questions using only the configured Power BI sources and the Fabric IQ AskPowerBI action.
Use existing governed measures and verify metric definitions, dates, grain and filters. Do not invent schema objects, values, units or causal explanations.
Ask for clarification when different interpretations materially change the answer.
Preserve the selected source and filters in follow-up questions. Pass prior context to AskPowerBI.
State the source, period, filters, units and material assumptions. Cite the linked Power BI source.
Keep all requests read-only, aggregated and bounded. On access or identity errors, report the error; never substitute an unrelated source.
Code Interpreter may analyze and chart returned data only; it is not an alternate data-access path.`;

export class InputError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function text(value, label, max, fallback = '') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max) throw new InputError(`${label} must be text of at most ${max} characters.`);
  if (/\$\[\s*file\s*\(|\$\{\{/.test(value)) throw new InputError(`${label} cannot contain Toolkit file or environment substitution expressions.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new InputError(`${label} contains unsupported control characters.`);
  return value;
}

export function newProject() {
  const now = new Date().toISOString();
  return {
    id: randomUUID(), revision: 1, createdAt: now, updatedAt: now,
    name: 'My analytics agent', description: 'Business insights grounded in curated Power BI data.',
    version: '1.0.0', instructions: DEFAULT_INSTRUCTIONS, reports: [], skills: [],
    developer: { name: 'Analytics Studio', website: '', privacy: '', terms: '' },
    deployment: null
  };
}

export function normalizeProject(input, previous = newProject()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('A project object is required.');
  if (!Array.isArray(input.reports ?? []) || (input.reports ?? []).length > 20) throw new InputError('Add at most 20 Power BI sources.');
  if (!Array.isArray(input.skills ?? []) || (input.skills ?? []).length > 8) throw new InputError('Add at most eight skills.');
  const reports = (input.reports ?? []).map((r, i) => {
    if (!r || typeof r !== 'object') throw new InputError('Each report must be an object.');
    return { name: text(r.name, `Source ${i + 1} name`, 120), url: text(r.url, 'Power BI URL', 2000), description: text(r.description, 'Source guidance', 2000) };
  });
  const skills = (input.skills ?? []).map((s, i) => {
    if (!s || typeof s !== 'object') throw new InputError('Each skill must be an object.');
    return {
      name: text(s.name, `Skill ${i + 1} name`, 64),
      description: text(s.description, 'Skill description', 1024),
      instructions: text(s.instructions, 'Skill instructions', 18000),
      recipes: text(s.recipes, 'Skill reference recipes', 50000)
    };
  });
  const developer = input.developer ?? {};
  return {
    ...previous,
    name: text(input.name, 'Agent name', 30),
    description: text(input.description, 'Description', 128),
    version: text(input.version, 'Version', 30, '1.0.0'),
    instructions: text(input.instructions, 'Instructions', 8000),
    reports, skills,
    developer: {
      name: text(developer.name, 'Publisher name', 32),
      website: text(developer.website, 'Publisher website', 500),
      privacy: text(developer.privacy, 'Privacy policy URL', 500),
      terms: text(developer.terms, 'Terms URL', 500)
    }
  };
}

export function parsePowerBiUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new InputError('Enter a full HTTPS Power BI report or semantic-model URL.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !(host === 'app.fabric.microsoft.com' || host === 'powerbi.com' || host.endsWith('.powerbi.com'))) {
    throw new InputError('Use an HTTPS link on powerbi.com or app.fabric.microsoft.com.');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const groupIndex = parts.findIndex(p => p.toLowerCase() === 'groups');
  const workspaceId = groupIndex >= 0 ? parts[groupIndex + 1] : url.searchParams.get('groupId');
  const artifactIndex = parts.findIndex(p => ['reports', 'datasets', 'modeling', 'semanticmodels'].includes(p.toLowerCase()));
  const artifactId = artifactIndex >= 0 ? parts[artifactIndex + 1] : url.searchParams.get('reportId');
  if (!GUID.test(artifactId ?? '')) throw new InputError('The link must contain a report or semantic-model GUID; short sharing links are not supported.');
  if (groupIndex >= 0 && workspaceId !== 'me' && !GUID.test(workspaceId ?? '')) throw new InputError('The workspace identifier in this URL is invalid.');
  const type = artifactIndex >= 0 && parts[artifactIndex].toLowerCase() !== 'reports' ? 'Semantic model' : 'Report';
  return { artifactId, workspaceId: GUID.test(workspaceId ?? '') ? workspaceId : null, type, url: url.href };
}

const cell = value => value.replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');

export function buildInstructions(project) {
  const lines = [
    project.instructions.trim(),
    '\n## Approved Power BI sources\n',
    '| Source | Type | artifactId | When to use it |',
    '| --- | --- | --- | --- |'
  ];
  for (const report of project.reports) {
    const parsed = parsePowerBiUrl(report.url);
    lines.push(`| ${cell(report.name)} | ${parsed.type} | ${parsed.artifactId} | ${cell(report.description)} |`);
  }
  lines.push('\nPass the selected artifactId directly to AskPowerBI. Ask if source selection is ambiguous. A parsed URL does not establish access, schema or metric definitions.');
  for (const report of project.reports) lines.push(`Source link for ${cell(report.name)}: ${report.url}`);
  if (project.skills.length) {
    lines.push('\n## Available task skills\nLoad the relevant configured skill when its task matches. Skill instructions guide analysis; DAX recipes are references, not an additional data-access tool.');
    for (const skill of project.skills) lines.push(`- ${skill.name}: ${skill.description}`);
  }
  return `${lines.join('\n')}\n`;
}

export function validateProject(project, { publish = false } = {}) {
  const errors = [], warnings = [];
  if (!project.name.trim()) errors.push('Give your agent a name.');
  if (!project.description.trim()) errors.push('Add an agent description.');
  if (!/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(project.version) || project.version.split('.').some(n => +n > 65535)) errors.push('Use a version such as 1.0.0 (each part at most 65535).');
  if (!project.instructions.trim()) errors.push('Add agent instructions.');
  if (!project.reports.length) errors.push('Add at least one Power BI report or semantic model.');
  const artifactIds = new Set();
  for (const [i, report] of project.reports.entries()) {
    if (!report.name.trim()) errors.push(`Source ${i + 1} needs a name.`);
    try {
      const { artifactId } = parsePowerBiUrl(report.url);
      if (artifactIds.has(artifactId.toLowerCase())) errors.push(`Source ${i + 1} duplicates an existing artifact.`);
      artifactIds.add(artifactId.toLowerCase());
    } catch (e) { errors.push(`Source ${i + 1}: ${e.message}`); }
    if (!report.description.trim()) warnings.push(`Add routing and business context for source ${i + 1}.`);
  }
  const skillNames = new Set();
  for (const [i, skill] of project.skills.entries()) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name)) errors.push(`Skill ${i + 1} needs a lowercase, hyphen-separated name.`);
    if (skillNames.has(skill.name)) errors.push(`Skill name "${skill.name}" is duplicated.`);
    skillNames.add(skill.name);
    if (!skill.description.trim() || !skill.instructions.trim()) errors.push(`Skill ${i + 1} needs a description and instructions.`);
    if (skillDocument(skill).length >= 20000) errors.push(`Skill ${i + 1} exceeds the 20,000-character instruction limit.`);
  }
  if (!project.developer.name.trim()) errors.push('Add a publisher name.');
  for (const [field, label] of [['website', 'Publisher website'], ['privacy', 'Privacy policy'], ['terms', 'Terms of use']]) {
    try {
      const url = new URL(project.developer[field]);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
      if (publish && ['example.com', 'example.org', 'example.net'].includes(url.hostname)) errors.push(`${label} must be a real publisher URL, not an example domain.`);
    } catch { errors.push(`${label} must be an HTTPS URL.`); }
  }
  if (!errors.length && buildInstructions(project).length > 8000) errors.push('Combined agent instructions and source routing exceed 8,000 characters. Move task details into skills.');
  warnings.push('Source links are structurally checked only. Users still need Power BI access; schemas and numbers are not verified here.');
  return { valid: errors.length === 0, errors, warnings };
}

function skillDocument(skill) {
  return `---\nname: ${JSON.stringify(skill.name)}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.instructions.trim()}\n${skill.recipes.trim() ? '\nConsult references/dax-recipes.md for dataset-specific definitions and recipe examples. Use supported agent actions for data access; do not assume AskPowerBI executes supplied DAX verbatim.\n' : ''}`;
}

export function pluginManifest() {
  const properties = { artifactId: { type: 'string' }, query: { type: 'string' }, context: { type: 'string' } };
  const parameters = { type: 'object', properties, required: ['artifactId', 'query'] };
  const semantics = {
    data_path: '$.content[*]._meta.artifact_citation',
    properties: { title: '$.Name', subtitle: '$.Description', url: '$.Url', information_protection_label: '$.SensitivityLabelId', thumbnail_url: '$.IconUrl' }
  };
  return {
    $schema: 'https://developer.microsoft.com/json-schemas/copilot/plugin/v2.4/schema.json',
    schema_version: 'v2.4', namespace: 'fabriciq', name_for_human: 'Fabric IQ',
    description_for_human: 'Answers questions grounded in curated Power BI reports and semantic models.',
    description_for_model: 'Ask business questions about configured Power BI artifacts. Use the artifactId in the agent routing table.',
    functions: [{
      name: 'AskPowerBI', description: 'Answers a Power BI report or model question via DAX. Include prior context on follow-ups.',
      parameters, capabilities: { response_semantics: semantics }
    }],
    runtimes: [{
      type: 'RemoteMCPServer', auth: { type: 'None' },
      spec: {
        url: 'https://api.fabric.microsoft.com/v1/mcp/fabricaihub/integrations/m365',
        mcp_tool_description: { tools: [{
          name: 'AskPowerBI', description: 'Answers a Power BI report or model question via DAX.',
          inputSchema: parameters,
          annotations: { destructiveHint: false, openWorldHint: false, readOnlyHint: true },
          _meta: { variants: 'Fabric.Routing.M365.V1', 'microsoft/response_semantics': { ...semantics, properties: { ...semantics.properties, 'x-ms_unique_id': '$.ArtifactId' } } }
        }] }
      },
      run_for_functions: ['AskPowerBI']
    }]
  };
}

export function parseEnvironment(content = '') {
  return Object.fromEntries(content.split(/\r?\n/).flatMap(line => {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    return match ? [[match[1], match[2].replace(/^"(.*)"$/, '$1')]] : [];
  }));
}

export function generateFiles(project, existingEnvironment = {}) {
  const validation = validateProject(project);
  if (!validation.valid) throw new InputError(validation.errors.join(' '));
  const manifest = {
    $schema: 'https://developer.microsoft.com/json-schemas/teams/v1.25/MicrosoftTeams.schema.json',
    manifestVersion: '1.25', version: project.version, id: '${{TEAMS_APP_ID}}',
    developer: { name: project.developer.name, websiteUrl: project.developer.website, privacyUrl: project.developer.privacy, termsOfUseUrl: project.developer.terms },
    icons: { color: 'color.png', outline: 'outline.png' },
    name: { short: project.name, full: project.name },
    description: { short: project.description, full: project.description },
    accentColor: '#B11F4B',
    copilotAgents: { declarativeAgents: [{ id: 'analyticsAgent', file: 'declarativeAgent.json' }] },
    validDomains: ['api.fabric.microsoft.com']
  };
  const agent = {
    $schema: 'https://developer.microsoft.com/json-schemas/copilot/declarative-agent/v1.9/schema.json',
    version: 'v1.9', name: project.name, description: project.description,
    instructions: "$[file('agent_instructions.md')]",
    actions: [{ id: 'AskPowerBI', file: 'ai-plugin.json' }],
    capabilities: [{ name: 'CodeInterpreter' }],
    conversation_starters: [
      { title: 'Business overview', text: 'Summarize the available business KPIs for the latest complete period. State the source and assumptions.' },
      { title: 'Explore a trend', text: 'Show the trend in an available sales or operational KPI, using its verified definition.' },
      { title: 'Metric definitions', text: 'Explain the available KPI definitions and clarify ambiguous measures.' }
    ],
    ...(project.skills.length ? { agent_skills: project.skills.map(s => ({ folder: `skills/${s.name}` })) } : {})
  };
  const env = {
    TEAMSFX_ENV: 'dev', AGENT_NAME: project.name, AGENT_SCOPE: 'personal',
    ...Object.fromEntries(['TEAMS_APP_ID', 'M365_TITLE_ID', 'M365_APP_ID', 'SHARE_LINK', 'TEAMS_APP_TENANT_ID'].map(k => [k, existingEnvironment[k] ?? '']))
  };
  if (env.M365_TITLE_ID) env.M365_AGENT_ID = `${env.M365_TITLE_ID}.analyticsAgent`;
  const json = value => `${JSON.stringify(value, null, 2)}\n`;
  const files = {
    'appPackage/manifest.json': json(manifest),
    'appPackage/declarativeAgent.json': json(agent),
    'appPackage/agent_instructions.md': buildInstructions(project),
    'appPackage/ai-plugin.json': json(pluginManifest()),
    'appPackage/color.png': createIcon(192, true),
    'appPackage/outline.png': createIcon(32, false),
    'env/.env.dev': `${Object.entries(env).map(([k, v]) => `${k}=${String(v).replace(/[\r\n]/g, ' ')}`).join('\n')}\n`,
    '.gitignore': '*.user\nappPackage/build/\n',
    'm365agents.yml': `# yaml-language-server: $schema=https://aka.ms/m365-agents-toolkits/v1.10/yaml.schema.json
version: v1.10
environmentFolderPath: '.\\env'
provision:
  - uses: teamsApp/create
    with:
      name: \${{AGENT_NAME}}
    writeToEnvironmentFile:
      teamsAppId: TEAMS_APP_ID
  - uses: teamsApp/validateManifest
    with:
      manifestPath: '.\\appPackage\\manifest.json'
  - uses: teamsApp/zipAppPackage
    with:
      manifestPath: '.\\appPackage\\manifest.json'
      outputZipPath: '.\\appPackage\\build\\appPackage.\${{TEAMSFX_ENV}}.zip'
      outputFolder: '.\\appPackage\\build'
  - uses: teamsApp/validateAppPackage
    with:
      appPackagePath: '.\\appPackage\\build\\appPackage.\${{TEAMSFX_ENV}}.zip'
  - uses: teamsApp/update
    with:
      appPackagePath: '.\\appPackage\\build\\appPackage.\${{TEAMSFX_ENV}}.zip'
  - uses: teamsApp/extendToM365
    with:
      appPackagePath: '.\\appPackage\\build\\appPackage.\${{TEAMSFX_ENV}}.zip'
      scope: personal
    writeToEnvironmentFile:
      titleId: M365_TITLE_ID
      appId: M365_APP_ID
      shareLink: SHARE_LINK
projectId: ${project.id}
`
  };
  for (const skill of project.skills) {
    files[`appPackage/skills/${skill.name}/SKILL.md`] = skillDocument(skill);
    if (skill.recipes.trim()) files[`appPackage/skills/${skill.name}/references/dax-recipes.md`] = `${skill.recipes.trim()}\n`;
  }
  return files;
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

export function createIcon(size, color) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = y * (size * 4 + 1) + 1 + x * 4;
      const bar = [0.27, 0.45, 0.63].some((left, i) => x >= size * left && x < size * (left + 0.11) && y >= size * (0.55 - i * 0.15) && y < size * 0.76);
      const rgba = bar ? [255, 255, 255, 255] : color ? [177, 31, 75, 255] : [0, 0, 0, 0];
      raw.set(rgba, p);
    }
  }
  const chunk = (name, data) => {
    const type = Buffer.from(name), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([length, type, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
