import { expect, test, type Page } from '@playwright/test';

// Agent access against the mock: the consent page (an agent's OAuth sign-in) and the Agent access dialog.
// The mock knows one agent, "Claude", returning to https://claude.ai/api/mcp/auth_callback; the browser
// never really leaves: that address is answered here. Agent access is shared by the whole run, so this
// file leaves it empty again.

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const REQUEST = {
  response_type: 'code',
  client_id: 'ylc_mock_claude',
  redirect_uri: CALLBACK,
  state: 'e2e-state',
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  code_challenge_method: 'S256',
  scope: 'read',
  resource: 'https://yungu.chihairou.dev/mcp',
};
const COPY =
  "Allow Claude to read your Yungu assignments, schedule, feedback, points and notifications? It can't hand in, comment or change anything.";
const authorizeUrl = (overrides: Record<string, string> = {}) => `/oauth/authorize?${new URLSearchParams({ ...REQUEST, ...overrides })}`;

async function signInHere(page: Page) {
  await page.getByLabel('Student ID').fill('170104022');
  await page.getByLabel('Password').fill('x');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** The agent's callback: answered in place, so the test sees where the browser went. */
async function answerCallback(page: Page) {
  await page.route(`${CALLBACK}**`, (route) => route.fulfill({ contentType: 'text/html', body: '<title>Agent</title><p>Back at the agent</p>' }));
}

test.describe.configure({ mode: 'serial' });

test('an agent connects: sign in, consent, back to the agent with a code; then disconnect it in Agent access', async ({ page }) => {
  await answerCallback(page);
  // Signed out: first the sign-in page, which comes back to the consent page with the whole request.
  await page.goto(authorizeUrl());
  await expect(page).toHaveURL(/\/login\?next=%2Foauth%2Fauthorize%3F/);
  await signInHere(page);
  await expect(page).toHaveURL(/\/oauth\/authorize\?/);

  const card = page.getByRole('main');
  await expect(card.getByRole('heading', { name: 'Connect Claude' })).toBeVisible();
  await expect(card.getByText(COPY)).toBeVisible();
  await expect(card.getByText('claude.ai', { exact: true })).toBeVisible();
  await expect(card).toContainText('Signed in as Bruce Zheng');

  // Never in another site's frame; the request never leaks in a Referer.
  const response = await page.request.get(authorizeUrl());
  expect(response.headers()['x-frame-options']).toBe('DENY');
  expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(response.headers()['referrer-policy']).toBe('no-referrer');

  await card.getByRole('button', { name: 'Allow' }).click();
  await expect(page.getByText('Back at the agent')).toBeVisible();
  const back = new URL(page.url());
  expect(back.origin + back.pathname).toBe(CALLBACK);
  expect(back.searchParams.get('code')).toMatch(/^mock-code-/);
  expect(back.searchParams.get('state')).toBe('e2e-state');
  expect(back.searchParams.get('iss')).toBe('https://yungu.chihairou.dev');

  // The agent is listed in Agent access; disconnecting it empties the list.
  await page.goto('/assignments');
  await page.getByRole('button', { name: 'Account: Bruce Zheng' }).click();
  await page.getByRole('menuitem', { name: 'Agent access' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agent access' });
  const agents = dialog.getByRole('list', { name: 'Connected agents' });
  await expect(agents).toContainText('Claude');
  await expect(agents).toContainText('Connected just now · Not used yet');
  await agents.getByRole('button', { name: 'Disconnect Claude' }).click();
  await expect(dialog.getByText('No agents connected yet.')).toBeVisible();
});

test('Deny goes back to the agent with the denial; a bad request never redirects', async ({ page }) => {
  await answerCallback(page);
  await page.goto('/login');
  await signInHere(page);
  await expect(page).toHaveURL(/\/assignments$/);

  await page.goto(authorizeUrl());
  await page.getByRole('button', { name: 'Deny' }).click();
  await expect(page.getByText('Back at the agent')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('error')).toBe('access_denied');

  // An unknown agent, or a return address it didn't register: a plain card, nowhere to go but here.
  const refused: Record<string, string>[] = [{ client_id: 'ylc_unknown' }, { redirect_uri: 'https://evil.example/cb' }];
  for (const overrides of refused) {
    await page.goto(authorizeUrl(overrides));
    await expect(page.getByRole('heading', { name: 'Can’t connect this agent' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Return to/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Allow' })).toHaveCount(0);
  }
  await expect(page.getByRole('main')).not.toContainText('evil.example');

  // A request the service refuses with a redirect (no PKCE): the reason, and the way back to the agent.
  await page.goto(authorizeUrl({ code_challenge_method: 'plain' }));
  await page.getByRole('link', { name: 'Return to claude.ai' }).click();
  await expect(page.getByText('Back at the agent')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('error')).toBe('invalid_request');
});

test('the sign-in page only ever returns to a path on this site', async ({ page }) => {
  for (const next of ['https://evil.example/', '//evil.example', '/\\evil.example']) {
    await page.context().clearCookies();
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await signInHere(page);
    await expect(page).toHaveURL(/127\.0\.0\.1:3100\/assignments$/);
  }
  // Signed in, the sign-in page itself honours a safe next.
  await page.goto(`/login?next=${encodeURIComponent('/calendar')}`);
  await expect(page).toHaveURL(/\/calendar$/);
});

test('personal tokens: create one, see it once and copy it, then revoke it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/login');
  await signInHere(page);
  await expect(page).toHaveURL(/\/assignments$/);
  await page.getByRole('button', { name: 'Account: Bruce Zheng' }).click();
  await page.getByRole('menuitem', { name: 'Agent access' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agent access' });
  await expect(dialog.getByText('https://yungu.chihairou.dev/mcp')).toBeVisible();
  await dialog.getByRole('button', { name: 'Copy server URL' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://yungu.chihairou.dev/mcp');

  await dialog.getByLabel('Token name').fill('E2E laptop');
  await dialog.getByRole('button', { name: 'Create token' }).click();
  const reveal = dialog.getByRole('region', { name: 'New token: E2E laptop' });
  await expect(reveal).toContainText(/ylp_[A-Za-z0-9_-]{43}/);
  await expect(reveal.getByRole('button', { name: 'Copy token' })).toBeFocused();
  await reveal.getByRole('button', { name: 'Copy token' }).click();
  await expect(reveal.getByRole('button', { name: 'Copy token' })).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^ylp_/);

  const tokens = dialog.getByRole('list', { name: 'Personal tokens' });
  await expect(tokens).toContainText('E2E laptop');
  await expect(tokens).not.toContainText('ylp_');

  // Shown once: closed and opened again, the secret is gone; the token is still listed.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Account: Bruce Zheng' }).click();
  await page.getByRole('menuitem', { name: 'Agent access' }).click();
  await expect(tokens).toContainText('E2E laptop');
  await expect(dialog).not.toContainText('ylp_');

  await tokens.getByRole('button', { name: 'Revoke E2E laptop' }).click();
  await expect(tokens.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await tokens.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(dialog.getByText('No tokens yet.')).toBeVisible();
});

test('Agent access fits a phone: full screen, no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await signInHere(page);
  await expect(page).toHaveURL(/\/assignments$/);
  await page.getByRole('button', { name: 'Account: Bruce Zheng' }).click();
  await page.getByRole('menuitem', { name: 'Agent access' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agent access' });
  await expect(dialog.getByText('No tokens yet.')).toBeVisible();
  // Once it has settled from its small scale-up.
  await expect.poll(async () => Math.round((await page.locator('.MuiDialog-paper').boundingBox())!.width)).toBe(390);
  const overflow = await page.locator('.MuiDialog-paper').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
