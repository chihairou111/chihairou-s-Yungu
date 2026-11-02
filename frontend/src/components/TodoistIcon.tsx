import { useId } from 'react';
import SvgIcon, { type SvgIconProps } from '@mui/material/SvgIcon';

/**
 * Todoist's mark as a one-colour glyph for the app bar: a rounded square with its three checkmark
 * stripes cut out (a mask, so the stripes show whatever is behind the icon, hover layer included).
 * It takes the current colour like the outlined icons beside it; the brand red is left to the error
 * badge, which would otherwise disappear against it.
 */
export default function TodoistIcon(props: SvgIconProps) {
  const mask = useId();
  return (
    <SvgIcon {...props}>
      <defs>
        <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect x="3.5" y="3.5" width="17" height="17" rx="4.25" fill="#fff" />
          <g fill="none" stroke="#000" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6.9 8.5 9 9.7 17.1 6.7" />
            <path d="M6.9 12.3 9 13.5 17.1 10.5" />
            <path d="M6.9 16.1 9 17.3 17.1 14.3" />
          </g>
        </mask>
      </defs>
      {/* 17px rather than the full 18: a solid shape reads heavier than the outlined bell beside it. */}
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.25" mask={`url(#${mask})`} />
    </SvgIcon>
  );
}
