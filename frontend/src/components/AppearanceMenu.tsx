'use client';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import Grow from '@mui/material/Grow';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import MenuList from '@mui/material/MenuList';
import Paper from '@mui/material/Paper';
import Popper from '@mui/material/Popper';
import CheckRounded from '@mui/icons-material/CheckRounded';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import type { Appearance } from '@/lib/appearance';
import { useAppearance } from '@/lib/useAppearance';
import { MENU_SHADOW } from '@/theme/expressive';

/** The pointer rests this long on Appearance before the submenu opens (passing over it does nothing). */
export const HOVER_OPEN_MS = 120;
/**
 * The pointer may be off both Appearance and the submenu this long before the submenu closes, so a
 * diagonal path into it (which crosses the next item) keeps it open.
 */
export const HOVER_CLOSE_MS = 300;
/** The submenu's width, for choosing its side before it is shown. */
const SUBMENU_PX = 176;
/** Room kept between the submenu and the window's edge. */
const EDGE_PX = 8;

const OPTIONS: { value: Appearance; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

type Side = 'left' | 'right' | 'below';
const PLACEMENT = { left: 'left-start', right: 'right-start', below: 'bottom-end' } as const;

/**
 * Where the submenu fits beside the parent menu: left first (the gear sits near the right edge), else
 * right, else (a phone) below Appearance, over the parent menu. Offsets ignore the menu's grow transform.
 */
function sideFor(item: HTMLElement): Side {
  const paper = item.closest<HTMLElement>('.MuiPaper-root');
  const left = paper ? paper.offsetLeft : item.getBoundingClientRect().left;
  const width = paper ? paper.offsetWidth : item.getBoundingClientRect().width;
  if (left >= SUBMENU_PX + EDGE_PX) return 'left';
  if (window.innerWidth - (left + width) >= SUBMENU_PX + EDGE_PX) return 'right';
  return 'below';
}

/** The arrow that leads into a submenu on `side` (both do below it), and the one that leads back. */
const opensWith = (side: Side, key: string) => (side === 'below' ? key === 'ArrowLeft' || key === 'ArrowRight' : key === (side === 'left' ? 'ArrowLeft' : 'ArrowRight'));
const closesWith = (side: Side, key: string) => side !== 'below' && key === (side === 'left' ? 'ArrowRight' : 'ArrowLeft');

interface AppearanceMenuProps {
  /** Closes the whole gear menu (after a choice). */
  onClose: () => void;
  /** Set by the parent MenuList on its first item. */
  autoFocus?: boolean;
  tabIndex?: number;
}

/**
 * The gear menu's `Appearance` item and its submenu of `Automatic`, `Light`, `Dark` (radio items, the
 * current one checked). A mouse opens it by resting on the item; a tap or click opens it (a tap again
 * closes it); the arrow toward its side, Enter or Space open it on the checked option, and the opposite
 * arrow or Escape come back to `Appearance`. It opens beside the menu where there is room, else below.
 */
export default function AppearanceMenu({ onClose, autoFocus, tabIndex }: AppearanceMenuProps) {
  const { appearance, setAppearance } = useAppearance();
  const id = useId();
  const itemId = `${id}-item`;
  const menuId = `${id}-menu`;
  // State, not a ref: the submenu is anchored to it, read during render.
  const [item, setItem] = useState<HTMLLIElement | null>(null);
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<Side>('left');
  // Opened from the keyboard or a tap: focus goes to the checked option. From a hover: it stays put.
  const [focusInside, setFocusInside] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The kind of pointer that pressed the item last (a click follows its pointerdown).
  const lastPointer = useRef<string>('mouse');

  const clearTimer = () => clearTimeout(timer.current);
  useEffect(() => clearTimer, []);

  function show(withFocus: boolean) {
    clearTimer();
    if (item) setSide(sideFor(item));
    setFocusInside(withFocus);
    setOpen(true);
  }
  function hide(refocus: boolean) {
    clearTimer();
    setOpen(false);
    if (refocus) item?.focus();
  }
  const later = (fn: () => void, ms: number) => {
    clearTimer();
    timer.current = setTimeout(fn, ms);
  };

  const isMouse = (e: PointerEvent) => e.pointerType === 'mouse';
  const onItemEnter = (e: PointerEvent) => {
    if (!isMouse(e)) return;
    if (open) clearTimer();
    else later(() => show(false), HOVER_OPEN_MS);
  };
  const onLeave = (e: PointerEvent) => {
    if (!isMouse(e)) return;
    if (open) later(() => setOpen(false), HOVER_CLOSE_MS);
    else clearTimer();
  };
  const onSubmenuEnter = (e: PointerEvent) => {
    if (isMouse(e)) clearTimer();
  };

  // Enter and Space reach onClick (as a click with no pointer); the arrows are handled here.
  function onItemKeyDown(e: KeyboardEvent) {
    if (item && opensWith(sideFor(item), e.key)) {
      e.preventDefault();
      e.stopPropagation();
      show(true);
    }
  }

  function onSubmenuKeyDown(e: KeyboardEvent) {
    // Tab leaves both menus (the parent menu closes on it).
    if (e.key === 'Tab') return;
    // Keys stay in the submenu: the parent menu's list would move its own focus, and its Escape would
    // close everything.
    e.stopPropagation();
    if (e.key === 'Escape' || closesWith(side, e.key)) {
      e.preventDefault();
      hide(true);
    }
  }

  function choose(value: Appearance) {
    setAppearance(value);
    hide(false);
    onClose();
  }

  const Chevron = side === 'right' ? ChevronRightRounded : side === 'below' ? ExpandMoreRounded : ChevronLeftRounded;

  return (
    <>
      <MenuItem
        ref={setItem}
        id={itemId}
        autoFocus={autoFocus}
        tabIndex={tabIndex}
        aria-haspopup="menu"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={open ? menuId : undefined}
        onPointerDown={(e) => {
          lastPointer.current = e.pointerType;
        }}
        onPointerEnter={onItemEnter}
        onPointerLeave={onLeave}
        onClick={(e) => {
          // From the keyboard (no pointer): open on the checked option.
          if (e.detail === 0) show(true);
          // A tap toggles; a mouse click (often after the hover already opened it) only opens.
          else if (lastPointer.current !== 'mouse') {
            if (open) hide(false);
            else show(true);
          } else show(false);
        }}
        onKeyDown={onItemKeyDown}
        sx={{ gap: 1 }}
      >
        <ListItemText>Appearance</ListItemText>
        <Chevron fontSize="small" aria-hidden sx={{ color: 'text.secondary', mr: -0.5 }} />
      </MenuItem>
      <Popper
        open={open}
        anchorEl={item}
        placement={PLACEMENT[side]}
        // Inside the gear menu's paper: within its focus trap and Escape handling, not clipped (the
        // paper lets it overflow), and gone with it.
        container={() => item?.closest<HTMLElement>('.MuiPaper-root') ?? null}
        transition
        modifiers={[
          { name: 'flip', enabled: false },
          { name: 'offset', options: { offset: side === 'below' ? [0, 0] : [-8, 2] } },
          { name: 'preventOverflow', options: { altAxis: true, padding: EDGE_PX } },
        ]}
        sx={{ zIndex: 1 }}
      >
        {({ TransitionProps, placement }) => (
          <Grow {...TransitionProps} style={{ transformOrigin: placement.startsWith('left') ? 'right top' : placement.startsWith('right') ? 'left top' : 'right top' }}>
            <Paper
              onPointerEnter={onSubmenuEnter}
              onPointerLeave={onLeave}
              sx={(theme) => ({
                minWidth: SUBMENU_PX,
                borderRadius: `${theme.yungu.shape.extraSmall}px`,
                bgcolor: theme.yungu.color.surfaceContainer,
                boxShadow: MENU_SHADOW,
                // Reduced motion: it fades in place, like the app's other menus.
                '@media (prefers-reduced-motion: reduce)': { transform: 'none !important', transition: 'opacity 120ms ease-out !important' },
              })}
            >
              <MenuList id={menuId} aria-labelledby={itemId} onKeyDown={onSubmenuKeyDown}>
                {OPTIONS.map(({ value, label }) => {
                  const checked = value === appearance;
                  return (
                    <MenuItem
                      key={value}
                      role="menuitemradio"
                      aria-checked={checked}
                      autoFocus={focusInside && checked}
                      onClick={() => choose(value)}
                    >
                      <ListItemIcon>{checked && <CheckRounded fontSize="small" />}</ListItemIcon>
                      <ListItemText>{label}</ListItemText>
                    </MenuItem>
                  );
                })}
              </MenuList>
            </Paper>
          </Grow>
        )}
      </Popper>
    </>
  );
}
