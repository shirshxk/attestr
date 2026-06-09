// Inline SVG icon set — stroke-based, 1.6 width, inherits currentColor.
// No emoji anywhere in the app.

const base = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }

export const IconGrid = (p) => (<svg {...base} {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>)
export const IconKey = (p) => (<svg {...base} {...p}><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.5 12.5 21 2M16 7l3 3M14 9l2 2"/></svg>)
export const IconShield = (p) => (<svg {...base} {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>)
export const IconChart = (p) => (<svg {...base} {...p}><path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="5"/><rect x="12" y="8" width="3" height="9"/><rect x="17" y="5" width="3" height="12"/></svg>)
export const IconList = (p) => (<svg {...base} {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>)
export const IconPlus = (p) => (<svg {...base} {...p}><path d="M12 5v14M5 12h14"/></svg>)
export const IconBox = (p) => (<svg {...base} {...p}><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg>)
export const IconUsers = (p) => (<svg {...base} {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>)
export const IconBell = (p) => (<svg {...base} {...p}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>)
export const IconLogout = (p) => (<svg {...base} {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>)
export const IconSun = (p) => (<svg {...base} {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>)
export const IconMoon = (p) => (<svg {...base} {...p}><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>)
export const IconChevronLeft = (p) => (<svg {...base} {...p}><path d="m15 18-6-6 6-6"/></svg>)
export const IconChevronRight = (p) => (<svg {...base} {...p}><path d="m9 18 6-6-6-6"/></svg>)
export const IconCheck = (p) => (<svg {...base} {...p}><path d="M20 6 9 17l-5-5"/></svg>)
export const IconX = (p) => (<svg {...base} {...p}><path d="M18 6 6 18M6 6l12 12"/></svg>)
export const IconClock = (p) => (<svg {...base} {...p}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>)
export const IconArrowRight = (p) => (<svg {...base} {...p}><path d="M5 12h14M12 5l7 7-7 7"/></svg>)
export const IconDownload = (p) => (<svg {...base} {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>)
export const IconTree = (p) => (<svg {...base} {...p}><circle cx="12" cy="4" r="2"/><circle cx="6" cy="13" r="2"/><circle cx="18" cy="13" r="2"/><circle cx="4" cy="20" r="1.6"/><circle cx="9" cy="20" r="1.6"/><path d="M12 6v2a4 4 0 0 1-4 4M12 6v2a4 4 0 0 0 4 4M6 15v1a2 2 0 0 0 0 0M5 18.5 5.5 17M7 18.5 6.5 17"/></svg>)
export const IconFile = (p) => (<svg {...base} {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>)
export const IconLock = (p) => (<svg {...base} {...p}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>)
export const IconSend = (p) => (<svg {...base} {...p}><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/></svg>)
export const IconInbox = (p) => (<svg {...base} {...p}><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z"/></svg>)
