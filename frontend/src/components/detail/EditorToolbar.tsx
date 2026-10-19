'use client';
import { Fragment, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import FormatBold from '@mui/icons-material/FormatBold';
import FormatItalic from '@mui/icons-material/FormatItalic';
import FormatListBulleted from '@mui/icons-material/FormatListBulleted';
import FormatListNumbered from '@mui/icons-material/FormatListNumbered';
import FormatUnderlined from '@mui/icons-material/FormatUnderlined';
import InsertLink from '@mui/icons-material/InsertLink';
import Redo from '@mui/icons-material/Redo';
import Undo from '@mui/icons-material/Undo';

/**
 * Turns what was typed into a safe link address: http(s) and mailto as given, a bare domain as https,
 * a bare e-mail address as mailto. Anything else (javascript:, file:, plain words) is refused (null).
 */
export function normalizeLink(input: string): string | null {
  const value = input.trim();
  if (!value || /\s/.test(value)) return null;
  if (/^https?:\/\/[^/?#]+\.[^/?#]+|^https?:\/\/localhost\b/i.test(value)) return value;
  if (/^mailto:[^@]+@[^@]+\.[^@]+$/i.test(value)) return value;
  // Some other scheme ("javascript:", "ftp:"); a port ("example.com:8080") is not one.
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(value)) return null;
  if (/^[^@/]+@[^@/]+\.[^@/]+$/.test(value)) return `mailto:${value}`;
  if (/^[^./][^/]*\.[a-z]{2,}([:/?#]|$)/i.test(value)) return `https://${value}`;
  return null;
}

/** A Tiptap shortcut: Ctrl/⌘ plus optional Alt/⌥ and Shift/⇧ plus a key. */
export interface Shortcut {
  key: string;
  alt?: boolean;
  shift?: boolean;
}

/** "⌥⌘1" / "⇧⌘Z" on Apple keyboards (Apple's modifier order), "Ctrl+Alt+1" / "Ctrl+Shift+Z" elsewhere. */
export function shortcutLabel({ key, alt, shift }: Shortcut, mac: boolean): string {
  if (mac) return `${alt ? '⌥' : ''}${shift ? '⇧' : ''}⌘${key}`;
  return ['Ctrl', alt && 'Alt', shift && 'Shift', key].filter(Boolean).join('+');
}

interface Control {
  label: string;
  icon: ReactNode;
  /** Shown in the tooltip. */
  shortcut?: Shortcut;
  /** Starts a new group (a hairline before it). */
  group?: boolean;
}

const CONTROLS: Control[] = [
  { label: 'Bold', icon: <FormatBold />, shortcut: { key: 'B' } },
  { label: 'Italic', icon: <FormatItalic />, shortcut: { key: 'I' } },
  { label: 'Underline', icon: <FormatUnderlined />, shortcut: { key: 'U' } },
  { label: 'Heading 1', icon: <HeadingGlyph level={1} />, shortcut: { key: '1', alt: true }, group: true },
  { label: 'Heading 2', icon: <HeadingGlyph level={2} />, shortcut: { key: '2', alt: true } },
  { label: 'Bulleted list', icon: <FormatListBulleted />, shortcut: { key: '8', shift: true }, group: true },
  { label: 'Numbered list', icon: <FormatListNumbered />, shortcut: { key: '7', shift: true } },
  { label: 'Link', icon: <InsertLink />, group: true },
  { label: 'Undo', icon: <Undo />, shortcut: { key: 'Z' }, group: true },
  { label: 'Redo', icon: <Redo />, shortcut: { key: 'Z', shift: true } },
];

/** "H1" / "H2" drawn at icon size, since the icon set has no heading glyphs. */
function HeadingGlyph({ level }: { level: 1 | 2 }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{ width: 24, height: 24, display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}
    >
      H{level}
    </Box>
  );
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/**
 * The writer's ten controls (Bold, Italic, Underline · H1, H2 · lists · Link · Undo, Redo) and nothing
 * else. One tab stop, arrow keys move along it; each shows whether it is on (aria-pressed) and its
 * shortcut in a tooltip. Pressing a control keeps the caret where it was in the text.
 */
export default function EditorToolbar({ editor, disabled = false }: { editor: Editor; disabled?: boolean }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      bullets: e.isActive('bulletList'),
      numbers: e.isActive('orderedList'),
      link: e.isActive('link'),
      href: (e.getAttributes('link').href as string | undefined) ?? '',
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  // The Link button the link form hangs from, while it is open.
  const [linkAnchor, setLinkAnchor] = useState<HTMLElement | null>(null);
  const mac = isMac();

  const chain = () => editor.chain().focus();
  const actions: { run: (button: HTMLElement) => void; pressed?: boolean; disabled?: boolean }[] = [
    { run: () => chain().toggleBold().run(), pressed: state.bold },
    { run: () => chain().toggleItalic().run(), pressed: state.italic },
    { run: () => chain().toggleUnderline().run(), pressed: state.underline },
    { run: () => chain().toggleHeading({ level: 1 }).run(), pressed: state.h1 },
    { run: () => chain().toggleHeading({ level: 2 }).run(), pressed: state.h2 },
    { run: () => chain().toggleBulletList().run(), pressed: state.bullets },
    { run: () => chain().toggleOrderedList().run(), pressed: state.numbers },
    { run: (button) => setLinkAnchor(button), pressed: state.link },
    { run: () => chain().undo().run(), disabled: !state.canUndo },
    { run: () => chain().redo().run(), disabled: !state.canRedo },
  ];

  const usable = (i: number) => !disabled && !actions[i].disabled;
  // The toolbar's one tab stop; never a disabled button (Undo with nothing to undo), or Tab would skip the toolbar.
  const tabStop = usable(focusIndex) ? focusIndex : Math.max(0, actions.findIndex((_, i) => usable(i)));

  function onKeyDown(event: KeyboardEvent) {
    const n = CONTROLS.length;
    const moves: Record<string, [start: number, step: number]> = {
      ArrowRight: [focusIndex + 1, 1],
      ArrowLeft: [focusIndex - 1, -1],
      Home: [0, 1],
      End: [n - 1, -1],
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const [start, step] = moves[event.key];
    for (let k = 0; k < n; k++) {
      const i = (((start + k * step) % n) + n) % n;
      if (usable(i)) {
        setFocusIndex(i);
        buttons.current[i]?.focus();
        return;
      }
    }
  }

  return (
    <>
      <Stack
        role="toolbar"
        aria-label="Formatting"
        direction="row"
        onKeyDown={onKeyDown}
        // Phones: one row of 36px buttons with bare hairlines between the groups; wraps only below ~370px.
        sx={{ alignItems: 'center', flexWrap: 'wrap', gap: { xs: 0, sm: 0.5 } }}
      >
        {CONTROLS.map((control, i) => {
          const action = actions[i];
          const off = disabled || action.disabled;
          const hint = control.shortcut ? `${control.label} (${shortcutLabel(control.shortcut, mac)})` : control.label;
          return (
            <Fragment key={control.label}>
              {control.group && <Divider orientation="vertical" flexItem sx={{ mx: { xs: 0, sm: 0.5 }, my: 1 }} />}
              <Tooltip title={hint} describeChild enterDelay={400}>
                {/* The span keeps the tooltip working while the button is disabled. */}
                <Box component="span" sx={{ display: 'inline-flex' }}>
                  <IconButton
                    ref={(el) => {
                      buttons.current[i] = el;
                    }}
                    aria-label={control.label}
                    aria-pressed={action.pressed === undefined ? undefined : action.pressed}
                    aria-haspopup={control.label === 'Link' ? 'dialog' : undefined}
                    tabIndex={i === tabStop ? 0 : -1}
                    disabled={off}
                    onFocus={() => setFocusIndex(i)}
                    // Keep the caret (and the selection) in the text while pressing.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => action.run(e.currentTarget)}
                    sx={(theme) => ({
                      width: { xs: 36, sm: 40 },
                      height: { xs: 36, sm: 40 },
                      borderRadius: `${theme.yungu.shape.medium}px`,
                      color: 'text.secondary',
                      transition: theme.transitions.create(['background-color', 'color'], { duration: theme.transitions.duration.shortest }),
                      '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                      '&[aria-pressed="true"]': {
                        bgcolor: theme.yungu.color.secondaryContainer,
                        color: theme.yungu.color.onSecondaryContainer,
                      },
                    })}
                  >
                    {control.icon}
                  </IconButton>
                </Box>
              </Tooltip>
            </Fragment>
          );
        })}
      </Stack>
      <LinkPopover
        anchor={linkAnchor}
        href={state.href}
        editor={editor}
        onClose={() => {
          setLinkAnchor(null);
          editor.commands.focus();
        }}
      />
    </>
  );
}

interface LinkPopoverProps {
  anchor: HTMLElement | null;
  /** The link under the caret, when there is one. */
  href: string;
  editor: Editor;
  onClose: () => void;
}

/** Enter, change or remove the link on the selection (or on the link the caret is in). */
function LinkPopover({ anchor, href, editor, onClose }: LinkPopoverProps) {
  const open = anchor !== null;
  return (
    <Popover
      open={open}
      anchorEl={anchor}
      onClose={onClose}
      disableRestoreFocus
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-label': href ? 'Edit link' : 'Add link',
          sx: (theme) => ({ mt: 0.5, p: 2, width: 340, maxWidth: 'calc(100vw - 32px)', borderRadius: `${theme.yungu.shape.large}px` }),
        },
      }}
    >
      {/* Remounted on each opening, so the field starts from the current link. */}
      {open && <LinkForm href={href} editor={editor} onClose={onClose} />}
    </Popover>
  );
}

function LinkForm({ href, editor, onClose }: { href: string; editor: Editor; onClose: () => void }) {
  const [value, setValue] = useState(href);
  const [error, setError] = useState<string | null>(null);

  function apply() {
    const url = normalizeLink(value);
    if (!url) {
      setError('Use a web address (https://…) or an e-mail address.');
      return;
    }
    const chain = editor.chain().focus();
    if (editor.state.selection.empty && !editor.isActive('link')) {
      const text = url.replace(/^mailto:/i, '');
      chain.insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href: url } }] }).run();
    } else {
      chain.extendMarkRange('link').setLink({ href: url }).run();
    }
    onClose();
  }

  function remove() {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    onClose();
  }

  return (
    <Box
      component="form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <TextField
        autoFocus
        fullWidth
        size="small"
        label="Link address"
        placeholder="https://"
        value={value}
        error={error !== null}
        helperText={error ?? ' '}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        slotProps={{ htmlInput: { inputMode: 'url', autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false } }}
      />
      <Stack direction="row" sx={{ mt: 0.5, gap: 1, alignItems: 'center' }}>
        {href && (
          <Button color="error" onClick={remove} sx={{ mr: 'auto', ml: -1 }}>
            Remove link
          </Button>
        )}
        <Button onClick={onClose} sx={{ ml: href ? 0 : 'auto' }}>
          Cancel
        </Button>
        <Button type="submit" variant="contained">
          {href ? 'Save' : 'Add link'}
        </Button>
      </Stack>
    </Box>
  );
}
