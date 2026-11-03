import type { TransitionProps } from '@mui/material/transitions';

/**
 * The pop-up's motion vocabulary, so every entrance in it moves alike: a strong ease-out (fast start,
 * long settle) for things arriving, kept under 250ms. Opacity and transform only; nothing here ever
 * waits for an animation before taking input.
 */
export const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
/** A thumbnail's preview arriving over its placeholder; a view replacing another inside the pop-up. */
export const FADE_MS = 200;
/** A dialog's paper settling from slightly smaller as it fades in (the Fade itself runs 225ms). */
export const POP_MS = 225;
const POP_FROM = '0.97';

const paperOf = (node: HTMLElement) => node.querySelector<HTMLElement>('.MuiDialog-paper');

/**
 * Transition callbacks for an MUI Dialog that add a small scale-up to its fade, so it arrives from
 * where it will sit rather than only materialising. The paper's own transitions (the pop-up's size
 * morph from skeleton to a short message) keep running alongside: the scale is appended to them, not
 * swapped in. Leaving stays a plain fade (quick and quiet). With reduced motion asked for there is no
 * scale at all: the fade alone remains.
 */
export function popIn(reduceMotion: boolean): Pick<TransitionProps, 'onEnter' | 'onEntering' | 'onEntered'> {
  if (reduceMotion) return {};
  // The paper's transitions as styled, and its inline value to restore afterwards.
  let own = '';
  let inline = '';
  return {
    onEnter: (node: HTMLElement) => {
      const paper = paperOf(node);
      if (!paper) return;
      inline = paper.style.transition;
      own = getComputedStyle(paper).transition;
      // `scale` is not among the paper's transitions yet, so this applies at once.
      paper.style.scale = POP_FROM;
      // Commit the starting size, so the change below animates.
      void paper.offsetHeight;
    },
    onEntering: (node: HTMLElement) => {
      const paper = paperOf(node);
      if (!paper) return;
      const scale = `scale ${POP_MS}ms ${EASE_OUT}`;
      // No transitions of its own computes to `all 0s …` (or `none`), which cannot head a list.
      paper.style.transition = own && !/^(all|none)( 0s|$)/.test(own) ? `${own}, ${scale}` : scale;
      paper.style.scale = '';
    },
    onEntered: (node: HTMLElement) => {
      const paper = paperOf(node);
      if (paper) paper.style.transition = inline;
    },
  };
}

/**
 * A message or a prompt appearing in place (an error above the buttons, an "are you sure" row): it
 * fades in from a few pixels above on the strong ease-out. With reduced motion only the fade remains.
 */
export const ARRIVE_IN = {
  animation: `yl-arrive-in ${FADE_MS}ms ${EASE_OUT}`,
  '@keyframes yl-arrive-in': { from: { opacity: 0, transform: 'translateY(-4px)' } },
  '@keyframes yl-arrive-fade': { from: { opacity: 0 } },
  '@media (prefers-reduced-motion: reduce)': { animationName: 'yl-arrive-fade' },
} as const;
