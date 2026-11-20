import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { generateFiles } from '../lib/generator.mjs';
import { createToolkitRunner } from '../lib/toolkit.mjs';
import { validProject, reportId } from './fixtures.mjs';

for (const deploymentScope of ['personal', 'shared']) {
  const workspace = resolve('test-results', `schema-workspace-${deploymentScope}`);
  for (const [name, content] of Object.entries(generateFiles({ ...validProject(), deploymentScope }, { TEAMS_APP_ID: reportId }))) {
    const file = resolve(workspace, ...name.split('/'));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  const result = await createToolkitRunner()([
    'validate', '--manifest-file', resolve(workspace, 'appPackage', 'manifest.json'),
    '--env-file', resolve(workspace, 'env', '.env.dev'), '--folder', workspace, '--interactive', 'false'
  ], { cwd: workspace, onOutput: text => process.stdout.write(text), timeoutMs: 120000 });
  if (result.code !== 0) { process.exitCode = 1; break; }
  console.log(`\nOfficial Toolkit validation completed for ${deploymentScope}. This test did not provision, publish or share an agent.`);
}
