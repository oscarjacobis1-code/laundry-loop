// Customer-facing estimates. Staff-confirmed statuses are the only milestone anchors.
  const HOUR = 3600000;
  const anchors = { 'Received': 0, 'Washing': 35, 'Drying': 70, 'Ready for Pick-Up': 100, 'Picked Up (Archived)': 100 };
  const stages = ['Received', 'Washing', 'Drying', 'Ready for Pick-Up'];
  const zone = 'America/Guyana';

  function pickupEstimate(createdAt, express) {
    const received = new Date(createdAt);
    if (!Number.isFinite(received.getTime())) return null;
    if (!express) return new Date(received.getTime() + 48 * HOUR);
    // Guyana is UTC-4 year round. The existing Express policy uses noon as its cutoff.
    const local = new Date(received.getTime() - 4 * HOUR);
    const beforeNoon = local.getUTCHours() < 12;
    local.setUTCHours(beforeNoon ? 18 : 10, 0, 0, 0);
    if (!beforeNoon) local.setUTCDate(local.getUTCDate() + 1);
    return new Date(local.getTime() + 4 * HOUR);
  }

  function calculate(row, now = Date.now()) {
    const status = row.status;
    const received = Date.parse(row.created_at);
    const changed = Date.parse(row.status_changed_at);
    const eventTime = Number.isFinite(changed) && changed >= received && changed <= now
      ? changed : received;
    const eta = pickupEstimate(row.created_at, row.express);
    const index = stages.indexOf(status);
    if (status === 'Cancelled/Refunded') return { status, progress: null, eta: null, lastUpdated: eventTime, zone };
    if (index === -1) return { status, progress: anchors[status] ?? null, eta: null, lastUpdated: eventTime, zone };
    if (index === stages.length - 1) return { status, progress: 100, eta: null, lastUpdated: eventTime, zone };
    const base = anchors[status];
    const ceiling = anchors[stages[index + 1]] - 1;
    // Divide the time remaining at a confirmed stage among its remaining stages.
    // The curve slows near the next anchor; time alone never confirms a new stage.
    const remainingStages = stages.length - 1 - index;
    const budget = Math.max(HOUR, ((eta?.getTime() ?? received + 48 * HOUR) - eventTime) / remainingStages);
    const elapsed = Math.max(0, now - eventTime);
    const fraction = 1 - Math.exp(-elapsed / (budget / 2.5));
    const progress = Math.min(ceiling, base + Math.floor((ceiling - base + 1) * fraction));
    return { status, progress, eta, lastUpdated: eventTime, zone };
  }

export { calculate, pickupEstimate, anchors, stages, zone };
