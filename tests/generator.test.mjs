import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFiles, normalizeProject, parsePowerBiUrl, validateProject } from '../lib/generator.mjs';
import { parseAccount, redact } from '../lib/toolkit.mjs';
import { validProject, reportId, workspaceId, titleId } from './fixtures.mjs';

test('parses direct report, personal report, semantic-model and query links', () => {
  const source = validProject().reports[0];
  assert.deepEqual(parsePowerBiUrl(source.url), { artifactId: reportId, workspaceId, type: 'Report', url: source.url });
  assert.equal(parsePowerBiUrl(`https://app.fabric.microsoft.com/groups/${workspaceId}/datasets/${reportId}/details`).type, 'Semantic model');
  assert.equal(parsePowerBiUrl(`https://app.powerbi.com/groups/me/reports/${reportId}`).workspaceId, null);
  assert.equal(parsePowerBiUrl(`https://app.powerbi.com/reportEmbed?reportId=${reportId}&groupId=${workspaceId}`).workspaceId, workspaceId);
  for (const url of [
    `https://app.powerbi.com.attacker.test/groups/${workspaceId}/reports/${reportId}`,
    `https://user:pass@app.powerbi.com/reports/${reportId}`,
    `http://app.powerbi.com/reports/${reportId}`,
    `https://app.powerbi.com:8443/reports/${reportId}`,
    'https://app.powerbi.com/links/short-link',
    `https://app.powerbi.com/groups/not-a-guid/reports/${reportId}`
  ]) assert.throws(() => parsePowerBiUrl(url), /HTTPS|GUID|identifier/);
});

test('rejects unsafe substitutions and generated skill paths without allowing identity overrides', () => {
  const project = validProject();
  for (const instructions of ['${{SECRET}}', "$[file('..\\secret')]"]) {
    assert.throws(() => normalizeProject({ ...project, instructions }), /substitution/);
  }
  assert.throws(() => normalizeProject({ ...project, reports: Array(21).fill(project.reports[0]) }), /20/);
  assert.throws(() => normalizeProject({ ...project, skills: Array(9).fill(project.skills[0]) }), /eight/);
  const unsafe = normalizeProject({ ...project, skills: [{ ...project.skills[0], name: '../escape' }] }, project);
  assert.throws(() => generateFiles(unsafe), /hyphen/);
  const normalized = normalizeProject({ ...project, id: 'other', deployment: { titleId: 'other' } }, project);
  assert.equal(normalized.id, project.id);
  assert.equal(normalized.deployment, null);
});

test('requires a type for bare GUIDs and generates report or model routing without inventing links', () => {
  for (const type of ['Report', 'Semantic model']) {
    assert.deepEqual(parsePowerBiUrl(` ${reportId} `, type), { artifactId: reportId, workspaceId: null, type, url: null });
    const project = validProject();
    project.reports[0] = { ...project.reports[0], url: reportId, type };
    const normalized = normalizeProject(project, project);
    assert.equal(normalized.reports[0].type, type);
    assert.equal(validateProject(normalized).valid, true);
    const instructions = generateFiles(normalized)['appPackage/agent_instructions.md'];
    assert.ok(instructions.includes(`| ${type} | ${reportId} |`));
    assert.doesNotMatch(instructions, /Source link for/);
    assert.match(instructions, /use citations returned by AskPowerBI/);
    project.reports.push(validProject().reports[0]);
    assert.match(validateProject(project).errors.join(), /duplicates/);
  }
  for (const type of [undefined, '', 'Other']) assert.throws(() => parsePowerBiUrl(reportId, type), /Choose Report or Semantic model/);
  assert.throws(() => parsePowerBiUrl('not-a-guid', 'Report'), /GUID/);
  assert.throws(() => normalizeProject({ ...validProject(), reports: [{ ...validProject().reports[0], type: 'Other' }] }), /source type/);
  assert.equal(parsePowerBiUrl(validProject().reports[0].url, 'Semantic model').type, 'Report', 'Links must determine their own type.');
});

