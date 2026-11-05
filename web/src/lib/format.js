// Presentation formatting only — no business rules. Verification decisions
// always come from the backend; these helpers just render values legibly.

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatDateOnly(ymd) {
  if (!ymd) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function formatTime(hm) {
  if (!hm) return '—';
  const m = /^(\d{2}):(\d{2})$/.exec(hm);
  if (!m) return hm;
  const h = Number(m[1]);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

export function timeAgo(iso, nowMs = Date.now()) {
  if (!iso) return '—';
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  const diff = Math.max(0, nowMs - ms);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return formatDateTime(iso);
}

const STATUS_LABELS = {
  VERIFIED: 'Verified',
  REVIEW_REQUIRED: 'Review required',
  UNVERIFIABLE: 'Unverifiable',
};

const FIELD_STATE_LABELS = {
  MATCH: 'Match',
  MISMATCH: 'Mismatch',
  MISSING_IN_DRAFT: 'Missing in draft',
  MISSING_IN_SOURCE: 'Missing in source',
  UNVERIFIABLE: 'Unverifiable',
  NOT_APPLICABLE: 'Not applicable',
};

const FIELD_LABELS = {
  title: 'Event title',
  eventDate: 'Event date',
  startTime: 'Start time',
  endTime: 'End time',
  timeZone: 'Time zone',
  venue: 'Venue',
  registrationUrl: 'Registration URL',
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status || '—';
}

export function fieldStateLabel(state) {
  return FIELD_STATE_LABELS[state] || state || '—';
}

export function fieldLabel(field) {
  return FIELD_LABELS[field] || field;
}

export function displayValue(field, value) {
  if (value === null || value === undefined) return '—';
  if (field === 'eventDate') return formatDateOnly(value);
  if (field === 'startTime' || field === 'endTime') return formatTime(String(value));
  return String(value);
}
