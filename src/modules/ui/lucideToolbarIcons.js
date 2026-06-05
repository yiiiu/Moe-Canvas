// Lucide toolbar icon nodes vendored from node_modules/lucide/dist/esm/icons/*.mjs.
// Keep these as data arrays so the app does not request /node_modules at runtime.

const ChevronLeft = [['path', { d: 'm15 18-6-6 6-6' }]];

const Database = [
  ['ellipse', { cx: '12', cy: '5', rx: '9', ry: '3' }],
  ['path', { d: 'M3 5V19A9 3 0 0 0 21 19V5' }],
  ['path', { d: 'M3 12A9 3 0 0 0 21 12' }],
];

const Download = [
  ['path', { d: 'M12 15V3' }],
  ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
  ['path', { d: 'm7 10 5 5 5-5' }],
];

const Droplet = [
  [
    'path',
    {
      d: 'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z',
    },
  ],
];

const LayoutDashboard = [
  ['rect', { width: '7', height: '9', x: '3', y: '3', rx: '1' }],
  ['rect', { width: '7', height: '5', x: '14', y: '3', rx: '1' }],
  ['rect', { width: '7', height: '9', x: '14', y: '12', rx: '1' }],
  ['rect', { width: '7', height: '5', x: '3', y: '16', rx: '1' }],
];

const Link = [
  ['path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }],
  ['path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }],
];

const Lock = [
  ['rect', { width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2' }],
  ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }],
];

const LockOpen = [
  ['rect', { width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2' }],
  ['path', { d: 'M7 11V7a5 5 0 0 1 9.9-1' }],
];

const Moon = [
  [
    'path',
    {
      d: 'M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401',
    },
  ],
];

const Sparkles = [
  [
    'path',
    {
      d: 'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z',
    },
  ],
  ['path', { d: 'M20 2v4' }],
  ['path', { d: 'M22 4h-4' }],
  ['circle', { cx: '4', cy: '20', r: '2' }],
];

const Sun = [
  ['circle', { cx: '12', cy: '12', r: '4' }],
  ['path', { d: 'M12 2v2' }],
  ['path', { d: 'M12 20v2' }],
  ['path', { d: 'm4.93 4.93 1.41 1.41' }],
  ['path', { d: 'm17.66 17.66 1.41 1.41' }],
  ['path', { d: 'M2 12h2' }],
  ['path', { d: 'M20 12h2' }],
  ['path', { d: 'm6.34 17.66-1.41 1.41' }],
  ['path', { d: 'm19.07 4.93-1.41 1.41' }],
];

export const toolbarIconNodes = {
  chevronLeft: ChevronLeft,
  database: Database,
  download: Download,
  droplet: Droplet,
  layoutDashboard: LayoutDashboard,
  link: Link,
  lock: Lock,
  unlock: LockOpen,
  moon: Moon,
  sparkles: Sparkles,
  sun: Sun,
};