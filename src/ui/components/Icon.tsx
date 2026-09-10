import type { SVGProps } from 'react';
// ⚠️ 2026-09-10: added arrow-up/arrow-left/arrow-right/cross — JourneyScreen
// used to pick an icon by step INDEX (bus, store, then coffee for
// everything after), which frequently contradicted the actual instruction.
// These four are the neutral, always-honest fallback: derived from
// step.action, which every step genuinely has, rather than a specific
// (and often wrong) landmark-category icon. See JourneyScreen.tsx.
export type IconName =
  | 'mic'
  | 'bus'
  | 'store'
  | 'coffee'
  | 'check'
  | 'alert'
  | 'volume'
  | 'arrow-up'
  | 'arrow-left'
  | 'arrow-right'
  | 'cross'
  | 'pin';
export function Icon({ name, size = 48, ...props }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...props };
  const shapes = {
    mic: <><rect x="8" y="3" width="8" height="12" rx="4" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></>,
    bus: <><rect x="4" y="4" width="16" height="15" rx="3" /><path d="M4 11h16M7 7h3M14 7h3M7 19v2M17 19v2" /><circle cx="8" cy="16" r="1" /><circle cx="16" cy="16" r="1" /></>,
    store: <><path d="M4 10h16l-1-5H5l-1 5Z" /><path d="M5 10v9h14v-9M9 19v-5h6v5" /></>,
    coffee: <><path d="M5 8h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8ZM16 10h2a2 2 0 0 1 0 4h-2" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
    alert: <><path d="m12 3 9 17H3L12 3Z" /><path d="M12 9v4M12 16h.01" /></>,
    volume: <><path d="M4 10v4h4l5 4V6l-5 4H4Z" /><path d="M17 9a4 4 0 0 1 0 6" /></>,
    'arrow-up': <path d="M12 19V5M6 11l6-6 6 6" />,
    'arrow-left': <path d="M19 12H5M11 6l-6 6 6 6" />,
    'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
    cross: <><circle cx="12" cy="5" r="2" /><path d="M12 7v6M9 10h6M9 20l3-7 3 7" /></>,
    pin: <><path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" /><circle cx="12" cy="9" r="2.5" /></>,
  };
  return <svg {...common}>{shapes[name]}</svg>;
}
