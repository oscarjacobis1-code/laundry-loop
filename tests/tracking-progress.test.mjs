import assert from 'node:assert/strict';
import test from 'node:test';

import { calculate, pickupEstimate } from '../public/tracking-progress.js';
const received = '2026-09-23T13:00:00.000Z';
const at = Date.parse(received);
const base = { created_at: received, status_changed_at: received, express: false };

test('time advances only inside a staff-confirmed stage', () => {
  assert.equal(calculate({ ...base, status: 'Received' }, at).progress, 0);
  const sixHours = calculate({ ...base, status: 'Received' }, at + 6 * 3600000);
  assert.ok(sixHours.progress > 0 && sixHours.progress < 35);
  assert.equal(sixHours.lastUpdated, at);
  assert.equal(calculate({ ...base, status: 'Received' }, at + 72 * 3600000).progress, 34);
  assert.equal(calculate({ ...base, status: 'Washing', status_changed_at: new Date(at + 6 * 3600000).toISOString() }, at + 6 * 3600000).progress, 35);
  assert.equal(calculate({ ...base, status: 'Drying' }, at + 72 * 3600000).progress, 99);
  assert.equal(calculate({ ...base, status: 'Ready for Pick-Up' }, at).progress, 100);
});

test('pickup estimate and staff timestamp do not move with display progress', () => {
  const first = calculate({ ...base, status: 'Washing', status_changed_at: '2026-09-23T19:00:00.000Z' }, at + 7 * 3600000);
  const later = calculate({ ...base, status: 'Washing', status_changed_at: '2026-09-23T19:00:00.000Z' }, at + 12 * 3600000);
  assert.ok(later.progress > first.progress);
  assert.equal(later.lastUpdated, first.lastUpdated);
  assert.equal(later.eta.getTime(), at + 48 * 3600000);
  assert.equal(calculate({ ...base, status: 'Cancelled/Refunded' }, at).progress, null);
});

test('Express cutoff follows the stated Guyana time policy', () => {
  assert.equal(pickupEstimate('2026-09-23T15:59:00Z', true).toISOString(), '2026-09-23T22:00:00.000Z');
  assert.equal(pickupEstimate('2026-09-23T16:00:00Z', true).toISOString(), '2026-09-24T14:00:00.000Z');
});
