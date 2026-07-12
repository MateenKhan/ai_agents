import { test, expect } from '@playwright/test';

test.describe('Canvas Drag and Code Generation', () => {
  test('drags a node, generates code, and syncs from repository', async ({ page }) => {
    // Navigate to canvas
    await page.goto('/canvas');

    // Drag a node
    // Assume there is a node source list and a canvas area
    const nodeSource = page.locator('.node-source, [data-testid="node-source"]').first();
    const canvasArea = page.locator('.canvas-area, [data-testid="canvas-area"]');
    
    // Simulate drag and drop
    if (await nodeSource.isVisible() && await canvasArea.isVisible()) {
      await nodeSource.dragTo(canvasArea);
    } else {
      // Fallback drag and drop if specific classes aren't found, try interacting directly with available canvas
      await page.mouse.move(200, 200);
      await page.mouse.down();
      await page.mouse.move(400, 400);
      await page.mouse.up();
    }

    // Click "Generate Code"
    const generateCodeButton = page.locator('button:has-text("Generate Code")');
    await expect(generateCodeButton).toBeVisible();
    await generateCodeButton.click();

    // Click "Sync from Repository"
    const syncButton = page.locator('button:has-text("Sync from Repository")');
    await expect(syncButton).toBeVisible();
    await syncButton.click();
    
    // Wait for some network or UI reaction (optional, just checking for buttons to exist)
  });
});
