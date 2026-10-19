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
 * where it will sit rather than only materialising. Leaving stays a plain fade (quick and quiet).
 * With reduced motion asked for there is no scale at all: the fade alone remains.
 */
export function popIn(reduceMotion: boolean): Pick<TransitionProps, 'onEnter' | 'onEntering' | 'onEntered'> {
  if (reduceMotion) return {};
  return {
    onEnter: (node: HTMLElement) => {
      const paper = paperOf(node);
      if (!paper) return;
      paper.style.transition = 'none';
      paper.style.scale = POP_FROM;
      // Commit the starting size, so the change below animates.
      void paper.offsetHeight;
    },
    onEntering: (node: HTMLElement) => {
      const paper = paperOf(node);
      if (!paper) return;
      paper.style.transition = `scale ${POP_MS}ms ${EASE_OUT}`;
      paper.style.scale = '';
    },
    onEntered: (node: HTMLElement) => {
      const paper = paperOf(node);
      // Hand the paper back to its own transitions (the pop-up's size morph).
      if (paper) paper.style.transition = '';
    },
  };
}
