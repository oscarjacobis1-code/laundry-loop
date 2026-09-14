import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

function write(path, content) {
  fs.writeFileSync(path, content.endsWith('\n') ? content : `${content}\n`);
}

function removeBalancedIfFalseBlocks(source) {
  const marker = 'if (false) {';
  let cursor = 0;
  let output = '';

  function findBlockEnd(start) {
    let depth = 0;
    let state = 'code';
    let quote = '';
    for (let i = start; i < source.length; i += 1) {
      const ch = source[i];
      const next = source[i + 1];

      if (state === 'line-comment') {
        if (ch === '\n') state = 'code';
        continue;
      }
      if (state === 'block-comment') {
        if (ch === '*' && next === '/') { state = 'code'; i += 1; }
        continue;
      }
      if (state === 'string') {
        if (ch === '\\') { i += 1; continue; }
        if (ch === quote) state = 'code';
        continue;
      }
      if (state === 'template') {
        if (ch === '\\') { i += 1; continue; }
        if (ch === '`') state = 'code';
        continue;
      }

      if (ch === '/' && next === '/') { state = 'line-comment'; i += 1; continue; }
      if (ch === '/' && next === '*') { state = 'block-comment'; i += 1; continue; }
      if (ch === '"' || ch === "'") { state = 'string'; quote = ch; continue; }
      if (ch === '`') { state = 'template'; continue; }
      if (ch === '{') depth += 1;
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
    }
    throw new Error('Could not find end of legacy if(false) block');
  }

  while (true) {
    const index = source.indexOf(marker, cursor);
    if (index < 0) {
      output += source.slice(cursor);
      break;
    }
    output += source.slice(cursor, index);
    const end = findBlockEnd(index + marker.length - 1);
    output += '\n';
    cursor = end;
  }
  return output;
}

function removeConstArray(source, name) {
  const start = source.indexOf(`  const ${name} = [`);
  if (start < 0) return source;
  const end = source.indexOf('  ];', start);
  if (end < 0) throw new Error(`Could not remove ${name}`);
  return source.slice(0, start) + source.slice(end + 5);
}

function removeDivById(html, id) {
  const idToken = `id=\"${id}\"`;
  const idIndex = html.indexOf(idToken);
  if (idIndex < 0) return html;
  const start = html.lastIndexOf('<div', idIndex);
  if (start < 0) throw new Error(`Could not find opening div for ${id}`);
  const token = /<div\b[^>]*>|<\/div\s*>/gi;
  token.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = token.exec(html))) {
    if (match[0].toLowerCase().startsWith('<div')) depth += 1;
    else depth -= 1;
    if (depth === 0) return html.slice(0, start) + html.slice(token.lastIndex);
  }
  throw new Error(`Could not find closing div for ${id}`);
}

// 1. Materialize the already-approved cash tender/change feature into Portal.tsx.
execFileSync(process.execPath, ['scripts/apply-pos-cash-tender.mjs'], { stdio: 'inherit' });

// 2. Remove the temporary build-time source rewriting hook. Builds must use committed source only.
const packagePath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
delete pkg.scripts['prepare:pos'];
pkg.scripts.dev = 'next dev';
pkg.scripts.build = 'npm run build:public-css && next build';
pkg.scripts.test = 'node --test tests/functional-wiring.test.mjs tests/portal-parity.test.mjs tests/printing-bridge.test.mjs';
write(packagePath, JSON.stringify(pkg, null, 2));

// 3. Remove development-only metadata from the production root layout.
const layoutPath = 'app/layout.tsx';
let layout = fs.readFileSync(layoutPath, 'utf8');
layout = layout.replace(/\n  other: \{\n    \"codex-preview\": \"development\",\n  \},/, '');
write(layoutPath, layout);

// 4. Remove dead preview/demo and disabled legacy staff-dashboard code from the public runtime.
const productionPath = 'public/laundry-loop.production.js';
let production = fs.readFileSync(productionPath, 'utf8');
production = removeBalancedIfFalseBlocks(production);
production = production
  .replace("  const PREVIEW_DEMO = location.hostname === 'terminal.local';\n", '')
  .replace("  const PREVIEW_STAFF_EMAIL = 'staff@laundryloop.preview';\n", '')
  .replace("  const PREVIEW_STAFF_PASSWORD = 'Preview2026!';\n", '');
production = removeConstArray(production, 'DEMO_INVENTORY');
for (const forbidden of ['PREVIEW_DEMO', 'PREVIEW_STAFF_EMAIL', 'PREVIEW_STAFF_PASSWORD', 'DEMO_INVENTORY', 'Preview2026!', 'staff@laundryloop.preview', 'if (false) {']) {
  if (production.includes(forbidden)) throw new Error(`Legacy public runtime marker remains: ${forbidden}`);
}
write(productionPath, production);

// 5. Remove the obsolete static staff/admin dashboard from the public homepage.
const indexPath = 'public/index.html';
let index = fs.readFileSync(indexPath, 'utf8');
for (const id of ['view-staff', 'staff-login-modal', 'staff-recovery-modal', 'staff-new-password-modal', 'pos-modal', 'discount-modal', 'inventory-modal']) {
  index = removeDivById(index, id);
}
index = index
  .replace(/\n  body\.admin-portal header,\n  body\.admin-portal footer \{ display: none !important; \}\n  body\.admin-portal main \{ min-height: 100vh; \}\n  body\.admin-portal #view-staff \{ padding-top: 48px; padding-bottom: 48px; \}/, '')
  .replace(/\n  \.staff-action-btn \{\n    width: 112px;\n    min-height: 40px;\n    padding: 9px 12px;\n    font-size: 11px;\n  \}/, '');
for (const forbidden of ['id="view-staff"', 'id="staff-login-modal"', 'Preview2026!', 'staff@laundryloop.preview']) {
  if (index.includes(forbidden)) throw new Error(`Legacy homepage marker remains: ${forbidden}`);
}
write(indexPath, index);

console.log('Launch hardening source cleanup applied.');
