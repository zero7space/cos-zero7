/**
 * Shadcn UI Standard Lucide Icons
 * Pure SVG vectors with stroke="currentColor", stroke-width="2", stroke-linecap="round", stroke-linejoin="round"
 * Matches official shadcn/ui Lucide React icon definitions.
 */

const _lucideSvg = (inner, size = 16, strokeWidth = 2, className = "") => {
  const cls = className ? ` class="${className}"` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${cls}>${inner}</svg>`;
};

const Icons = {
  // Navigation & Core
  crown(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.735H5.81a1 1 0 0 1-.957-.735L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>', size, strokeWidth, className);
  },
  zap(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>', size, strokeWidth, className);
  },
  search(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>', size, strokeWidth, className);
  },
  messageSquare(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', size, strokeWidth, className);
  },
  messageCircle(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>', size, strokeWidth, className);
  },
  target(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>', size, strokeWidth, className);
  },
  crosshair(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<circle cx="12" cy="12" r="10"/><line x1="22" x1="18" y1="12" y2="12"/><line x1="6" x1="2" y1="12" y2="12"/><line x1="12" x1="12" y1="6" y2="2"/><line x1="12" x1="12" y1="22" y2="18"/>', size, strokeWidth, className);
  },
  bot(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>', size, strokeWidth, className);
  },
  brain(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/><path d="M16 8h4.5"/><path d="M16 12h4.5"/><path d="M16 16h4.5"/><path d="M3.5 8H8"/><path d="M3.5 12H8"/><path d="M3.5 16H8"/>', size, strokeWidth, className);
  },
  sparkles(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>', size, strokeWidth, className);
  },
  folder(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>', size, strokeWidth, className);
  },
  folderOpen(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>', size, strokeWidth, className);
  },
  clipboardList(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>', size, strokeWidth, className);
  },
  clipboard(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>', size, strokeWidth, className);
  },
  fileText(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>', size, strokeWidth, className);
  },
  fileCode(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M10 12.5 8 15l2 2.5"/><path d="m14 12.5 2 2.5-2 2.5"/><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>', size, strokeWidth, className);
  },
  fileSpreadsheet(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M8 13h2"/><path d="M14 13h2"/><path d="M8 17h2"/><path d="M14 17h2"/>', size, strokeWidth, className);
  },
  file(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>', size, strokeWidth, className);
  },
  mic(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>', size, strokeWidth, className);
  },
  micOff(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/>', size, strokeWidth, className);
  },
  arrowUp(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>', size, strokeWidth, className);
  },
  arrowDown(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>', size, strokeWidth, className);
  },
  arrowRight(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>', size, strokeWidth, className);
  },
  arrowLeft(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>', size, strokeWidth, className);
  },
  chevronDown(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<polyline points="6 9 12 15 18 9"/>', size, strokeWidth, className);
  },
  chevronUp(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<polyline points="18 15 12 9 6 15"/>', size, strokeWidth, className);
  },
  chevronRight(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<polyline points="9 18 15 12 9 6"/>', size, strokeWidth, className);
  },
  chevronLeft(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<polyline points="15 18 9 12 15 6"/>', size, strokeWidth, className);
  },
  eye(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>', size, strokeWidth, className);
  },
  eyeOff(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>', size, strokeWidth, className);
  },
  settings(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>', size, strokeWidth, className);
  },
  pin(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>', size, strokeWidth, className);
  },
  atSign(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/>', size, strokeWidth, className);
  },
  terminal(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>', size, strokeWidth, className);
  },
  tag(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><circle cx="7" cy="7" r=".5" fill="currentColor"/>', size, strokeWidth, className);
  },
  send(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>', size, strokeWidth, className);
  },
  check(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<polyline points="20 6 9 17 4 12"/>', size, strokeWidth, className);
  },
  checkCircle(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>', size, strokeWidth, className);
  },
  close(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', size, strokeWidth, className);
  },
  x(size = 16, strokeWidth = 2, className = "") {
    return this.close(size, strokeWidth, className);
  },
  xCircle(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>', size, strokeWidth, className);
  },
  plus(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>', size, strokeWidth, className);
  },
  edit(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>', size, strokeWidth, className);
  },
  trash(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', size, strokeWidth, className);
  },
  copy(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>', size, strokeWidth, className);
  },
  refresh(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>', size, strokeWidth, className);
  },
  globe(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>', size, strokeWidth, className);
  },
  externalLink(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>', size, strokeWidth, className);
  },
  phone(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>', size, strokeWidth, className);
  },
  mail(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>', size, strokeWidth, className);
  },
  user(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>', size, strokeWidth, className);
  },
  users(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>', size, strokeWidth, className);
  },
  briefcase(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>', size, strokeWidth, className);
  },
  clock(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>', size, strokeWidth, className);
  },
  calendar(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>', size, strokeWidth, className);
  },
  alert(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>', size, strokeWidth, className);
  },
  info(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>', size, strokeWidth, className);
  },
  helpCircle(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>', size, strokeWidth, className);
  },
  menu(size = 18, strokeWidth = 2, className = "") {
    return _lucideSvg('<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>', size, strokeWidth, className);
  },
  filter(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>', size, strokeWidth, className);
  },
  layers(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>', size, strokeWidth, className);
  },
  layoutDashboard(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>', size, strokeWidth, className);
  },
  plug(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a6 6 0 0 1-12 0V8z"/>', size, strokeWidth, className);
  },
  mapPin(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>', size, strokeWidth, className);
  },
  flame(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>', size, strokeWidth, className);
  },
  snowflake(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>', size, strokeWidth, className);
  },
  notepad(size = 16, strokeWidth = 2, className = "") {
    return this.fileText(size, strokeWidth, className);
  },
  logOut(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>', size, strokeWidth, className);
  },
  code(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>', size, strokeWidth, className);
  },
  monitor(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>', size, strokeWidth, className);
  },
  smartphone(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><line x1="12" x2="12.01" y1="18" y2="18"/>', size, strokeWidth, className);
  },
  sun(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>', size, strokeWidth, className);
  },
  moon(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>', size, strokeWidth, className);
  },
  download(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>', size, strokeWidth, className);
  },
  image(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>', size, strokeWidth, className);
  },
  qrcode(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>', size, strokeWidth, className);
  },
  gitBranch(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>', size, strokeWidth, className);
  },
  gitPullRequest(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/>', size, strokeWidth, className);
  },
  database(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>', size, strokeWidth, className);
  },
  server(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>', size, strokeWidth, className);
  },
  cpu(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>', size, strokeWidth, className);
  },
  shield(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.8 17 5 19 5a1 1 0 0 1 1 1z"/>', size, strokeWidth, className);
  },
  play(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<polygon points="6 3 20 12 6 21 6 3"/>', size, strokeWidth, className);
  },
  pause(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>', size, strokeWidth, className);
  },
  volume2(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>', size, strokeWidth, className);
  },
  paperclip(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>', size, strokeWidth, className);
  },
  loader(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M21 12a9 9 0 1 1-6.219-8.56"/>', size, strokeWidth, className);
  },
  wrench(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>', size, strokeWidth, className);
  },
  folderPlus(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>', size, strokeWidth, className);
  },
  filePlus(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 18v-6"/>', size, strokeWidth, className);
  },
  share(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>', size, strokeWidth, className);
  },
  whatsapp(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>', size, strokeWidth, className);
  },
  video(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<polygon points="23 7 16 12 23 17 23 7"/><rect width="15" height="14" x="1" y="5" rx="2" ry="2"/>', size, strokeWidth, className);
  },
  link(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>', size, strokeWidth, className);
  },
  building(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>', size, strokeWidth, className);
  },
  rocket(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>', size, strokeWidth, className);
  },
  flaskConical(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>', size, strokeWidth, className);
  },
  circleDot(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>', size, strokeWidth, className);
  },
  checkCheck(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>', size, strokeWidth, className);
  },
  bell(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', size, strokeWidth, className);
  },
  lock(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', size, strokeWidth, className);
  },
  upload(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>', size, strokeWidth, className);
  },
  github(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>', size, strokeWidth, className);
  },
  creditCard(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>', size, strokeWidth, className);
  },
  indianRupee(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M6 3h12"/><path d="M6 8h12"/><path d="m6 13 8.5 8"/><path d="M6 13h3a4 4 0 0 0 0-8"/>', size, strokeWidth, className);
  },
  package(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>', size, strokeWidth, className);
  },
  truck(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>', size, strokeWidth, className);
  },
  table(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>', size, strokeWidth, className);
  },
  smile(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" x2="9.01" y1="9" y2="9"/><line x1="15" x2="15.01" y1="9" y2="9"/>', size, strokeWidth, className);
  },
  megphone(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>', size, strokeWidth, className);
  },
  megaphone(size = 16, strokeWidth = 2, className = "") {
    return this.megphone(size, strokeWidth, className);
  },
  arrowUpRight(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>', size, strokeWidth, className);
  },
  rotateCcw(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>', size, strokeWidth, className);
  },
  circle(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<circle cx="12" cy="12" r="10"/>', size, strokeWidth, className);
  },
  star(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>', size, strokeWidth, className);
  },
  starFilled(size = 16, strokeWidth = 2, className = "") {
    const cls = className ? ` class="${className}"` : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="#f5b849" stroke="#f5b849" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${cls}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
  },
  inbox(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>', size, strokeWidth, className);
  },
  archive(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>', size, strokeWidth, className);
  },
  alertTriangle(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>', size, strokeWidth, className);
  },
  reply(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>', size, strokeWidth, className);
  },
  forward(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>', size, strokeWidth, className);
  },
  key(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>', size, strokeWidth, className);
  },
  lock(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', size, strokeWidth, className);
  },
  eye(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>', size, strokeWidth, className);
  },
  eyeOff(size = 16, strokeWidth = 2, className = "") {
    return _lucideSvg('<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>', size, strokeWidth, className);
  }
};

if (typeof window !== 'undefined') {
  window.Icons = Icons;
}


