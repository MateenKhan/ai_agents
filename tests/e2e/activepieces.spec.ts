import { test, expect } from '@playwright/test';

test.describe('Settings and Agent Configuration', () => {
  test('saves a webhook URL in Settings Modal Integrations tab', async ({ page }) => {
    await page.goto('/');
    
    // Open Settings Modal
    await page.click('button:has-text("Settings"), [aria-label="Settings"]');
    
    // Click Integrations tab
    await page.click('button:has-text("Integrations"), [role="tab"]:has-text("Integrations")');
    
    // Fill webhook URL
    const webhookInput = page.locator('input[placeholder*="webhook"], input[name="webhook"]');
    await webhookInput.fill('https://example.com/webhook');
    
    // Save
    await page.click('button:has-text("Save")');
  });

  test('checks the Webhook checkbox in Agents configuration tab', async ({ page }) => {
    await page.goto('/');
    
    // Open Agent Configuration
    await page.click('button:has-text("Agents"), [aria-label="Agents"]');
    
    // Check Webhook checkbox
    const webhookCheckbox = page.locator('input[type="checkbox"]');
    if (!(await webhookCheckbox.isChecked())) {
      await webhookCheckbox.check();
    }
    
    await expect(webhookCheckbox).toBeChecked();
  });
});
