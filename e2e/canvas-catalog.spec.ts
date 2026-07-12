import { test, expect } from '@playwright/test';

// Behaviour tests for the /canvas control-flow palette category and the
// context-aware left panel (docs/canvas-control-flow-pending.md sections 2, 3, 7):
// searching "control" must surface the Control Flow / Sagas category, and clicking
// a Spring Boot node must swap the left panel to the exhaustive Spring catalog.
test.describe('Canvas control flow palette and catalog inspector', () => {
  test("palette search 'control' shows the Control Flow / Sagas category", async ({ page }) => {
    await page.goto('/canvas');

    const paletteSearch = page.getByPlaceholder('Search AWS, Azure, K8s, AI...');
    await expect(paletteSearch).toBeVisible();
    await paletteSearch.fill('control');

    await expect(page.getByText('Control Flow / Sagas')).toBeVisible();
    await expect(page.getByText('Decision Gateway')).toBeVisible();
    await expect(page.getByText('Saga Orchestrator')).toBeVisible();
    await expect(page.getByText('Circuit Breaker', { exact: true })).toBeVisible();
    await expect(page.getByText('Fork / Join')).toBeVisible();

    // The user's original partial query must match too.
    await paletteSearch.fill('contro');
    await expect(page.getByText('Control Flow / Sagas')).toBeVisible();
  });

  test('clicking a Spring Boot node swaps the left panel to the Spring catalog', async ({ page }) => {
    await page.goto('/canvas');

    // The seeded canvas contains the springBoot node "Auth Service".
    await page.locator('.react-flow__node', { hasText: 'Auth Service' }).click();

    const catalogPanel = page.getByTestId('catalog-inspector');
    await expect(catalogPanel).toBeVisible();
    // The Spring catalog is lazy-loaded; once resolved the heading and the first
    // (default-expanded) category with checkboxes appear.
    await expect(catalogPanel.getByRole('heading', { name: 'Spring Boot' })).toBeVisible();
    await expect(catalogPanel.getByPlaceholder('Search options...')).toBeVisible();
    await expect(catalogPanel.getByText('Project Metadata & Design Patterns')).toBeVisible();
    expect(await catalogPanel.locator('input[type="checkbox"]').count()).toBeGreaterThan(0);

    // Deselecting via the panel's close button restores the node palette.
    await catalogPanel.getByLabel('Close catalog inspector').click();
    await expect(page.getByPlaceholder('Search AWS, Azure, K8s, AI...')).toBeVisible();
  });
});
