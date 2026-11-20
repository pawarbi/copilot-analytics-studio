import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { unzipSync, strFromU8 } from 'fflate';
import { testApp, validProject, reportId } from './fixtures.mjs';

const app = await testApp({ signedIn: false });
let browser, browserServer, temporaryApp;
async function checkCommunityCredits(page) {
  const footer = page.locator('.welcome-footer, .workspace-footer');
  const repository = footer.getByRole('link', { name: 'GitHub · Run locally', exact: true });
  assert.equal(await repository.getAttribute('href'), 'https://github.com/pawarbi/copilot-analytics-studio#run-locally');
  assert.equal(await repository.getAttribute('target'), '_blank');
  assert.equal(await repository.getAttribute('rel'), 'noopener noreferrer');
  assert.equal(await footer.getByRole('link', { name: 'Sandeep Pawar', exact: true }).getAttribute('href'), 'https://www.fabric.guru');
  assert.match(await footer.innerText(), /Built by Sandeep Pawar/);
  assert.match(await footer.innerText(), /Not a Microsoft product or project, and not affiliated with or endorsed by Microsoft/);
}
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
  const apiRequests = [];
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${app.base}/?scoutTheme=light`);
  await page.getByRole('button', { name: 'Sign in with Microsoft' }).waitFor();
  assert.equal(await page.title(), 'FIDA — Fabric IQ Declarative Agents');
  assert.equal(await page.locator('.brand strong').textContent(), 'FIDA');
  assert.match(await page.locator('.lead').textContent(), /Build grounded agents for Microsoft Copilot/);
  assert.doesNotMatch(await page.locator('body').innerText(), /Microsoft 365 Copilot/);
  await checkCommunityCredits(page);
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await checkPalette(page);
  const guide = page.locator('.welcome-guide agent-guide');
  await guide.getByRole('heading', { name: 'What is a declarative agent?', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Data answers powered by Fabric IQ', exact: true }).waitFor();
  await guide.locator('.flow-artifacts').getByText('Fabric IQ', { exact: true }).waitFor();
  assert.equal(await guide.locator('.flow-answer').getByRole('img', { name: 'Microsoft Copilot', exact: true }).count(), 1);
  const comparison = guide.getByRole('region', { name: 'How is this different from Fabric Data Agent?', exact: true });
  assert.equal(await comparison.locator('.comparison-list > li').count(), 5, 'The comparison must contain five distinct differences.');
  assert.equal(await comparison.locator('.comparison-references a').count(), 6);
  assert.equal(await comparison.locator('a').evaluateAll(links => links.every(link => new URL(link.href).hostname === 'learn.microsoft.com')), true, 'Product comparisons must link to the official documentation.');
  assert.equal(await comparison.evaluate(element => element.getBoundingClientRect().top > element.closest('agent-guide').querySelector('.guide-walkthrough').getBoundingClientRect().bottom), true, 'The comparison belongs below the grounding illustration.');
  assert.equal(await guide.locator('.flow-report').count(), 3);
  assert.equal(await guide.locator('.flow-model').count(), 3);
  assert.equal(await guide.locator('.flow-wire').count(), 10, 'The diagram must connect the request, guidance, all three report/model pairs and the answer.');
  assert.equal(await guide.locator('.grounding-map img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true, 'Official Power BI icons must load.');
  const requestsBeforeGuide = apiRequests.length;
  await page.clock.install();
  await guide.getByRole('button', { name: 'Play example', exact: true }).click();
  const firstDot = guide.locator('.flow-dot');
  assert.equal(await firstDot.count(), 1, 'A request must have exactly one processing circle.');
  assert.equal(await firstDot.evaluate(dot => getComputedStyle(dot).animationPlayState), 'running');
  const beforeMotion = await firstDot.evaluate(dot => getComputedStyle(dot).offsetDistance);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.notEqual(await firstDot.evaluate(dot => getComputedStyle(dot).offsetDistance), beforeMotion, 'The request circle must actually move along its connector.');
  await page.clock.runFor(3600);
  assert.match(await guide.getByRole('tab', { selected: true }).textContent(), /Instructions & skills/);
  await guide.getByRole('button', { name: 'Pause example', exact: true }).click();
  const pausedDots = guide.locator('.flow-dot');
  assert.equal(await pausedDots.count(), 1, 'Routing must not duplicate the request across branches.');
  assert.equal(await guide.locator('.flow-edge.is-active').count(), 1, 'Guidance must select only the Sales branch.');
  assert.equal(await pausedDots.first().evaluate(dot => getComputedStyle(dot).animationPlayState), 'paused');
  const pausedPosition = await pausedDots.first().evaluate(dot => getComputedStyle(dot).offsetDistance);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(await pausedDots.first().evaluate(dot => getComputedStyle(dot).offsetDistance), pausedPosition, 'Pausing must hold the processing circles in place.');
  await page.clock.runFor(7200);
  assert.match(await guide.getByRole('tab', { selected: true }).textContent(), /Instructions & skills/, 'Pausing must stop the walkthrough.');
  await guide.getByRole('tab', { name: /Power BI action/ }).click();
  assert.equal(await guide.locator('.flow-dot').count(), 1, 'The same single request must traverse retrieval and return.');
  assert.deepEqual(await guide.locator('.flow-node.is-active').evaluateAll(nodes => nodes.map(node => node.dataset.flowNode)), ['report-0', 'model-0']);
  assert.equal(await guide.locator('[data-flow-route="false"].is-active, [data-flow-route="false"].is-complete').count(), 0, 'Unused Finance and Operations routes must remain inactive.');
  await guide.getByRole('tab', { selected: true }).focus();
  await page.keyboard.press('End');
  assert.match(await guide.getByRole('tab', { selected: true }).textContent(), /Response/);
  await page.keyboard.press('Home');
  assert.match(await guide.getByRole('tab', { selected: true }).textContent(), /User question/);
  await page.keyboard.press('ArrowRight');
  await guide.getByRole('button', { name: 'Play example', exact: true }).click();
  await page.clock.runFor(11000);
  await guide.getByRole('button', { name: 'Replay example', exact: true }).waitFor();
  assert.equal(await guide.locator('.flow-dot.is-arrived').count(), 1, 'Only one circle should arrive at the answer.');
  assert.equal(apiRequests.length, requestsBeforeGuide, 'The illustration must not query data or change the account.');
  await page.screenshot({ path: 'test-results/sign-in.png', fullPage: true });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `The front-page flow must fit a ${width}px viewport.`);
    const map = guide.locator('.grounding-map');
    assert.equal(await map.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'The grounding map must fit its container.');
    assert.equal(await comparison.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'The sourced comparison must fit its container.');
    if (width === 390) await map.screenshot({ path: 'test-results/mobile-grounding-map.png' });
    if (width === 390 || width === 1440) await comparison.screenshot({ path: `test-results/agent-comparison-${width}.png` });
  }
  await page.getByRole('button', { name: 'How it works', exact: true }).click();
  await page.getByRole('dialog', { name: 'About declarative agents', exact: true }).waitFor();
  const guideDialog = page.locator('#guide-dialog');
  const dialogGuide = guideDialog.locator('agent-guide');
  assert.equal(await dialogGuide.locator('.comparison-list > li').count(), 5, 'The same comparison must be available inside the app.');
  assert.equal(await page.locator('agent-guide').count(), 2);
  const guideIds = await page.locator('agent-guide [id]').evaluateAll(elements => elements.map(element => element.id));
  assert.equal(new Set(guideIds).size, guideIds.length, 'Guide instances must have distinct accessible IDs.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await dialogGuide.getByRole('button', { name: 'Play example', exact: true }).click();
  assert.equal(await dialogGuide.locator('.flow-dot').evaluate(element => getComputedStyle(element).animationName), 'none');
  await page.keyboard.press('Escape');
  await dialogGuide.locator('[data-guide-play]').filter({ hasText: 'Play example' }).waitFor({ state: 'attached' });
  await page.clock.runFor(4000);
  assert.match(await dialogGuide.getByRole('tab', { selected: true, includeHidden: true }).textContent(), /User question/, 'Closing the guide must stop playback.');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
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
  await checkCommunityCredits(page);
  assert.equal(await page.locator('.project-row').count(), 2);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `The projects page must fit a ${width}px viewport.`);
    assert.equal(await page.getByRole('button', { name: 'Create an agent', exact: true }).isVisible(), true);
    if (width === 390) {
      await page.screenshot({ path: 'test-results/mobile-projects.png', fullPage: true });
      await page.locator('.appbar').getByRole('button', { name: 'How it works', exact: true }).click();
      assert.equal(await guideDialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'The mobile guide must not overflow.');
      await dialogGuide.getByRole('tab', { name: /Power BI action/ }).click();
      await page.screenshot({ path: 'test-results/mobile-agent-guide.png', fullPage: true });
      await page.getByRole('button', { name: 'Close agent guide', exact: true }).click();
    }
  }
  await page.screenshot({ path: 'test-results/studio-dashboard.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  await checkPalette(page);
  await page.screenshot({ path: 'test-results/studio-dashboard-dark.png', fullPage: true });
  await page.locator('.appbar').getByRole('button', { name: 'How it works', exact: true }).click();
  await dialogGuide.getByRole('tab', { name: /Power BI action/ }).click();
  await page.screenshot({ path: 'test-results/agent-guide-dark.png', fullPage: true });
  await dialogGuide.locator('.grounding-map').screenshot({ path: 'test-results/grounding-map-dark.png' });
  await page.getByRole('button', { name: 'Close agent guide', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
  await page.locator('[data-create-pack="general"]').click();
  await page.getByRole('button', { name: 'Add Power BI source', exact: true }).click();
  const sourceInput = page.getByLabel('Report or semantic model link or GUID', { exact: true });
  await sourceInput.fill(validProject().reports[0].url.replace('https://', ''));
  await page.getByLabel('Source name', { exact: true }).fill('Sales <em>context</em>');
  await page.getByLabel('Description & source-specific guidance', { exact: true }).fill('Use [Sales Amount] for booked sales. Dates mean order dates.');
  await page.getByRole('button', { name: 'Check source structure', exact: true }).click();
  await page.getByText('Report ID extracted').waitFor();
  assert.equal(await sourceInput.inputValue(), validProject().reports[0].url);
  assert.equal(await sourceInput.evaluate(element => element.required && !!element.labels[0].querySelector('.required-mark')), true);
  assert.equal(await page.getByLabel('Source type for GUID', { exact: true }).evaluate(element => element.required), false);
  assert.equal(await page.getByLabel('Description & source-specific guidance', { exact: true }).evaluate(element => element.required || !!element.labels[0].querySelector('.required-mark')), false);
  assert.equal(await page.locator('.source-card em').count(), 0, 'User content must stay text, not markup.');
  assert.deepEqual(errors, [], 'Link input should not produce browser errors.');
  await sourceInput.fill(reportId);
  assert.equal(await page.getByLabel('Source type for GUID', { exact: true }).evaluate(element => element.required && !!element.labels[0].querySelector('.required-mark')), true);
  await page.getByRole('button', { name: 'Check source structure', exact: true }).click();
  await page.getByText('Choose Report or Semantic model when entering a GUID.', { exact: true }).waitFor();
  await page.getByLabel('Source type for GUID', { exact: true }).selectOption('Report');
  await page.getByRole('button', { name: 'Check source structure', exact: true }).click();
  await page.getByText('Report ID extracted').waitFor();
  await page.getByLabel('Source type for GUID', { exact: true }).selectOption('Semantic model');
  await page.getByRole('button', { name: 'Check source structure', exact: true }).click();
  await page.getByText('Semantic model ID extracted').waitFor();
  assert.equal(await sourceInput.inputValue(), reportId, 'GUIDs must not be rewritten into URLs.');
  assert.ok(errors.length > 0 && errors.every(error => error === 'Failed to load resource: the server responded with a status of 400 (Bad Request)'), 'Only the deliberate missing-type validation may produce HTTP errors.');
  errors.length = 0;
  assert.equal(await page.getByRole('region', { name: 'Source routing guidance' }).count(), 0, 'A single source does not need the multi-source reminder.');
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  const routingNudge = page.getByRole('region', { name: 'Source routing guidance' });
  await routingNudge.getByText(/0 of 2 sources have explicit routing guidance/).waitFor();
  const routing = 'Use for booked sales and order trends, not recognized revenue.';
  await page.getByLabel('When should the agent use this source?', { exact: true }).nth(0).fill(routing);
  await routingNudge.getByText(/1 of 2 sources have explicit routing guidance/).waitFor();
  await page.getByLabel('When should the agent use this source?', { exact: true }).nth(1).fill('Use for recognized revenue; prefer over Sales for revenue questions.');
  await routingNudge.getByText(/2 of 2 sources have explicit routing guidance/).waitFor();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await page.getByText('Saved on this computer', { exact: true }).waitFor();
  const routingProjects = await app.json('/projects');
  const routingProject = await app.json(`/projects/${routingProjects.find(project => project.name === 'Sales <em>context</em> insight').id}`);
  assert.equal(routingProject.reports[0].routing, routing);
  assert.match(routingProject.reports[1].routing, /prefer over Sales/);
  await page.getByRole('button', { name: 'Remove source 2', exact: true }).click();
  assert.equal(await routingNudge.count(), 0, 'The reminder disappears when only one source remains.');
  await page.locator('.sidebar [data-tab="overview"]').click();
  assert.equal(await page.getByLabel('Agent name', { exact: true }).inputValue(), 'Sales <em>context</em> insight');
  await page.getByLabel('Agent name', { exact: true }).fill('Browser-tested analyst');
  await page.locator('.appbar').getByRole('button', { name: 'How it works', exact: true }).click();
  await dialogGuide.getByRole('heading', { name: 'What is a declarative agent?', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close agent guide', exact: true }).click();
  assert.equal(await page.getByLabel('Agent name', { exact: true }).inputValue(), 'Browser-tested analyst', 'Opening help must preserve the draft.');
  const publisherSection = page.getByRole('region', { name: 'Publisher information', exact: true });
  assert.equal(await publisherSection.locator('summary').count(), 0, 'Required publisher information must not be collapsible.');
  assert.equal(await publisherSection.locator('input:visible').count(), 4, 'Publisher fields are visible without expanding a section.');
  for (const label of ['Agent name', 'Description', 'Package version', 'Publisher name', 'Website', 'Privacy policy URL', 'Terms of use URL']) {
    assert.equal(await page.getByLabel(label, { exact: true }).evaluate(element => element.required && !!element.labels[0].querySelector('.required-mark')), true, `${label} must expose its required state and a visible red marker.`);
  }
  assert.equal(await publisherSection.locator('.required-mark').first().evaluate(element => getComputedStyle(element).color), 'rgb(220, 38, 38)');
  await page.getByLabel('Publisher name', { exact: true }).fill('Contoso');
  await page.getByLabel('Website', { exact: true }).fill('contoso.com');
  await page.getByLabel('Privacy policy URL', { exact: true }).fill('https://contoso.com/privacy');
  await page.getByLabel('Terms of use URL', { exact: true }).fill('https://contoso.com/terms');
  await page.getByLabel('Terms of use URL', { exact: true }).blur();
  assert.equal(await page.getByLabel('Website', { exact: true }).inputValue(), 'https://contoso.com');
  await page.locator('.sidebar [data-tab="instructions"]').click();
  assert.equal(await page.getByLabel('Agent behavior', { exact: true }).evaluate(element => element.required && !!element.labels[0].querySelector('.required-mark')), true);
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
  for (const key of ['name', 'description', 'instructions']) {
    assert.equal(await page.locator(`[data-skill="3"][data-key="${key}"]`).evaluate(element => element.required && !!element.labels[0].querySelector('.required-mark')), true);
  }
  assert.equal(await page.locator('[data-skill="3"][data-key="recipes"]').evaluate(element => element.required || !!element.labels[0].querySelector('.required-mark')), false);
  await page.screenshot({ path: 'test-results/skills-editor.png', fullPage: true });
  await page.locator('.sidebar [data-tab="files"]').click();
  const deploymentModes = page.getByRole('group', { name: 'Deployment mode', exact: true });
  assert.equal(await deploymentModes.getByRole('radio').count(), 2);
  assert.equal(await deploymentModes.locator('input:checked').count(), 0, 'New agents must not default to either deployment mode.');
  assert.equal(await page.getByRole('button', { name: 'Publish to Copilot', exact: true }).isDisabled(), true);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await deploymentModes.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'Both deployment choices must fit the viewport.');
    assert.equal(await deploymentModes.getByRole('radio', { name: 'Personal — just me', exact: true }).isVisible(), true);
    assert.equal(await deploymentModes.getByRole('radio', { name: 'Shareable — selected people', exact: true }).isVisible(), true);
  }
  await page.getByRole('radio', { name: 'Personal — just me', exact: true }).check();
  await page.getByRole('button', { name: 'Generate file preview', exact: true }).click();
  await page.getByRole('button', { name: 'appPackage/declarativeAgent.json', exact: true }).click();
  assert.match(await page.locator('.file-view pre').textContent(), /"folder": "skills\/rankings-and-share"/);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export source', exact: true }).click();
  const download = await downloadPromise;
  const downloadPath = join('test-results', 'browser-source.zip');
  await download.saveAs(downloadPath);
  const files = unzipSync(new Uint8Array(await readFile(downloadPath)));
  assert.ok(strFromU8(files['appPackage/agent_instructions.md']).includes(`| Semantic model | ${reportId} |`));
  assert.ok(strFromU8(files['appPackage/agent_instructions.md']).includes(`Routing: ${routing}`));
  assert.match(strFromU8(files['appPackage/skills/rankings-and-share/references/dax-recipes.md']), /Sales Amount/);
  assert.ok(files['appPackage/skills/territory-analysis/SKILL.md']);
  await page.getByRole('button', { name: 'Publish to Copilot', exact: true }).click();
  await page.getByRole('dialog', { name: 'Publish to your Copilot' }).waitFor();
  assert.equal(await page.locator('.publisher-review input:visible').count(), 5, 'Publish confirmation keeps all publisher fields and the optional remember checkbox visible.');
  assert.equal(app.state.calls.some(args => args[0] === 'provision'), false, 'Opening confirmation must not publish.');
  await page.screenshot({ path: 'test-results/publish-review.png', fullPage: true });
  await page.route('**/api/projects/*/publish', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ redirect: `${app.base}/?consent-test=1` })
  }), { times: 1 });
  await page.getByRole('button', { name: 'Confirm personal publish', exact: true }).click();
  await page.waitForURL('**/?consent-test=1');
  await page.getByText('Microsoft access connected. Review and confirm your publishing or sharing operation again.', { exact: true }).waitFor();
  assert.equal(app.state.calls.some(args => args[0] === 'provision'), false, 'Returning from delegated consent must not automatically publish.');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('fida-resume-project')), null);
  await page.getByRole('button', { name: 'Publish to Copilot', exact: true }).click();
  let release;
  app.state.hold = new Promise(resolve => { release = resolve; });
  await page.getByRole('button', { name: 'Confirm personal publish', exact: true }).click();
  await page.waitForFunction(() => sessionStorage.getItem('studio-job'));
  await page.reload();
  await page.getByRole('dialog', { name: 'Publishing your agent' }).waitFor();
  release(); app.state.hold = null;
  await page.getByText('Personal deployment completed', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: /Continue to FIDA/ }).click();
  await page.getByRole('button', { name: 'Open workspace for Browser-tested analyst', exact: true }).click();
  assert.equal(await sourceInput.inputValue(), reportId);
  assert.equal(await page.getByLabel('Source type for GUID', { exact: true }).inputValue(), 'Semantic model');
  await page.locator('.sidebar [data-tab="overview"]').click();
  assert.equal(await page.getByLabel('Agent name', { exact: true }).inputValue(), 'Browser-tested analyst');
  await page.locator('.sidebar [data-tab="files"]').click();
  await page.getByText('Published personally · v1.0.0', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/published-test-double.png', fullPage: true });
  assert.equal(await page.getByRole('button', { name: 'Manage sharing', exact: true }).count(), 0);
  await page.getByRole('radio', { name: 'Shareable — selected people', exact: true }).check();
  assert.equal(await page.getByRole('button', { name: 'Manage sharing', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Publish to Copilot', exact: true }).click();
  await page.getByText('Shareable · Grant recipients separately', { exact: true }).waitFor();
  assert.equal(app.state.calls.filter(args => args[0] === 'provision').length, 1, 'Choosing shared mode must not deploy without confirmation.');
  await page.getByRole('button', { name: 'Confirm shareable publish', exact: true }).click();
  await page.getByText('Shareable deployment completed', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByText('Published shareable · v1.0.0', { exact: true }).waitFor();
  assert.equal(app.state.calls.filter(args => args[0] === 'share').length, 0, 'Shared deployment must not grant access automatically.');
  await page.getByRole('button', { name: 'Manage sharing', exact: true }).click();
  const sharingDialog = page.getByRole('dialog', { name: 'Manage sharing', exact: true });
  assert.match(await page.getByLabel('Agent sharing link', { exact: true }).inputValue(), /templatedAppId=shared-test-app/);
  await page.getByLabel('User or group emails', { exact: true }).fill('person@contoso.com, team@contoso.com');
  assert.equal(app.state.calls.filter(args => args[0] === 'share').length, 0, 'Opening and filling sharing must not grant access.');
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await sharingDialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'Sharing controls must fit the dialog.');
  }
  await page.screenshot({ path: 'test-results/shareable-deployment.png', fullPage: true });
  await page.getByRole('button', { name: 'Confirm access change', exact: true }).click();
  await page.getByText('Sharing change completed', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Manage sharing', exact: true }).click();
  await page.getByText('Recipients recorded by FIDA (2)', { exact: true }).waitFor();
  await page.getByLabel('Access change', { exact: true }).selectOption('remove');
  await page.getByLabel('User or group emails', { exact: true }).fill('person@contoso.com');
  await page.getByRole('button', { name: 'Confirm access change', exact: true }).click();
  await page.getByText('Sharing change completed', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Manage sharing', exact: true }).click();
  await page.getByText('Recipients recorded by FIDA (1)', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close sharing', exact: true }).click();
  await page.getByRole('radio', { name: 'Personal — just me', exact: true }).check();
  await page.getByText('Published personally · v1.0.0', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Manage sharing', exact: true }).count(), 0);
  await page.getByRole('radio', { name: 'Shareable — selected people', exact: true }).check();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  assert.equal(app.state.calls.filter(args => args[0] === 'share').length, 2, 'Switching modes must not change existing access.');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.sidebar [data-tab="skills"]').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Mobile layout must not overflow.');
  await page.screenshot({ path: 'test-results/mobile-skills.png', fullPage: true });
  await page.getByLabel('Account menu', { exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Sign out', exact: true }).isVisible(), true);
  await page.keyboard.press('Escape');
  await page.goto(`${app.base}/?scoutTheme=dark`);
  await page.getByRole('button', { name: /Continue to FIDA/ }).waitFor();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await checkPalette(page);
  await page.screenshot({ path: 'test-results/mobile-dark-sign-in.png', fullPage: true });
  assert.deepEqual(errors, [], 'Browser should have no script, rendering or CSP errors.');
  assert.equal(app.state.calls.filter(args => args[0] === 'provision').length, 2);
  temporaryApp = await testApp({ hosting: { mode: 'hosted', ephemeral: true, idleMinutes: 30 } });
  await page.goto(temporaryApp.base);
  await page.getByRole('button', { name: /Continue to FIDA/ }).click();
  await page.getByRole('region', { name: 'Temporary draft storage' }).waitFor();
  await page.getByRole('button', { name: 'Create an agent', exact: true }).click();
  await page.getByRole('button', { name: 'Empty project', exact: true }).click();
  const notice = page.getByRole('region', { name: 'Temporary draft storage' });
  await notice.getByRole('button', { name: 'Download draft ZIP', exact: true }).waitFor();
  assert.match(await notice.innerText(), /30 minutes of inactivity/);
  assert.match(await notice.innerText(), /Published agents remain in Microsoft Copilot/);
  const draftDownload = page.waitForEvent('download');
  await notice.getByRole('button', { name: 'Download draft ZIP', exact: true }).click();
  const draftPath = join('test-results', 'incomplete-draft.zip');
  await (await draftDownload).saveAs(draftPath);
  const draftJson = unzipSync(new Uint8Array(await readFile(draftPath)))['fida-project.json'];
  assert.equal(JSON.parse(strFromU8(draftJson)).project.deploymentScope, null);
  const previous = await temporaryApp.json('/projects');
  await page.locator('#draft-import').setInputFiles({ name: 'fida-project.json', mimeType: 'application/json', buffer: Buffer.from(draftJson) });
  await page.getByText('Draft imported as a new project. Existing published agents are not connected to this draft.', { exact: true }).waitFor();
  const restored = await temporaryApp.json('/projects');
  assert.equal(restored.length, previous.length + 1);
  assert.equal(await page.getByRole('radio', { checked: true }).count(), 0);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Temporary draft notices must fit narrow screens.');
  }
  assert.deepEqual(errors, [], 'Draft backup and restoration must not introduce browser errors.');
  console.log('Browser passed: agent explainer, responsive themes, sign-in, catalog, GUID sources, autosave, import/export, personal/shared publishing, recipient grants/removal, temporary notices and incomplete draft recovery.');
  console.log('Publishing/authentication used an isolated test double; no Microsoft account or cloud agent was changed.');
} finally {
  if (browserServer) {
    const timer = setTimeout(() => { void browserServer.kill(); }, 5000);
    try {
      if (browser) await browser.close();
      await browserServer.close();
    } finally { clearTimeout(timer); }
  }
  await temporaryApp?.close();
  await app.close();
}
