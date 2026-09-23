// Customer-facing tracking math.
//
// Pickup ETA and gauge progress are intentionally separate:
// - ETA reflects the service promise (48h regular / Express policy).
// - Gauge progress uses a circular ease-out curve inside the last staff-confirmed stage.
// Time may NEVER move the gauge across a staff-confirmed stage boundary.
const MINUTE = 60000;
const HOUR = 60 * MINUTE;

const anchors = {
  'Received': 0,
  'Washing': 35,
  'Drying': 70,
  'Ready for Pick-Up': 100,
  'Picked Up (Archived)': 100
};

const ceilings = {
  'Received': 34,
  'Washing': 69,
  'Drying': 99
};

const regularStageBudgets = {
  'Received': 4 * HOUR,
  'Washing': 2 * HOUR,
  'Drying': 2 * HOUR
};

const expressStageBudgets = {
  'Received': 1 * HOUR,
  'Washing': 1.5 * HOUR,
  'Drying': 1.5 * HOUR
};

const stages = ['Received', 'Washing', 'Drying', 'Ready for Pick-Up'];
const visualStages = ['Received', 'Processing', 'Washing', 'Drying', 'Ready for Pick-Up'];
const zone = 'America/Guyana';

function pickupEstimate(createdAt, express) {
  const received = new Date(createdAt);
  if (!Number.isFinite(received.getTime())) return null;

  if (!express) return new Date(received.getTime() + 48 * HOUR);

  // Guyana is UTC-4 year-round.
  // Approved Express policy:
  // before noon -> ready by 6 PM same day
  // at/after noon -> ready by 10 AM next morning
  const local = new Date(received.getTime() - 4 * HOUR);
  const beforeNoon = local.getUTCHours() < 12;
  local.setUTCHours(beforeNoon ? 18 : 10, 0, 0, 0);
  if (!beforeNoon) local.setUTCDate(local.getUTCDate() + 1);
  return new Date(local.getTime() + 4 * HOUR);
}

function easeOutCirc(t) {
  const clamped = Math.max(0, Math.min(1, Number(t) || 0));
  return Math.sqrt(1 - Math.pow(clamped - 1, 2));
}

function stageBudget(status, express) {
  const table = express ? expressStageBudgets : regularStageBudgets;
  return table[status] ?? HOUR;
}

function stageProgress(status, eventTime, now, express) {
  const base = anchors[status];
  const ceiling = ceilings[status];
  if (base == null || ceiling == null) return null;

  const elapsed = Math.max(0, now - eventTime);
  const budget = stageBudget(status, express);
  const t = Math.min(1, elapsed / budget);
  const eased = easeOutCirc(t);
  const progress = base + Math.floor((ceiling - base) * eased);

  return Math.max(base, Math.min(ceiling, progress));
}

function displayStage(progress, confirmedStatus) {
  if (confirmedStatus === 'Cancelled/Refunded') return 'Cancelled/Refunded';
  if (confirmedStatus === 'Picked Up (Archived)') return 'Picked Up';
  if (progress == null) return confirmedStatus || 'Received';
  if (progress >= 100) return 'Ready for Pick-Up';
  if (progress >= 70) return 'Drying';
  if (progress >= 35) return 'Washing';
  if (progress >= 15) return 'Processing';
  return 'Received';
}

function calculate(row, now = Date.now()) {
  const status = row.status;
  const received = Date.parse(row.created_at);
  const changed = Date.parse(row.status_changed_at);
  const eventTime = Number.isFinite(changed) && changed >= received && changed <= now ? changed : received;
  const express = Boolean(row.express);
  const eta = pickupEstimate(row.created_at, express);

  if (status === 'Cancelled/Refunded') {
    return {
      status,
      displayStage: 'Cancelled/Refunded',
      progress: null,
      eta: null,
      lastUpdated: eventTime,
      zone,
      stageBudgetMs: null
    };
  }

  if (status === 'Ready for Pick-Up' || status === 'Picked Up (Archived)') {
    return {
      status,
      displayStage: status === 'Picked Up (Archived)' ? 'Picked Up' : 'Ready for Pick-Up',
      progress: 100,
      eta: status === 'Ready for Pick-Up' ? eta : null,
      lastUpdated: eventTime,
      zone,
      stageBudgetMs: 0
    };
  }

  const progress = stageProgress(status, eventTime, now, express);
  if (progress == null) {
    return {
      status,
      displayStage: status,
      progress: null,
      eta,
      lastUpdated: eventTime,
      zone,
      stageBudgetMs: null
    };
  }

  return {
    status,
    displayStage: displayStage(progress, status),
    progress,
    eta,
    lastUpdated: eventTime,
    zone,
    stageBudgetMs: stageBudget(status, express)
  };
}

export {
  calculate,
  pickupEstimate,
  easeOutCirc,
  stageBudget,
  stageProgress,
  displayStage,
  anchors,
  ceilings,
  regularStageBudgets,
  expressStageBudgets,
  stages,
  visualStages,
  zone
};
