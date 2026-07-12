import { test, expect } from '@playwright/test';

test.describe('Visual React Studio Designer (/designer)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/projects*', async (route) => {
      await route.fulfill({
        json: [
          {
            id: 'default-project',
            name: 'Default',
            emoji: '🚀',
            repoPath: '/workspace',
          },
        ],
      });
    });

    await page.goto('/designer', { waitUntil: 'domcontentloaded' });
  });

  test('loads /designer page and displays core studio controls', async ({ page }) => {
    await expect(page.locator('h1').filter({ hasText: 'Visual React Studio' })).toBeVisible();
    await expect(page.getByTestId('device-preset-select')).toBeVisible();
    await expect(page.getByTestId('preview-container')).toBeVisible();
  });

  test('default preset is iPhone 15 Pro with correct container dimensions', async ({ page }) => {
    const previewContainer = page.getByTestId('preview-container');
    await expect(previewContainer).toBeVisible();

    await expect(previewContainer).toHaveCSS('width', '393px');
    await expect(previewContainer).toHaveCSS('height', '852px');
  });

  test('selecting a device preset updates preview container dimensions', async ({ page }) => {
    const deviceSelect = page.getByTestId('device-preset-select');
    const previewContainer = page.getByTestId('preview-container');

    await deviceSelect.selectOption('pixel-8');
    await expect(previewContainer).toHaveCSS('width', '412px');
    await expect(previewContainer).toHaveCSS('height', '915px');

    await deviceSelect.selectOption('ipad-pro-11');
    await expect(previewContainer).toHaveCSS('width', '834px');
    await expect(previewContainer).toHaveCSS('height', '1194px');
  });

  test('orientation toggle swaps container width and height', async ({ page }) => {
    const deviceSelect = page.getByTestId('device-preset-select');
    const previewContainer = page.getByTestId('preview-container');
    const orientationToggle = page.getByTestId('orientation-toggle');

    await deviceSelect.selectOption('ipad-pro-11');
    await expect(previewContainer).toHaveCSS('width', '834px');
    await expect(previewContainer).toHaveCSS('height', '1194px');

    await orientationToggle.click();
    await expect(previewContainer).toHaveCSS('width', '1194px');
    await expect(previewContainer).toHaveCSS('height', '834px');
  });

  test('view mode switcher switches between split, preview, and code', async ({ page }) => {
    const viewSplit = page.getByTestId('view-split');
    const viewPreview = page.getByTestId('view-preview');
    const viewCode = page.getByTestId('view-code');

    await expect(viewSplit).toBeVisible();
    await viewPreview.click();
    await viewCode.click();
    await viewSplit.click();
  });

  test('AI chat toggle opens the assistant drawer and shows the active code context', async ({ page }) => {
    // Collapsed by default: the drawer is not in the DOM until toggled.
    await expect(page.getByTestId('ai-assistant-drawer')).toHaveCount(0);

    await page.getByTestId('ai-chat-toggle').click();

    const drawer = page.getByTestId('ai-assistant-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('AI Assistant & Inspector');

    // The context banner reflects the Sandpack file the designer is on (App.tsx by default),
    // which is also what the chat prompts will operate on.
    const context = page.getByTestId('designer-ai-context');
    await expect(context).toBeVisible();
    await expect(context).toContainText('App.tsx');

    // Toggling again collapses the drawer.
    await page.getByTestId('ai-chat-toggle').click();
    await expect(page.getByTestId('ai-assistant-drawer')).toHaveCount(0);
  });

  test('AI drawer open state persists across a reload', async ({ page }) => {
    await page.getByTestId('ai-chat-toggle').click();
    await expect(page.getByTestId('ai-assistant-drawer')).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });

    // Restored from localStorage without another click.
    await expect(page.getByTestId('ai-assistant-drawer')).toBeVisible();
    await expect(page.getByTestId('designer-ai-context')).toContainText('App.tsx');
  });
});
