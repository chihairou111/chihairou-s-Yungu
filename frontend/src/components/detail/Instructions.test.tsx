import { act, render, screen } from '../test-render';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDetailSeed, buildTodo } from '@/lib/data/fixtures';
import Instructions, { COLLAPSED_PX, nestHeadings, stripTitle } from './Instructions';

function mockScrollHeight(px: number) {
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(px);
}

afterEach(() => vi.restoreAllMocks());

describe('Instructions', () => {
  it('collapses long instructions behind Show more / Show less', async () => {
    expect(COLLAPSED_PX).toBe(240);
    mockScrollHeight(900);
    render(<Instructions html="<p>本周任务：完成第一次城中村观察。</p>" />);
    const more = screen.getByRole('button', { name: 'Show more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    const body = document.getElementById(more.getAttribute('aria-controls')!)!;
    expect(body).toHaveStyle({ maxHeight: '240px' });

    await userEvent.click(more);
    const less = screen.getByRole('button', { name: 'Show less' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    expect(body).not.toHaveStyle({ maxHeight: '240px' });
  });

  it('shows short instructions in full, with no toggle', () => {
    mockScrollHeight(120);
    render(<Instructions html="<p>Read chapter 3.</p>" />);
    expect(screen.getByText('Read chapter 3.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('keeps images inside the text width', () => {
    render(<Instructions html={'<p>See:</p><img src="/mock/sample.png" alt="Example">'} />);
    expect(screen.getByRole('img', { name: 'Example' })).toHaveStyle({ maxWidth: '100%', height: 'auto' });
  });

  it('says so when the teacher wrote nothing', () => {
    render(<Instructions html="  " />);
    expect(screen.getByText('No instructions for this task.')).toBeInTheDocument();
  });

  it("nests the teacher's headings under the Instructions heading", () => {
    expect(nestHeadings('<h1>A</h1><H2 class="x">B</H2><h3>C</h3><h4>D</h4><p>h1</p>')).toBe(
      '<h4>A</h4><h5 class="x">B</h5><h6>C</h6><h6>D</h6><p>h1</p>',
    );
    // The teacher's top level becomes h4 whatever it was, so the outline never skips a level.
    expect(nestHeadings('<h2>A</h2><p>x</p><h3>B</h3>')).toBe('<h4>A</h4><p>x</p><h5>B</h5>');
    expect(nestHeadings('<h3>A</h3><h5>B</h5>')).toBe('<h4>A</h4><h6>B</h6>');
    render(<Instructions html="<h2>Task 3</h2><p>Go.</p>" />);
    expect(screen.getByRole('heading', { level: 4, name: 'Task 3' })).toBeInTheDocument();
  });

  it('expands when keyboard focus reaches a link below the cut', () => {
    mockScrollHeight(900);
    render(<Instructions html={'<p>Long text</p><p><a href="https://a.b">Reference</a></p>'} />);
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
    act(() => screen.getByRole('link', { name: 'Reference' }).focus());
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('stripTitle', () => {
  it('drops a leading block that repeats the title, across whitespace and punctuation width', () => {
    expect(stripTitle('<h2>第3单元： 观察  报告</h2><p>Do it.</p>', '第3单元:观察 报告')).toBe('<p>Do it.</p>');
    expect(stripTitle('<p><strong>Lab (draft)</strong></p><p>Body</p>', 'Lab （draft）')).toBe('<p>Body</p>');
    expect(stripTitle('<h4>Essay</h4>', 'Essay')).toBe('');
  });
  it('keeps a different first block or one that only starts like the title', () => {
    expect(stripTitle('<h2>Materials</h2><p>Paper</p>', 'Essay')).toBe('<h2>Materials</h2><p>Paper</p>');
    expect(stripTitle('<p>Essay draft due</p>', 'Essay')).toBe('<p>Essay draft due</p>');
  });
  it('keeps a first block holding images or lists, and only strips the first block', () => {
    expect(stripTitle('<p>Essay<img src="a.png"></p>', 'Essay')).toBe('<p>Essay<img src="a.png"></p>');
    expect(stripTitle('<p>Intro</p><h2>Essay</h2>', 'Essay')).toBe('<p>Intro</p><h2>Essay</h2>');
  });
  it("strips fixture 102's repeated title (full-width colon, CJK)", () => {
    const html = '<h2>Task 3：开始第一次观察</h2><p>这周请你走进真实场景。</p>';
    expect(stripTitle(html, 'Task 3：开始第一次观察')).toBe('<p>这周请你走进真实场景。</p>');

    // And the fixture itself, so a change to its title or first block cannot quietly bring the repeat back.
    const now = Date.UTC(2026, 9, 19, 2);
    const title = buildTodo(now).find((a) => a.id === 102)!.title;
    const seed = buildDetailSeed(102, now)!;
    expect(seed.instructionsHtml.startsWith(`<h2>${title}</h2>`)).toBe(true);
    render(<Instructions html={seed.instructionsHtml} title={title} />);
    expect(screen.queryByRole('heading', { name: title })).not.toBeInTheDocument();
    expect(screen.queryByText(title)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Instructions' })).toBeInTheDocument();
  });

  it('is not rendered by the component', () => {
    render(<Instructions html="<h2>Essay</h2><p>Write it.</p>" title="Essay" />);
    expect(screen.queryByRole('heading', { name: 'Essay' })).not.toBeInTheDocument();
    expect(screen.getByText('Write it.')).toBeInTheDocument();
  });
});
