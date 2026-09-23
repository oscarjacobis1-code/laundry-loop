import assert from 'node:assert/strict';
import test from 'node:test';

import { calculate, pickupEstimate, scheduledPercent } from '../public/tracking-progress.js';

const received = '2026-09-23T13:00:00.000Z';
const at = Date.parse(received);
const HOUR = 3600000;
const base = { created_at: received, status_changed_at: received, express: false };

test('regular progress is elapsed time divided by the 48-hour estimate', () => {
  const eta = pickupEstimate(received, false);
  assert.equal(eta.getTime(), at + 48 * HOUR);
  assert.equal(scheduledPercent(at, eta, at), 0);
  assert.equal(scheduledPercent(at, eta, at + 12 * HOUR), 25);
  assert.equal(scheduledPercent(at, eta, at + 24 * HOUR), 50);
  assert.equal(scheduledPercent(at, eta, at + 36 * HOUR), 75);
  assert.equal(scheduledPercent(at, eta, at + 48 * HOUR), 100);
});

test('time cannot cross a staff-confirmed stage boundary', () => {
  assert.equal(calculate({ ...base, status: 'Received' }, at).progress, 0);
  assert.equal(calculate({ ...base, status: 'Received' }, at + 8 * HOUR).displayStage, 'Processing');
  assert.equal(calculate({ ...base, status: 'Received' }, at + 30 * HOUR).progress, 34);

  const washing = calculate(
    { ...base, status: 'Washing', status_changed_at: new Date(at + 6 * HOUR).toISOString() },
    at + 24 * HOUR
  );
  assert.equal(washing.progress, 50);
  assert.equal(washing.displayStage, 'Washing');

  assert.equal(calculate({ ...base, status: 'Washing' }, at + 48 * HOUR).progress, 69);
  assert.equal(calculate({ ...base, status: 'Drying' }, at + 48 * HOUR).progress, 99);
  assert.equal(calculate({ ...base, status: 'Ready for Pick-Up' }, at + 3 * HOUR).progress, 100);
});

test('Processing is derived only inside the Received staff stage', () => {
  const early = calculate({ ...base, status: 'Received' }, at + 6 * HOUR);
  const processing = calculate({ ...base, status: 'Received' }, at + 8 * HOUR);
  assert.equal(early.progress, 12);
  assert.equal(early.displayStage, 'Received');
  assert.equal(processing.progress, 16);
  assert.equal(processing.displayStage, 'Processing');

  const confirmedWash = calculate({ ...base, status: 'Washing' }, at + 1 * HOUR);
  assert.equal(confirmedWash.progress, 35);
  assert.equal(confirmedWash.displayStage, 'Washing');
});

test('pickup estimate and staff timestamp stay independent of display progress', () => {
  const first = calculate({ ...base, status: 'Washing', status_changed_at: '2026-09-23T19:00:00.000Z' }, at + 18 * HOUR);
  const later = calculate({ ...base, status: 'Washing', status_changed_at: '2026-09-23T19:00:00.000Z' }, at + 24 * HOUR);
  assert.equal(first.progress, 37);
  assert.equal(later.progress, 50);
  assert.equal(later.lastUpdated, first.lastUpdated);
  assert.equal(later.eta.getTime(), at + 48 * HOUR);
  assert.equal(calculate({ ...base, status: 'Cancelled/Refunded' }, at).progress, null);
});

test('Express cutoff follows the approved Guyana policy', () => {
  assert.equal(pickupEstimate('2026-09-23T15:59:00Z', true).toISOString(), '2026-09-23T22:00:00.000Z');
  assert.equal(pickupEstimate('2026-09-23T16:00:00Z', true).toISOString(), '2026-09-24T14:00:00.000Z');
});
