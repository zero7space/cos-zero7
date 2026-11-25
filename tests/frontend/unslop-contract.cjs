const fs = require('node:fs');
const assert = require('node:assert/strict');

// Normalize CRLF to LF for consistent matching
const herouiCss = fs.readFileSync('static/css/heroui-components.css', 'utf8').replace(/\r\n/g, '\n');
assert(herouiCss.includes('.leads-table th { height: 36px; padding: 8px 12px; font-size: 12px; }'), 'Table th height and padding standardized to 36px and 8px 12px');
assert(herouiCss.includes('.leads-table td { height: 40px; padding: 8px 12px; line-height: 20px; font-size: 13px; vertical-align: middle; overflow: hidden; white-space: nowrap; }'), 'Table td height and padding standardized to 40px and 8px 12px');
assert(herouiCss.includes('.lead-popover-header {\n  padding: 4px 8px 6px; font-size: 12px; font-weight: 500; color: var(--color-mid-gray);\n  letter-spacing: 0; text-transform: none;\n}'), 'Lead popover header uses sentence case, letter-spacing 0, weight 500, size 12px');
assert(herouiCss.includes('.outcome-group-label { font-size: 12px; font-weight: 500; letter-spacing: 0; text-transform: none; color: var(--color-mid-gray); }'), 'Outcome group label uses sentence case, letter-spacing 0, weight 500, size 12px');

// 2. Check app.css
const appCss = fs.readFileSync('static/css/app.css', 'utf8').replace(/\r\n/g, '\n');
assert(appCss.includes('.capacity-progress-bar-fill {\n  height: 100%;\n  background: var(--color-primary, #007fff);'), 'Capacity progress bar fill uses solid brand/accent color instead of hue gradient');
assert(appCss.includes('.rank-badge {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 26px;\n  height: 26px;\n  border-radius: 6px;\n  font-size: 12px;\n  font-weight: 600;'), 'Rank badge weight reduced to 600');
assert(appCss.includes('.rank-badge.top10 {\n  background: #f59e0b;\n  color: #ffffff;\n}'), 'Rank badge top10 glow removed');
assert(!appCss.includes('box-shadow: 0 0 10px rgba(245, 158, 11, 0.4);'), 'No amber drop-shadow glow on top 10 badges');

// 3. Check app.js
const appJs = fs.readFileSync('static/js/app.js', 'utf8').replace(/\r\n/g, '\n');
assert(appJs.includes('${Icons.flame(13)} Top 10 Needle Movers (10)'), 'Flame icon in Schedule top 10 filter');
assert(appJs.includes('${Icons.zap(13)} Disproportionate (${plan.disproportionate_count})'), 'Zap icon in Schedule disproportionate filter');
assert(appJs.includes('${Icons.alertTriangle(13)} Necessity Commitments (${plan.necessity_count})'), 'AlertTriangle icon in Schedule necessity filter');
assert(appJs.includes('${Icons.rotateCcw(13)} Squeeze Queue (${plan.squeeze_count})'), 'RotateCcw icon in Schedule squeeze filter');
assert(appJs.includes('${Icons.alertTriangle(10)} Necessity'), 'AlertTriangle icon in action item necessity badge');
assert(appJs.includes('${Icons.rotateCcw(10)} Squeeze'), 'RotateCcw icon in action item squeeze badge');
assert(appJs.includes('${Icons.users(12)} ${it.employee_count}'), 'Users icon in action item employee badge');
assert(!appJs.includes('🔥 Top 10'), 'No fire emoji in Schedule filters');
assert(!appJs.includes('⚡ Disproportionate ('), 'No zap emoji in Schedule filters');
assert(!appJs.includes('⚠️ Necessity Commitments'), 'No warning emoji in Schedule filters');
assert(!appJs.includes('🔄 Squeeze Queue'), 'No rotate emoji in Schedule filters');
assert(!appJs.includes('⚠️ Necessity</span>'), 'No warning emoji in action badges');
assert(!appJs.includes('🔄 Squeeze</span>'), 'No rotate emoji in action badges');
assert(appJs.includes('font-variant-numeric: tabular-nums'), 'Tabular nums enforced on estimated deal value column');
assert(appJs.includes('text-transform: none; letter-spacing: 0; font-weight: 500; font-size: 12px;'), 'Schedule table thead row formatted in clean sentence case');

console.log('PASS: 9-pass unslop contract: spacing, color/chrome, icons, copy/casing, type');
