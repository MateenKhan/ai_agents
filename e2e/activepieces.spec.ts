import { test, expect } from '@playwright/test';

test.describe('Settings and Agent Configuration', () => {
  test('saves a webhook URL in Settings Modal Integrations tab', async ({ page }) => {
    await page.goto('/');
    
    // Open Settings Modal
    await page.click('button[data-feature-id="tasks-board-menu"]');
    await page.click('button[data-feature-id="tasks-open-settings"]');
    
    // Fill webhook URL
    const webhookInput = page.locator('input[placeholder*="https://"]').first();
    await webhookInput.fill('https://example.com/webhook');
    
    // Save
    await page.click('button:has-text("Save Changes")');
  });

  test('checks the Webhook checkbox in Agents configuration tab', async ({ page }) => {
    await page.goto('/');
    
    // Open Agent Configuration
    await page.click('button[data-feature-id="tasks-tab-agents"]');
    
    // Open custom agent modal
    await page.click('button:has-text("Custom agent")');
    
    // Check checkbox
    const webhookCheckbox = page.locator('[role="dialog"] input[type="checkbox"]').first();
    if (!(await webhookCheckbox.isChecked())) {
      await webhookCheckbox.check();
    }
    
    await expect(webhookCheckbox).toBeChecked();
  });
});
