import assert from 'node:assert/strict';
import test from 'node:test';
import { PACKS, SKILLS, PROFILES, applyPack, skillFromCatalog, normalizeHttps } from '../public/catalog.js';
import { normalizeProject, validateProject } from '../lib/generator.mjs';
import { validProject } from './fixtures.mjs';

test('every starter pack produces a valid project using bounded, source-independent instructions', () => {
  for (const pack of PACKS) {
    const project = normalizeProject(applyPack({ ...validProject(), skills: [] }, pack.id, { newAgent: true }));
    assert.deepEqual(validateProject(project, { publish: true }).errors, [], pack.id);
    assert.equal(project.instructions, PROFILES.find(p => p.id === pack.profile).text);
    assert.equal(project.skills.length, pack.skills.length);
  }
  for (const skill of SKILLS) {
    const project = normalizeProject({ ...validProject(), skills: [skillFromCatalog(skill.id)] });
    assert.deepEqual(validateProject(project, { publish: true }).errors, [], skill.id);
  }
});

test('adding a pack preserves maker instructions, identity and edits without duplicating skills', () => {
  const project = validProject();
  project.skills.push({ ...skillFromCatalog('metric-definitions'), instructions: 'My reviewed definition rules.' });
  const result = applyPack(project, 'general');
  assert.equal(result.id, project.id);
  assert.equal(result.name, project.name);
  assert.equal(result.instructions, project.instructions);
  assert.equal(result.skills.find(s => s.name === 'metric-definitions').instructions, 'My reviewed definition rules.');
  assert.deepEqual(applyPack(result, 'general'), result);
  assert.equal(project.skills.length, 2, 'The input project must not be mutated.');
  result.skills[2].instructions = 'Changed locally.';
  assert.notEqual(skillFromCatalog('source-selection').instructions, 'Changed locally.');
});

test('oversized pack additions fail atomically and invalid selections are rejected', () => {
  const project = { ...validProject(), skills: SKILLS.slice(0, 7).map(s => skillFromCatalog(s.id)) };
  const original = structuredClone(project);
  assert.throws(() => applyPack(project, 'operations'), /exceed eight/);
  assert.deepEqual(project, original);
  assert.throws(() => applyPack(project, 'unknown'), /available starter pack/);
  assert.throws(() => skillFromCatalog('unknown'), /available skill/);
});

test('HTTPS defaults normalize pasted domains but never rewrite explicit or unsupported schemes', () => {
  assert.equal(normalizeHttps(' contoso.com/privacy '), 'https://contoso.com/privacy');
  assert.equal(normalizeHttps('app.powerbi.com/groups/me/reports/test'), 'https://app.powerbi.com/groups/me/reports/test');
  for (const value of ['https://contoso.com', 'http://contoso.com', 'javascript:alert(1)', 'not a URL']) {
    assert.equal(normalizeHttps(value), value);
  }
});