test('checks duplicates, required publisher URLs and final instruction budget', () => {
  const project = validProject();
  assert.equal(validateProject(project, { publish: true }).valid, true);
  assert.match(validateProject({ ...project, reports: [...project.reports, ...project.reports] }).errors.join(), /duplicates/);
  assert.match(validateProject({ ...project, instructions: 'x'.repeat(8000) }).errors.join(), /8,000/);
  assert.match(validateProject({ ...project, developer: { ...project.developer, privacy: 'https://example.com/privacy' } }, { publish: true }).errors.join(), /real publisher/);
  assert.match(validateProject({ ...project, skills: [...project.skills, ...project.skills] }).errors.join(), /duplicated/);
});

test('generates real source routing, skill references and a personal-by-default lifecycle while excluding secrets', () => {
  const project = validProject();
  const files = generateFiles(project, { M365_TITLE_ID: titleId, TEAMS_APP_ID: reportId, SECRET: 'never-export', ACCESS_TOKEN: 'never-export' });
  const agent = JSON.parse(files['appPackage/declarativeAgent.json']);
  assert.deepEqual(agent.agent_skills, [{ folder: 'skills/sales-review' }]);
  assert.match(files['appPackage/skills/sales-review/SKILL.md'], /references\/dax-recipes.md/);
  assert.match(files['appPackage/skills/sales-review/references/dax-recipes.md'], /Sales Amount/);
  assert.match(files['appPackage/agent_instructions.md'], new RegExp(reportId));
  assert.match(files['env/.env.dev'], new RegExp(`${titleId}.analyticsAgent`));
  assert.doesNotMatch(Object.values(files).join(), /never-export/);
  assert.match(files['m365agents.yml'], /teamsApp\/validateAppPackage/);
  assert.match(files['m365agents.yml'], /scope: personal/);
  assert.doesNotMatch(files['m365agents.yml'], /scope: tenant|teamsApp\/publishAppPackage/);
  project.skills[0].recipes = '';
  assert.equal(generateFiles(project)['appPackage/skills/sales-review/references/dax-recipes.md'], undefined);
});

test('preserves server-owned personal and shared identities when switching modes, including legacy projects', () => {
  const personal = { scope: 'personal', titleId, packageId: reportId };
  const legacy = { ...validProject(), deployment: personal };
  delete legacy.deploymentScope; delete legacy.deployments;
  const shared = normalizeProject({ ...legacy, deploymentScope: 'shared', deployments: { shared: { titleId: 'injected' } } }, legacy);
  assert.equal(shared.deployment, null);
  assert.deepEqual(shared.deployments.personal, personal);
  const back = normalizeProject({ ...shared, deploymentScope: 'personal' }, shared);
  assert.deepEqual(back.deployment, personal);
  assert.throws(() => normalizeProject({ ...legacy, deploymentScope: 'tenant' }, legacy), /Personal or Shareable/);
  assert.equal(validateProject({ ...legacy, deploymentScope: 'tenant' }).valid, false);
  const files = generateFiles(shared);
  assert.match(files['m365agents.yml'], /scope: shared/);
  assert.match(files['env/.env.dev'], /AGENT_SCOPE=shared/);
  assert.doesNotMatch(files['env/.env.dev'], new RegExp(titleId));
  assert.throws(() => generateFiles(shared, { AGENT_SCOPE: 'personal', M365_TITLE_ID: titleId }), /different deployment mode/);
});

test('recognizes dotted account names and strips tokens from Toolkit logs', () => {
  assert.deepEqual(parseAccount({ code: 0, stdout: 'Your Microsoft 365 account is: first.last@contoso.com.\n', stderr: '' }), { signedIn: true, account: 'first.last@contoso.com' });
  assert.equal(parseAccount({ code: 0, stdout: 'Not signed in.', stderr: '' }).signedIn, false);
  assert.equal(parseAccount({ code: 1, stdout: 'Your Microsoft 365 account is: maker@contoso.com.', stderr: '' }).signedIn, false);
  const log = redact('\u001b[31mBearer secret-value access_token="private-value" eyJabc.abc.def\u001b[0m');
  assert.doesNotMatch(log, /secret-value|private-value|eyJabc|\u001b/);
});
