import type { SVGProps } from 'react';

export type ToolIconName =
  | 'accessibility'
  | 'automation'
  | 'comment'
  | 'compare'
  | 'convert'
  | 'edit'
  | 'history'
  | 'pages'
  | 'print'
  | 'protect'
  | 'redact'
  | 'sign'
  | 'tools';

const PATHS: Record<ToolIconName, readonly string[]> = {
  accessibility: ['M10 3a1.5 1.5 0 1 0 0 .01', 'M4 7h12', 'M10 7v10', 'M6 17l4-5 4 5'],
  automation: ['M5 4h4v4H5z', 'M11 12h4v4h-4z', 'M5 12h4v4H5z', 'M9 6h3v8'],
  comment: ['M4 4h12v9H9l-4 3v-3H4z', 'M7 8h6'],
  compare: ['M3 5h6v10H3z', 'M11 5h6v10h-6z', 'M7 10h6', 'M11 7l2 3-2 3'],
  convert: ['M5 4h7v5', 'M15 16H8v-5', 'M12 4l3 3-3 3', 'M8 16l-3-3 3-3'],
  edit: ['M5 3h7l3 3v11H5z', 'M12 3v4h4', 'M7 14l5-5 2 2-5 5-2 .5z'],
  history: ['M5 6V3L3 5', 'M5 4a7 7 0 1 1-1 8', 'M10 6v4l3 2'],
  pages: ['M5 3h9v11H5z', 'M7 6h5', 'M7 9h5', 'M3 6v11h9'],
  print: ['M6 3h8v4H6z', 'M4 8h12v7H4z', 'M6 13h8v4H6z', 'M14 10h.01'],
  protect: ['M10 3l6 3v4c0 4-2.5 6.5-6 7-3.5-.5-6-3-6-7V6z', 'M7.5 10l1.5 1.5 3.5-3.5'],
  redact: ['M4 4h12v12H4z', 'M6 8h8', 'M6 10h8', 'M6 12h8'],
  sign: ['M4 15c2-4 4 1 6-3 1-2 2-4 4-2', 'M4 17h12', 'M13 5l3 3'],
  tools: ['M4 4h5v5H4z', 'M11 4h5v5h-5z', 'M4 11h5v5H4z', 'M11 11h5v5h-5z'],
};

export default function ToolIcon({
  name,
  size = 18,
  ...props
}: SVGProps<SVGSVGElement> & { readonly name: ToolIconName; readonly size?: number }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
