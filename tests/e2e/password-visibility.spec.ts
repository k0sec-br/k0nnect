import { expect, test } from '@playwright/test';

test('alterna a visibilidade da senha com um controle acessível', async ({ page }) => {
  await page.goto('/login');

  const passwordInput = page.getByLabel('Senha', { exact: true });
  const showPasswordButton = page.getByRole('button', { name: 'Exibir caracteres' });

  await expect(passwordInput).toHaveAttribute('type', 'password');
  await expect(showPasswordButton.locator('svg')).toBeVisible();

  await showPasswordButton.click();
  await expect(passwordInput).toHaveAttribute('type', 'text');

  const hidePasswordButton = page.getByRole('button', { name: 'Ocultar caracteres' });
  await expect(hidePasswordButton).toHaveAttribute('aria-pressed', 'true');
  await hidePasswordButton.click();
  await expect(passwordInput).toHaveAttribute('type', 'password');
});
