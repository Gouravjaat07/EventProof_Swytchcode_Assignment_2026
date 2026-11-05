import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ClipboardCheck, RotateCcw } from 'lucide-react';
import { api } from '../../lib/api-client.js';
import { useApi } from '../../hooks/use-api.js';
import { useDemo, useToasts } from '../../app/providers.jsx';
import { DEMO_DRAFT, DEMO_EVENT, DEMO_RESULT } from '../../lib/demo.js';
import { Button, Card, DemoBanner, ErrorState, Field, PageHeader, Spinner, TextInput } from '../../components/ui.jsx';
import { EventDetail } from '../events/EventsPage.jsx';
import { ComparisonTable, CorrectionPanel, EvidencePanel, ResultSummary } from './ResultView.jsx';

const COMMON_ZONES = [
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'America/New_York', 'America/Chicago',
  'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'Africa/Cairo', 'Pacific/Auckland', 'UTC',
];

const EMPTY_DRAFT = Object.freeze({
  title: '', eventDate: '', startTime: '', endTime: '',
  timeZone: '', venue: '', registrationUrl: '', description: '',
});

// Early client-side validation for fast feedback. The backend re-validates
// everything and remains authoritative — these rules only mirror it.
export function validateDraftLocal(values) {
  const errors = {};
  if (!values.title.trim()) errors.title = 'Title is required.';
  else if (values.title.length > 300) errors.title = 'Title must be at most 300 characters.';
  if (!values.eventDate) errors.eventDate = 'Event date is required.';
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(values.eventDate)) errors.eventDate = 'Use YYYY-MM-DD.';
  else {
    const [y, m, d] = values.eventDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
      errors.eventDate = 'That date does not exist.';
    }
  }
  const timeRe = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  const time12Re = /^(0?\d|1[0-2]):([0-5]\d)\s*([APap])\.?\s*[Mm]\.?$/;
  const parseTime = (v) => {
    const t = v.trim();
    let m = timeRe.exec(t);
    if (m) return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
    m = time12Re.exec(t);
    if (!m) return null;
    let h = Number(m[1]);
    const pm = m[3].toUpperCase() === 'P';
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
    return `${String(h).padStart(2, '0')}:${m[2]}`;
  };
  let startNorm = null;
  let endNorm = null;
  if (values.startTime.trim()) {
    startNorm = parseTime(values.startTime);
    if (!startNorm) errors.startTime = 'Use HH:MM or h:MM AM/PM.';
  }
  if (values.endTime.trim()) {
    endNorm = parseTime(values.endTime);
    if (!endNorm) errors.endTime = 'Use HH:MM or h:MM AM/PM.';
  }
  if (startNorm && endNorm && startNorm === endNorm) {
    errors.endTime = 'End time must differ from start time.';
  }
  if (values.timeZone.trim()) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: values.timeZone.trim() });
    } catch {
      errors.timeZone = 'Must be a valid IANA name (e.g. Asia/Kolkata).';
    }
  }
  if (values.venue.length > 500) errors.venue = 'Venue must be at most 500 characters.';
  if (values.registrationUrl.trim()) {
    try {
      const u = new URL(values.registrationUrl.trim());
      if (u.protocol !== 'http:' && u.protocol !== 'https:') errors.registrationUrl = 'Must use http or https.';
      else if (!u.hostname) errors.registrationUrl = 'Must include a hostname.';
      else if (u.username || u.password) errors.registrationUrl = 'Must not embed credentials.';
      else if (values.registrationUrl.length > 2048) errors.registrationUrl = 'URL is too long.';
    } catch {
      errors.registrationUrl = 'Must be a valid URL.';
    }
  }
  if (values.description.length > 5000) errors.description = 'Description must be at most 5000 characters.';
  return errors;
}

