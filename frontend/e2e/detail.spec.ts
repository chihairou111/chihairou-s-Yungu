import { expect, test, type Page } from '@playwright/test';

// The assignment pop-up's routes and the steps e2e/dashboard.spec.ts does not already walk through
// (that file covers direct links, attachments and the viewer, upload and submit, the writer and the
// camera and recorder).

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Student ID').fill('170104022');
  await page.getByLabel('Password').fill('x');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/assignments$/);
}

test('a card click opens the pop-up in the URL, and browser Back closes it', async ({ page }) => {
  await signIn(page);
  // An overdue task: no other test submits it, so its card stays on the To-do tab.
  await page.getByRole('article').filter({ hasText: '我的产品，为谁解决什么问题？' }).click();
  await expect(page).toHaveURL(/[?&]task=101\b/);
  const dialog = page.getByRole('dialog', { name: '我的产品，为谁解决什么问题？' });
  await expect(dialog).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/assignments$/);
  await expect(dialog).toBeHidden();
});

test('an unknown task id says "Assignment not found" and closes', async ({ page }) => {
  await signIn(page);
  await page.goto('/assignments?task=999999');
  const dialog = page.getByRole('dialog', { name: 'Assignment not found' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/assignments$/);
});

test('post a comment, then delete it', async ({ page }) => {
  await signIn(page);
  await page.goto('/assignments?task=103');
  const dialog = page.getByRole('dialog');
  // No comments yet: one collapsed line.
  await dialog.getByRole('button', { name: 'Comments (0)' }).click();
  const composer = dialog.getByRole('textbox', { name: 'Add a comment' });
  await expect(composer).toBeFocused();
  await composer.fill('第一版已经上传，请老师看看。');
  await dialog.getByRole('button', { name: 'Post' }).click();
  await expect(dialog.getByRole('heading', { name: 'Comments (1)' })).toBeVisible();
  await expect(dialog.getByRole('listitem').filter({ hasText: '第一版已经上传' })).toBeVisible();
  await expect(composer).toHaveValue('');

  await dialog.getByRole('button', { name: 'Delete comment' }).click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Comments (0)' })).toBeVisible();
  await expect(dialog.getByText('第一版已经上传')).toHaveCount(0);
  await expect(composer).toBeFocused();
});

test('the writer takes IME composition, from the empty placeholder on', async ({ page }) => {
  await signIn(page);
  await page.goto('/assignments?task=101&write=1');
  const doc = page.getByRole('dialog').getByRole('textbox', { name: 'Your writing' });
  await expect(doc.locator('p.is-editor-empty')).toHaveAttribute('data-placeholder', 'Start writing…');
  await doc.click();

  // A real composition session, as a pinyin IME would drive it: marked text, then the commit.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'g', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.imeSetComposition', { text: 'gu', selectionStart: 2, selectionEnd: 2 });
  await cdp.send('Input.imeSetComposition', { text: 'guan', selectionStart: 4, selectionEnd: 4 });
  // The marked text is not drawn over by the "Start writing…" placeholder.
  await expect(doc).toHaveText('guan');
  await expect(doc.locator('p.is-editor-empty')).toHaveCount(0);
  await cdp.send('Input.insertText', { text: '观察' });
  await expect(doc).toHaveText('观察');
  await expect(doc.locator('p.is-editor-empty')).toHaveCount(0);

  // A second composition right after the first keeps both, in order.
  await cdp.send('Input.imeSetComposition', { text: 'ji', selectionStart: 2, selectionEnd: 2 });
  await cdp.send('Input.insertText', { text: '记录' });
  await expect(doc).toHaveText('观察记录');
  await expect(page.getByRole('dialog').getByText('Draft saved')).toBeVisible();
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the pop-up is full-screen with no horizontal scroll', async ({ page }) => {
    await signIn(page);
    await page.goto('/assignments?task=102');
    const dialog = page.getByRole('dialog', { name: 'Task 3：开始第一次观察' });
    await expect(dialog.getByRole('heading', { name: 'Attachments (4)' })).toBeVisible();
    // The dialog's paper is the element carrying the accessible name; it settles from a slight scale-up.
    await expect.poll(() => dialog.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    const overflow = await page.evaluate(() => {
      const scroller = (el: Element) => el.scrollWidth - el.clientWidth;
      const paper = document.querySelector('[role="dialog"]')!;
      return Math.max(scroller(document.documentElement), ...Array.from(paper.querySelectorAll('*')).filter((el) => getComputedStyle(el).overflowX !== 'visible' && getComputedStyle(el).overflowX !== 'hidden').map(scroller));
    });
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
