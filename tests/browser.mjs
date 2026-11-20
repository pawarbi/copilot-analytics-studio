import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { unzipSync, strFromU8 } from 'fflate';
import { testApp, validProject } from './fixtures.mjs';

const app = await testApp({ signedIn: false });
let browser, browserServer;
async function checkPalette(page) {
  const colors = await page.locator('.btn.primary').first().evaluate(button => {
    const style = getComputedStyle(button);
    return { foreground: style.color, background: style.backgroundColor, canvas: getComputedStyle(document.body).backgroundColor };
  });
  const channels = color => color.match(/[\d.]+/g).slice(0, 3).map(Number);
  const luminance = color => channels(color).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const values = [luminance(colors.foreground), luminance(colors.background)].sort((a, b) => b - a);
  assert.ok((values[0] + 0.05) / (values[1] + 0.05) >= 4.5, 'Primary actions need accessible text contrast in both themes.');
  const canvas = channels(colors.canvas);
  assert.ok(Math.max(...canvas) - Math.min(...canvas) <= 1, 'The workspace background must be neutral rather than warm-tinted.');
}
try {
  await mkdir('test-results', { recursive: true });
  browserServer = await chromium.launchServer({ channel: 'msedge', headless: true, host: '127.0.0.1' });
  browser = await chromium.connect(browserServer.wsEndpoint());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${app.base}/?scoutTheme=light`);
  await page.getByRole('button', { name: 'Sign in with Microsoft' }).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await checkPalette(page);
  await page.screenshot({ path: 'test-results/sign-in.png', fullPage: true });
  await page.getByRole('button', { name: 'Browse templates', exact: true }).click();
  await page.getByLabel('Search templates').fill('finance');
  assert.equal(await page.locator('.catalog-card').count(), 1);
  await page.locator('.catalog-card').getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('heading', { name: 'Finance review', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close template library', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in with Microsoft' }).click();
  await page.getByText('Connected to Microsoft 365', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.screenshot({ path: 'test-results/studio-empty.png', fullPage: true });
  for (const [name, description] of [
    ['Sales review', 'Territory performance and monthly sales comparisons.'],
    ['Operations review', 'Backlog, throughput and service-level reporting.']
  ]) {
    const project = await app.json('/projects', { method: 'POST', body: {} });
    await app.json(`/projects/${project.id}`, {
      method: 'PUT',
      body: { ...validProject(), ...project, name, description, reports: validProject().reports, skills: validProject().skills }
    });
  }
  await page.locator('.sidebar [data-action="home"]').click();
  await page.locator('.project-row').nth(1).waitFor();
  assert.equal(await page.locator('.project-row').count(), 2);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `The projects page must fit a ${width}px viewport.`);
    assert.equal(await page.getByRole('button', { name: 'Create an agent', exact: true }).isVisible(), true);
    if (width === 390) await page.screenshot({ path: 'test-results/mobile-projects.png', fullPage: true });
  }
  await page.screenshot({ path: 'test-results/studio-dashboard.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  await checkPalette(page);
  await page.screenshot({ path: 'test-results/studio-dashboard-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
  await page.locator('[data-create-pack="general"]').click();
  await page.getByRole('button', { name: 'Add Power BI source', exact: true }).click();
  await page.getByLabel('Power BI link', { exact: true }).fill(validProject().reports[0].url.replace('https://', ''));
  await page.getByLabel('Source name', { exact: true }).fill('Sales <em>context</em>');
  await page.getByLabel('Description & source-specific guidance', { exact: true }).fill('Use [Sales Amount] for booked sales. Dates mean order dates.');
  await page.getByRole('button', { name: 'Check link structure', exact: true }).click();
  await page.getByText('Report ID extracted').waitFor();
  assert.equal(await page.getByLabel('Power BI link', { exact: true }).inputValue(), validProject().reports[0].url);
  assert.equal(await page.locator('.source-card em').count(), 0, 'User content must stay text, not markup.');
  await page.locator('.sidebar [data-tab="overview"]').click();
  assert.equal(await page.getByLabel('Agent name', { exact: true }).inputValue(), 'Sales <em>context</em> insight');
  await page.getByLabel('Agent name', { exact: true }).fill('Browser-tested analyst');
  await page.locator('.publisher-disclosure > summary').click();
  await page.getByLabel('Publisher name', { exact: true }).fill('Contoso');
  await page.getByLabel('Website', { exact: true }).fill('contoso.com');
  await page.getByLabel('Privacy policy URL', { exact: true }).fill('https://contoso.com/privacy');
  await page.getByLabel('Terms of use URL', { exact: true }).fill('https://contoso.com/terms');
  await page.getByLabel('Terms of use URL', { exact: true }).blur();
  assert.equal(await page.getByLabel('Website', { exact: true }).inputValue(), 'https://contoso.com');
  await page.locator('.sidebar [data-tab="instructions"]').click();
  await page.getByLabel('Agent behavior', { exact: true }).fill('Use the approved Sales source and governed measures. Always state the date range and denominator.');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('[data-profile="audit"]').click();
  assert.match(await page.getByLabel('Agent behavior', { exact: true }).inputValue(), /^Use the approved Sales source/);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  let releaseSave, saveStarted;
  const saveGate = new Promise(resolve => { releaseSave = resolve; });
  const firstSave = new Promise(resolve => { saveStarted = resolve; });
  let holdNextSave = true;
  await page.route('**/api/projects/*', async route => {
    if (holdNextSave && route.request().method() === 'PUT') {
      holdNextSave = false; saveStarted(); await saveGate;
    }
    await route.continue();
  });
  await page.getByLabel('Agent behavior', { exact: true }).fill('Use the approved Sales source. First edit.');
  await firstSave;
  const finalInstructions = 'Use the approved Sales source and governed measures. Always state the date range and denominator.';
  await page.getByLabel('Agent behavior', { exact: true }).fill(finalInstructions);
  releaseSave();
  await page.locator('#save-button:not([disabled])').waitFor();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByText('Saved on this computer', { exact: true }).waitFor();
  const savedProjects = await app.json('/projects');
  assert.equal((await app.json(`/projects/${savedProjects[0].id}`)).instructions, finalInstructions, 'Edits during an in-flight autosave must not be lost.');
  await page.unroute('**/api/projects/*');
  await page.locator('.sidebar [data-tab="skills"]').click();
  await page.getByRole('button', { name: 'Browse skills', exact: true }).click();
  await page.getByLabel('Search templates').fill('ranking');
  await page.locator('.catalog-card').getByRole('button', { name: 'Add skill', exact: true }).click();
  assert.equal(await page.locator('.catalog-card').getByRole('button', { name: 'Added', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Close template library', exact: true }).click();
  await page.locator('.skill-card').nth(2).locator(':scope > summary').click();
  await page.getByLabel('references/dax-recipes.md', { exact: true }).nth(2).fill('EVALUATE ROW("Sales", [Sales Amount])\nReviewed reference; use only with this model.');
  await page.locator('#skill-import').setInputFiles({
    name: 'SKILL.md', mimeType: 'text/markdown',
    buffer: Buffer.from('---\nname: "territory-analysis"\ndescription: "Use for territory comparisons."\n---\n\nUse all territories, not the top five, for the share denominator.')
  });
  await page.locator('#skill-name-3').waitFor();
  assert.equal(await page.locator('#skill-name-3').inputValue(), 'territory-analysis');
  await page.screenshot({ path: 'test-results/skills-editor.png', fullPage: true });
  await page.locator('.sidebar [data-tab="files"]').click();
  await page.getByRole('button', { name: 'Generate file preview', exact: true }).click();
  await page.getByRole('button', { name: 'appPackage/declarativeAgent.json', exact: true }).click();
  assert.match(await page.locator('.file-view pre').textContent(), /"folder": "skills\/rankings-and-share"/);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export source', exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = join('test-results', 'browser-source.zip');
  await download.saveAs(downloadPath);
  const files = unzipSync(new Uint8Array(await readFile(downloadPath)));
  assert.match(strFromU8(files['appPackage/skills/rankings-and-share/references/dax-recipes.md']), /Sales Amount/);
  assert.ok(files['appPackage/skills/territory-analysis/SKILL.md']);
  await page.getByRole('button', { name: 'Publish to Copilot', exact: true }).click();
  await page.getByRole('dialog', { name: 'Publish to your Copilot' }).waitFor();
  assert.equal(app.state.calls.some(args => args[0] === 'provision'), false, 'Opening confirmation must not publish.');
  await page.screenshot({ path: 'test-results/publish-review.png', fullPage: true });
  let release;
  app.state.hold = new Promise(resolve => { release = resolve; });
  await page.getByRole('button', { name: 'Confirm personal publish', exact: true }).click();
  await page.waitForFunction(() => sessionStorage.getItem('studio-job'));
  await page.reload();
  await page.getByRole('dialog', { name: 'Publishing your agent' }).waitFor();
  release(); app.state.hold = null;
  await page.getByText('Personal deployment completed', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: /Continue to studio/ }).click();
  await page.getByRole('button', { name: 'Open workspace for Browser-tested analyst', exact: true }).click();
  await page.locator('.sidebar [data-tab="overview"]').click();
  assert.equal(await page.getByLabel('Agent name', { exact: true }).inputValue(), 'Browser-tested analyst');
  await page.locator('.sidebar [data-tab="files"]').click();
  await page.getByText('Published personally · v1.0.0', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/published-test-double.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.sidebar [data-tab="skills"]').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Mobile layout must not overflow.');
  await page.screenshot({ path: 'test-results/mobile-skills.png', fullPage: true });
  await page.getByLabel('Account menu', { exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Sign out', exact: true }).isVisible(), true);
  await page.keyboard.press('Escape');
  await page.goto(`${app.base}/?scoutTheme=dark`);
  await page.getByRole('button', { name: /Continue to studio/ }).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await checkPalette(page);
  await page.screenshot({ path: 'test-results/mobile-dark-sign-in.png', fullPage: true });
  assert.deepEqual(errors, [], 'Browser should have no script, rendering or CSP errors.');
  assert.equal(app.state.calls.filter(args => args[0] === 'provision').length, 1);
  console.log('Browser passed: sign-in, searchable catalog, starter packs, smart URL/name defaults, behavior protection, skill import, source export, confirmed publish, recovery and responsive account access.');
  console.log('Publishing/authentication used an isolated test double; no Microsoft account or cloud agent was changed.');
} finally {
  if (browser) await browser.close();
  if (browserServer) {
    const timer = setTimeout(() => { void browserServer.kill(); }, 5000);
    try { await browserServer.close(); } finally { clearTimeout(timer); }
  }
  await app.close();
}
