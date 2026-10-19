import { act, render, screen } from '../test-render';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Instructions, { COLLAPSED_PX, nestHeadings } from './Instructions';

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
    render(<Instructions html="<h2>Task 3</h2><p>Go.</p>" />);
    expect(screen.getByRole('heading', { level: 5, name: 'Task 3' })).toBeInTheDocument();
  });

  it('expands when keyboard focus reaches a link below the cut', () => {
    mockScrollHeight(900);
    render(<Instructions html={'<p>Long text</p><p><a href="https://a.b">Reference</a></p>'} />);
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
    act(() => screen.getByRole('link', { name: 'Reference' }).focus());
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
  });
});
