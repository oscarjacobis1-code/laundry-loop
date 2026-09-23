import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculate,
  pickupEstimate,
  easeOutCirc,
  stageBudget,
  stageProgress
} from '../public/tracking-progress.js';

const received = '2026-09-23T13:00:00.000Z';
const at = Date.parse(received);
const MINUTE = 60000;
const HOUR = 3600000;
const base = { created_at: received, status_changed_at: received, express: false };

test('pickup ETA stays separate from gauge math', () => {
  const eta = pickupEstimate(received, false);
  assert.equal(eta.getTime(), at + 48 * HOUR);
  assert.equal(stageBudget('Received', false), 4 * HOUR);
  assert.equal(stageBudget('Washing', false), 2 * HOUR);
  assert.equal(stageBudget('Drying', false), 2 * HOUR);
});

test('circular ease-out moves quickly then slows toward the stage ceiling', () => {
  assert.equal(easeOutCirc(0), 0);
  assert.ok(easeOutCirc(0.25) > 0.65 && easeOutCirc(0.25) < 0.67);
  assert.ok(easeOutCirc(0.5) > 0.86 && easeOutCirc(0.5) < 0.87);
  assert.equal(easeOutCirc(1), 1);

  assert.equal(stageProgress('Received', at, at + 5 * MINUTE, false), 6);
  assert.equal(stageProgress('Received', at, at + 30 * MINUTE, false), 16);
  assert.equal(stageProgress('Received', at, at + 1 * HOUR, false), 22);
  assert.equal(stageProgress('Received', at, at + 2 * HOUR, false), 29);
  assert.equal(stageProgress('Received', at, at + 4 * HOUR, false), 34);
});

test('time never crosses the next staff-confirmed boundary', () => {
  assert.equal(calculate({ ...base, status: 'Received' }, at + 20 * HOUR).progress, 34);
  assert.equal(calculate({ ...base, status: 'Received' }, at + 20 * HOUR).displayStage, 'Processing');

  const washingChanged = at + 6 * HOUR;
  const washing = { ...base, status: 'Washing', status_changed_at: new Date(washingChanged).toISOString() };
  assert.equal(calculate(washing, washingChanged).progress, 35);
  assert.equal(calculate(washing, washingChanged + 30 * MINUTE).progress, 57);
  assert.equal(calculate(washing, washingChanged + 1 * HOUR).progress, 64);
  assert.equal(calculate(washing, washingChanged + 10 * HOUR).progress, 69);

  const dryingChanged = at + 9 * HOUR;
  const drying = { ...base, status: 'Drying', status_changed_at: new Date(dryingChanged).toISOString() };
  assert.equal(calculate(drying, dryingChanged).progress, 70);
  assert.equal(calculate(drying, dryingChanged + 30 * MINUTE).progress, 89);
  assert.equal(calculate(drying, dryingChanged + 10 * HOUR).progress, 99);

  assert.equal(calculate({ ...base, status: 'Ready for Pick-Up' }, at + 1 * HOUR).progress, 100);
});

test('Processing is a visual substage only while staff status remains Received', () => {
  const early = calculate({ ...base, status: 'Received' }, at + 10 * MINUTE);
  const processing = calculate({ ...base, status: 'Received' }, at + 30 * MINUTE);
  assert.equal(early.displayStage, 'Received');
  assert.equal(processing.displayStage, 'Processing');

  const confirmedWash = calculate(
    { ...base, status: 'Washing', status_changed_at: new Date(at + 30 * MINUTE).toISOString() },
    at + 30 * MINUTE
  );
  assert.equal(confirmedWash.progress, 35);
  assert.equal(confirmedWash.displayStage, 'Washing');
});

test('Express gauge uses faster stage budgets while ETA follows Express cutoff', () => {
  assert.equal(stageBudget('Received', true), 1 * HOUR);
  assert.equal(stageBudget('Washing', true), 1.5 * HOUR);
  assert.equal(stageBudget('Drying', true), 1.5 * HOUR);

  const express = { ...base, express: true, status: 'Received' };
  assert.equal(calculate(express, at + 15 * MINUTE).progress, 22);
  assert.equal(calculate(express, at + 30 * MINUTE).progress, 29);
  assert.equal(calculate(express, at + 1 * HOUR).progress, 34);

  assert.equal(pickupEstimate('2026-09-23T15:59:00Z', true).toISOString(), '2026-09-23T22:00:00.000Z');
  assert.equal(pickupEstimate('2026-09-23T16:00:00Z', true).toISOString(), '2026-09-24T14:00:00.000Z');
});

test('staff timestamp remains authoritative when time advances the visual gauge', () => {
  const changedAt = '2026-09-23T19:00:00.000Z';
  const first = calculate({ ...base, status: 'Washing', status_changed_at: changedAt }, Date.parse(changedAt) + 15 * MINUTE);
  const later = calculate({ ...base, status: 'Washing', status_changed_at: changedAt }, Date.parse(changedAt) + 60 * MINUTE);
  assert.ok(later.progress > first.progress);
  assert.equal(later.lastUpdated, first.lastUpdated);
  assert.equal(calculate({ ...base, status: 'Cancelled/Refunded' }, at).progress, null);
});
