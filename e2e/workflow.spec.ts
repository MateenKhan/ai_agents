import { test, expect, type Page, type Route } from '@playwright/test';
import { defaultWorkflow } from '../agentic/workflow/defaultWorkflow';
import type { WorkflowDoc } from '../agentic/workflow/types';

// ─────────────────────────────────────────────────────────────────────────────
// The editor loads and saves through the db-server's /workflow endpoint. We never start that
// server: every test intercepts the endpoint, so these prove the browser speaks the ENGINE's
// schema (WorkflowDoc: stages + outcomes, numeric caps) end to end, with no backend at all.
// ─────────────────────────────────────────────────────────────────────────────

/** The shape loadWorkflow() expects back from a GET. */
function loadBody(doc: WorkflowDoc) {
  return { doc, source: 'stored', valid: true, docErrors: [], stageIssues: [], occupied: [] };
}

/**
 * Route /workflow. GET returns the given doc; PUT echoes the sent doc with a bumped rev and
 * records its body so a test can assert the exact JSON the editor produced. Everything else the
 * app fires at the db-server (e.g. /projects) is stubbed empty so nothing hangs.
 */
async function stubApi(page: Page, doc: WorkflowDoc) {
  const puts: any[] = [];

  // Match the API call (…/workflow?project=…), NOT the browser's navigation to /workflow —
  // the latter has no query string, and intercepting it would replace the app with raw JSON.
  await page.route(/\/workflow\?/, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      await route.fulfill({ json: loadBody(doc) });
      return;
    }
    if (req.method() === 'PUT') {
      const body = req.postDataJSON();
      puts.push(body);
      await route.fulfill({ json: { ok: true, doc: { ...body.doc, rev: (body.doc.rev ?? 1) + 1 } } });
      return;
    }
    await route.fulfill({ json: { ok: true } });
  });

  await page.route('**/projects*', (route: Route) => route.fulfill({ json: [] }));

  return { puts };
}

async function gotoEditor(page: Page) {
  await page.goto('/workflow');
  await expect(page.locator('.pwf-node').first()).toBeVisible();
}

test('loads /workflow and shows the eight default stages', async ({ page }) => {
  await stubApi(page, defaultWorkflow());
  await gotoEditor(page);

  await expect(page.locator('.pwf-node')).toHaveCount(8);
  for (const id of ['intake', 'plan', 'build', 'qa', 'accept', 'review', 'merge', 'merged']) {
    await expect(page.getByLabel(new RegExp(`^Stage ${id},`))).toBeVisible();
  }
});

test('dragging a node changes its position', async ({ page }) => {
  await stubApi(page, defaultWorkflow());
  await gotoEditor(page);

  const node = page.getByLabel(/^Stage build,/);
  const before = await node.evaluate((el: HTMLElement) => el.style.left);

  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 90, { steps: 8 });
  await page.mouse.up();

  const after = await node.evaluate((el: HTMLElement) => el.style.left);
  expect(after).not.toBe(before);
});

test('editing max attempts and saving PUTs a document carrying that number', async ({ page }) => {
  const { puts } = await stubApi(page, defaultWorkflow());
  await gotoEditor(page);

  // Select the build stage, then change its max-attempts cap.
  await page.getByLabel(/^Stage build,/).click();
  const attempts = page.getByLabel('Max attempts');
  await attempts.fill('9');

  await page.getByRole('button', { name: 'Save workflow' }).click();

  await expect.poll(() => puts.length).toBeGreaterThan(0);
  const sent = puts[0].doc as WorkflowDoc;
  const build = sent.stages.find(s => s.id === 'build')!;
  expect(build.caps!.attempts).toBe(9);
  // The saved shape is the engine's, not the old one: routing lives in outcomes, not edges.
  expect(Array.isArray(build.outcomes)).toBe(true);
  expect((sent as any).edges).toBeUndefined();
});

test('deleting an outcome that strands a stage turns the validator red and disables Save', async ({ page }) => {
  await stubApi(page, defaultWorkflow());
  await gotoEditor(page);

  await page.getByLabel(/^Stage qa,/).click();

  // Remove every outcome qa has; it can then no longer reach the terminal.
  for (;;) {
    const remove = page.getByRole('button', { name: /Remove outcome/ }).first();
    if (await remove.count() === 0) break;
    await remove.click();
  }

  await expect(page.getByText(/Save blocked/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save workflow' })).toBeDisabled();
});

test('renaming a stage rewrites the outcomes that point to it', async ({ page }) => {
  const { puts } = await stubApi(page, defaultWorkflow());
  await gotoEditor(page);

  await page.getByLabel(/^Stage qa,/).click();
  const name = page.getByLabel('Stage name');
  await name.fill('checks');
  await name.blur();

  // The renamed node exists…
  await expect(page.getByLabel(/^Stage checks,/)).toBeVisible();

  // …and a Save writes a document in which build now routes to `checks`, not `qa`.
  await page.getByRole('button', { name: 'Save workflow' }).click();
  await expect.poll(() => puts.length).toBeGreaterThan(0);

  const sent = puts.at(-1)!.doc as WorkflowDoc;
  expect(sent.stages.some(s => s.id === 'checks')).toBe(true);
  expect(sent.stages.some(s => s.id === 'qa')).toBe(false);
  const build = sent.stages.find(s => s.id === 'build')!;
  expect(build.outcomes.some(o => o.to === 'checks')).toBe(true);
  expect(build.outcomes.some(o => o.to === 'qa')).toBe(false);
});
