import type { SVGProps } from 'react';
export type IconName = 'mic' | 'bus' | 'store' | 'coffee' | 'check' | 'alert' | 'volume';
export function Icon({ name, size = 48, ...props }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...props };
  const shapes = { mic: <><rect x="8" y="3" width="8" height="12" rx="4" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></>, bus: <><rect x="4" y="4" width="16" height="15" rx="3" /><path d="M4 11h16M7 7h3M14 7h3M7 19v2M17 19v2" /><circle cx="8" cy="16" r="1" /><circle cx="16" cy="16" r="1" /></>, store: <><path d="M4 10h16l-1-5H5l-1 5Z" /><path d="M5 10v9h14v-9M9 19v-5h6v5" /></>, coffee: <><path d="M5 8h11v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8ZM16 10h2a2 2 0 0 1 0 4h-2" /></>, check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>, alert: <><path d="m12 3 9 17H3L12 3Z" /><path d="M12 9v4M12 16h.01" /></>, volume: <><path d="M4 10v4h4l5 4V6l-5 4H4Z" /><path d="M17 9a4 4 0 0 1 0 6" /></> };
  return <svg {...common}>{shapes[name]}</svg>;
}