export function VerifyPage() {
  const [params] = useSearchParams();
  const { demo } = useDemo();
  const { push } = useToasts();
  const [eventId, setEventId] = useState(params.get('eventId') || '');
  const [calendarId, setCalendarId] = useState('primary');
  const [draft, setDraft] = useState({ ...EMPTY_DRAFT });
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const fetchEvent = useCallback((id, opts) => api.getEvent(id, undefined, opts), []);
  const official = useApi(fetchEvent);
  const submitVerification = useCallback((payload, opts) => api.createVerification(payload, opts), []);
  const verification = useApi(submitVerification);

  // Deep-link (?eventId=) loads the official record on entry.
  useEffect(() => {
    const id = params.get('eventId');
    if (id && !demo) {
      setEventId(id);
      official.run(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Demo mode: canned official event, no network.
  useEffect(() => {
    if (demo) {
      official.reset();
      verification.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  const officialEvent = demo ? DEMO_EVENT : official.status === 'success' ? official.data.event : null;

  function setField(name, value) {
    setDraft((d) => ({ ...d, [name]: value }));
    setFieldErrors((e) => ({ ...e, [name]: undefined }));
  }

  async function loadOfficial(e) {
    e.preventDefault();
    if (demo || !eventId.trim()) return;
    verification.reset();
    await official.run(eventId.trim());
  }

  function buildPayload() {
    const announcement = {
      title: draft.title.trim(),
      eventDate: draft.eventDate,
    };
    for (const k of ['startTime', 'endTime', 'timeZone', 'venue', 'registrationUrl', 'description']) {
      if (draft[k].trim()) announcement[k] = draft[k].trim();
    }
    return { eventId: eventId.trim(), calendarId: calendarId.trim() || undefined, announcement };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return; // double-submission guard
    const errors = validateDraftLocal(draft);
    if (!eventId.trim()) errors.eventId = 'Load an official event first.';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      push('Fix the highlighted fields before submitting.', 'error');
      return;
    }
    if (demo) return; // demo uses the simulate button instead
    setSubmitting(true);
    try {
      const out = await verification.run(buildPayload());
      if (out && out.data) {
        push(`Verification complete: ${out.data.status.replace(/_/g, ' ').toLowerCase()}.`, out.data.status === 'VERIFIED' ? 'success' : 'info');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function applyCorrections(correctable) {
    setDraft((d) => {
      const next = { ...d };
      for (const f of correctable) {
        if (f.field === 'eventDate') next.eventDate = f.correction;
        else if (f.field === 'startTime') next.startTime = f.correction;
        else if (f.field === 'endTime') next.endTime = f.correction;
        else if (f.field === 'timeZone') next.timeZone = f.correction;
        else if (f.field === 'venue') next.venue = f.correction;
        else if (f.field === 'title') next.title = f.correction;
      }
      return next;
    });
    push('Official values applied to the draft. Review and resubmit to re-verify.', 'success');
  }

  const result = verification.status === 'success' ? verification.data : null;

  return (
    <div>
      <PageHeader
        title="Verification Workspace"
        subtitle="Compare an announcement draft against the authoritative record."
        actions={
          <Link to="/events" className="inline-flex items-center gap-1 text-sm font-medium text-teal-800 hover:underline">
            <ArrowLeft size={14} aria-hidden="true" /> Browse events
          </Link>
        }
      />
      {demo ? <DemoBanner /> : null}

      {/* STEP 1 — official event */}
      <Card className="p-4">
        <h2 className="text-base font-semibold text-slate-900">1 · Official event</h2>
        {demo ? (
          <p className="mt-1 text-sm text-slate-600">Demo mode uses a canned official record — no fetch is performed.</p>
        ) : (
          <form onSubmit={loadOfficial} className="mt-2 grid gap-3 sm:grid-cols-[1fr_12rem_auto]">
            <Field label="Official event ID" htmlFor="vf-event" error={fieldErrors.eventId} required>
              <TextInput id="vf-event" value={eventId} onChange={(e) => setEventId(e.target.value)} placeholder="Paste the source event ID" className="font-mono" invalid={!!fieldErrors.eventId} />
            </Field>
            <Field label="Calendar ID" htmlFor="vf-cal" hint="Usually primary">
              <TextInput id="vf-cal" value={calendarId} onChange={(e) => setCalendarId(e.target.value)} />
            </Field>
            <div className="flex items-end">
              <Button kind="secondary" type="submit" disabled={official.status === 'loading' || !eventId.trim()}>
                {official.status === 'loading' ? 'Loading…' : 'Load record'}
              </Button>
            </div>
          </form>
        )}
        {official.status === 'loading' && !demo ? <p className="mt-3"><Spinner label="Fetching official record…" /></p> : null}
        {official.status === 'error' && !demo ? (
          <div className="mt-3">
            <ErrorState
              error={official.error}
              requestId={official.requestId}
              onRetry={() => official.run(eventId.trim())}
              title={official.error?.code === 'EVENT_NOT_FOUND' ? 'Official event not found' : 'Could not load the official record'}
            />
          </div>
        ) : null}
        {officialEvent ? (
          <div className="mt-3 rounded-md border border-slate-200 p-4">
            {officialEvent.status === 'cancelled' ? (
              <p role="alert" className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
                This official event is cancelled. Verification will refuse it.
              </p>
            ) : null}
            <EventDetail event={officialEvent} />
          </div>
        ) : null}
      </Card>

      {/* STEP 2 — draft form */}
      <Card className="mt-4 p-4">
        <h2 className="text-base font-semibold text-slate-900">2 · Announcement draft</h2>
        <p className="mb-3 mt-1 text-sm text-slate-600">Exactly what you plan to publish. The backend validates and compares it.</p>
        <form onSubmit={handleSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Event title" htmlFor="vf-title" error={fieldErrors.title} required>
              <TextInput id="vf-title" value={draft.title} onChange={(e) => setField('title', e.target.value)} maxLength={320} invalid={!!fieldErrors.title} />
            </Field>
          </div>
          <Field label="Event date" htmlFor="vf-date" error={fieldErrors.eventDate} required>
            <TextInput id="vf-date" type="date" value={draft.eventDate} onChange={(e) => setField('eventDate', e.target.value)} invalid={!!fieldErrors.eventDate} />
          </Field>
          <Field label="Time zone" htmlFor="vf-tz" error={fieldErrors.timeZone} hint="IANA name, e.g. Asia/Kolkata">
            <TextInput id="vf-tz" value={draft.timeZone} onChange={(e) => setField('timeZone', e.target.value)} list="tz-suggestions" placeholder="Asia/Kolkata" invalid={!!fieldErrors.timeZone} />
            <datalist id="tz-suggestions">
              {COMMON_ZONES.map((z) => <option key={z} value={z} />)}
            </datalist>
          </Field>
          <Field label="Start time" htmlFor="vf-start" error={fieldErrors.startTime} hint="HH:MM or h:MM AM/PM">
            <TextInput id="vf-start" value={draft.startTime} onChange={(e) => setField('startTime', e.target.value)} placeholder="10:00" invalid={!!fieldErrors.startTime} />
          </Field>
          <Field label="End time" htmlFor="vf-end" error={fieldErrors.endTime} hint="Overnight allowed; must differ from start">
            <TextInput id="vf-end" value={draft.endTime} onChange={(e) => setField('endTime', e.target.value)} placeholder="18:00" invalid={!!fieldErrors.endTime} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Venue" htmlFor="vf-venue" error={fieldErrors.venue}>
              <TextInput id="vf-venue" value={draft.venue} onChange={(e) => setField('venue', e.target.value)} maxLength={520} invalid={!!fieldErrors.venue} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Registration URL" htmlFor="vf-url" error={fieldErrors.registrationUrl} hint="Validated only — never fetched or opened automatically">
              <TextInput id="vf-url" type="url" value={draft.registrationUrl} onChange={(e) => setField('registrationUrl', e.target.value)} placeholder="https://…" invalid={!!fieldErrors.registrationUrl} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Description" htmlFor="vf-desc" error={fieldErrors.description} hint="Accepted for context; not compared (no authoritative counterpart)">
              <textarea
                id="vf-desc"
                value={draft.description}
                onChange={(e) => setField('description', e.target.value)}
                rows={3}
                maxLength={5020}
                className={`w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 ${fieldErrors.description ? 'border-red-500' : 'border-slate-300'}`}
              />
            </Field>
          </div>
          {!demo ? (
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <Button kind="primary" type="submit" disabled={submitting || !officialEvent}>
                <ClipboardCheck size={16} aria-hidden="true" />
                {submitting ? 'Verifying…' : 'Verify announcement'}
              </Button>
              <Button
                kind="ghost"
                type="button"
                disabled={submitting}
                onClick={() => {
                  if (Object.values(draft).some((v) => v) && !window.confirm('Clear the draft? This cannot be undone.')) return;
                  setDraft({ ...EMPTY_DRAFT });
                  setFieldErrors({});
                  verification.reset();
                }}
              >
                <RotateCcw size={15} aria-hidden="true" />
                Reset draft
              </Button>
            </div>
          ) : null}
        </form>
        {demo ? <DemoVerifyBlock /> : null}
        {verification.status === 'error' && !demo ? (
          <div className="mt-4">
            <ErrorState
              error={verification.error}
              requestId={verification.requestId}
              onRetry={handleSubmit}
              title={verification.error?.code === 'EVENT_CANCELLED' ? 'Official event is cancelled' : 'Verification failed'}
            />
            <p className="mt-2 text-sm text-slate-600">Your draft above is preserved — fix the issue and resubmit.</p>
          </div>
        ) : null}
      </Card>

      {/* STEP 3 — result */}
      {result && !demo ? (
        <div className="mt-4 space-y-4">
          <ResultSummary result={result} />
          <ComparisonTable fieldResults={result.fieldResults} />
          <div className="grid gap-4 lg:grid-cols-2">
            <CorrectionPanel result={result} onApply={applyCorrections} />
            <EvidencePanel result={result} requestId={verification.requestId} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DemoVerifyBlock() {
  const [shown, setShown] = useState(false);
  return (
    <div className="mt-3">
      <Button kind="primary" type="button" onClick={() => setShown(true)}>
        <ClipboardCheck size={16} aria-hidden="true" />
        Run demo verification
      </Button>
      <p className="mt-1 text-xs text-slate-500">
        Renders a canned result locally — nothing is sent anywhere.
      </p>
      {shown ? (
        <div className="mt-4 space-y-4">
          <ResultSummary result={DEMO_RESULT} />
          <ComparisonTable fieldResults={DEMO_RESULT.fieldResults} />
          <div className="grid gap-4 lg:grid-cols-2">
            <CorrectionPanel result={DEMO_RESULT} onApply={null} />
            <EvidencePanel result={DEMO_RESULT} requestId={null} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
