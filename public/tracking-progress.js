// Customer-facing estimate math.
// Time may advance the estimate, but it can never cross a staff-confirmed stage boundary.
const HOUR = 3600000;
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
const stages = ['Received', 'Washing', 'Drying', 'Ready for Pick-Up'];
const visualStages = ['Received', 'Processing', 'Washing', 'Drying', 'Ready for Pick-Up'];
const zone = 'America/Guyana';

function pickupEstimate(createdAt, express) {
  const received = new Date(createdAt);
  if (!Number.isFinite(received.getTime())) return null;

  if (!express) return new Date(received.getTime() + 48 * HOUR);

  // Guyana is UTC-4 year-round.
  // Approved Express policy:
  // received before noon -> ready by 6 PM same day
  // received at/after noon -> ready by 10 AM next morning
  const local = new Date(received.getTime() - 4 * HOUR);
  const beforeNoon = local.getUTCHours() < 12;
  local.setUTCHours(beforeNoon ? 18 : 10, 0, 0, 0);
  if (!beforeNoon) local.setUTCDate(local.getUTCDate() + 1);
  return new Date(local.getTime() + 4 * HOUR);
}

function scheduledPercent(received, eta, now) {
  if (!Number.isFinite(received) || !eta || !Number.isFinite(eta.getTime()) || eta.getTime() <= received) return 0;
  const elapsed = Math.max(0, now - received);
  const duration = eta.getTime() - received;
  return Math.max(0, Math.min(100, Math.floor((elapsed / duration) * 100)));
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
  const eta = pickupEstimate(row.created_at, Boolean(row.express));

  if (status === 'Cancelled/Refunded') {
    return { status, displayStage: 'Cancelled/Refunded', progress: null, scheduledProgress: null, eta: null, lastUpdated: eventTime, zone };
  }

  if (status === 'Ready for Pick-Up' || status === 'Picked Up (Archived)') {
    return {
      status,
      displayStage: status === 'Picked Up (Archived)' ? 'Picked Up' : 'Ready for Pick-Up',
      progress: 100,
      scheduledProgress: 100,
      eta: status === 'Ready for Pick-Up' ? eta : null,
      lastUpdated: eventTime,
      zone
    };
  }

  const base = anchors[status];
  const ceiling = ceilings[status];
  if (base == null || ceiling == null) {
    return { status, displayStage: status, progress: null, scheduledProgress: null, eta, lastUpdated: eventTime, zone };
  }

  const schedule = scheduledPercent(received, eta, now);
  const progress = Math.max(base, Math.min(ceiling, schedule));

  return {
    status,
    displayStage: displayStage(progress, status),
    progress,
    scheduledProgress: schedule,
    eta,
    lastUpdated: eventTime,
    zone
  };
}

export { calculate, pickupEstimate, scheduledPercent, displayStage, anchors, ceilings, stages, visualStages, zone };
