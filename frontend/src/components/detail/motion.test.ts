import { describe, expect, it } from 'vitest';
import { popIn } from './motion';

function dialogNode() {
  const container = document.createElement('div');
  const paper = document.createElement('div');
  paper.className = 'MuiPaper-root MuiDialog-paper';
  paper.style.transition = 'width 225ms';
  container.append(paper);
  return { container, paper };
}

describe('popIn', () => {
  it('starts the paper slightly small and lets it settle to full size', () => {
    const { container, paper } = dialogNode();
    const { onEnter, onEntering } = popIn(false);
    onEnter!(container, false);
    expect(paper.style.scale).toBe('0.97');
    onEntering!(container, false);
    expect(paper.style.scale).toBe('');
    expect(paper.style.transition).toMatch(/scale 225ms cubic-bezier\(0\.23, 1, 0\.32, 1\)$/);
  });

  it("keeps the paper's own transitions (its size morph) running while it scales in", () => {
    const { container, paper } = dialogNode();
    const { onEnter, onEntering, onEntered } = popIn(false);
    onEnter!(container, false);
    onEntering!(container, false);
    expect(paper.style.transition).toBe('width 225ms, scale 225ms cubic-bezier(0.23, 1, 0.32, 1)');
    onEntered!(container, false);
    expect(paper.style.transition).toBe('width 225ms');
  });

  it('adds no movement when reduced motion is asked for', () => {
    expect(popIn(true)).toEqual({});
  });
});
