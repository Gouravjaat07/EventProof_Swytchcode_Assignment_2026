import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarDays, MapPin, RefreshCw, Search } from 'lucide-react';
import { api } from '../../lib/api-client.js';
import { useApi } from '../../hooks/use-api.js';
import { useDemo } from '../../app/providers.jsx';
import { DEMO_EVENT } from '../../lib/demo.js';
import { Button, Card, DemoBanner, EmptyState, ErrorState, Field, PageHeader, Skeleton, Spinner, TextInput } from '../../components/ui.jsx';
import { displayValue, formatDateTime, formatTime } from '../../lib/format.js';

function EventCard({ event, selected, onSelect }) {
  return (
    <li className={`rounded-lg border bg-white p-4 shadow-sm ${selected ? 'border-teal-600' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="ep-break text-base font-semibold text-slate-900">{event.title || '(untitled event)'}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={14} aria-hidden="true" />
              {displayValue('eventDate', event.startDate)}
              {event.startTime ? ` · ${formatTime(event.startTime)}${event.endTime ? `–${formatTime(event.endTime)}` : ''}` : ' · all-day'}
            </span>
            {event.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin size={14} aria-hidden="true" />
                <span className="ep-break">{event.location}</span>
              </span>
            ) : (
              <span className="italic">venue not provided by source</span>
            )}
          </p>
          <p className="mt-1 font-mono text-xs text-slate-500 ep-break">{event.sourceEventId}</p>
        </div>
        <Button kind={selected ? 'primary' : 'secondary'} onClick={() => onSelect(event)}>
          {selected ? 'Selected' : 'Select'}
        </Button>
      </div>
    </li>
  );
}

export function EventDetail({ event }) {
  const rows = [
    ['Event title', event.title || '—'],
    ['Date', displayValue('eventDate', event.startDate)],
    ['Start time', event.startTime ? formatTime(event.startTime) : event.allDay ? 'All-day event' : '—'],
    ['End time', event.endTime ? formatTime(event.endTime) : '—'],
    ['Time zone', event.timeZone || '—'],
    ['Venue', event.location || '—'],
    ['Source', event.source || '—'],
    ['Source event ID', event.sourceEventId || '—'],
    ['Status', event.status || '—'],
    ['Source updated', event.sourceUpdatedAt ? formatDateTime(event.sourceUpdatedAt) : '—'],
    ['Retrieved', formatDateTime(event.fetchedAt)],
  ];
  return (
    <dl className="divide-y divide-slate-100">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-3 gap-2 py-2 text-sm">
          <dt className="text-slate-500">{label}</dt>
          <dd className="ep-break col-span-2 font-medium text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EventsPage() {
  const { demo } = useDemo();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [eventId, setEventId] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [accumulated, setAccumulated] = useState([]);
  const [nextToken, setNextToken] = useState(null);
  const [searched, setSearched] = useState(false);

  const fetchList = useCallback((params, opts) => api.listEvents(params, opts), []);
  const list = useApi(fetchList);
  const fetchOne = useCallback((id, opts) => api.getEvent(id, undefined, opts), []);
  const single = useApi(fetchOne);

  function toInstant(dateStr, endOfDay) {
    if (!dateStr) return undefined;
    return endOfDay ? `${dateStr}T23:59:59Z` : `${dateStr}T00:00:00Z`;
  }

  async function runSearch(more = false) {
    if (demo) return;
    const params = {
      query: query.trim() || undefined,
      timeMin: toInstant(from, false),
      timeMax: toInstant(to, true),
      limit: 20,
      pageToken: more ? nextToken || undefined : undefined,
    };
    setSearched(true);
    const out = await list.run(params);
    if (out && out.data) {
      setAccumulated((prev) => (more ? [...prev, ...out.data.events] : out.data.events));
      setNextToken(out.data.nextPageToken || null);
    } else if (!more) {
      setAccumulated([]);
      setNextToken(null);
    }
  }

  async function runLookup(e) {
    e.preventDefault();
    if (demo || !eventId.trim()) return;
    const out = await single.run(eventId.trim());
    if (out && out.data) {
      setSelectedId(out.data.event.sourceEventId);
    }
  }

  function select(event) {
    setSelectedId(event.sourceEventId);
    navigate(`/verify?eventId=${encodeURIComponent(event.sourceEventId)}`);
  }

  const shownEvents = demo ? [DEMO_EVENT] : accumulated;
  const singleEvent = single.status === 'success' ? single.data.event : null;

  return (
    <div>
      <PageHeader
        title="Official Events"
        subtitle="Authoritative records from the connected calendar. Select one to verify against."
      />
      {demo ? <DemoBanner /> : null}

      <Card className="p-4">
        <form
          onSubmit={(e) => { e.preventDefault(); runSearch(false); }}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_10rem_auto]"
        >
          <Field label="Search" htmlFor="ev-q" hint="Free-text search across the calendar">
            <TextInput id="ev-q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. hackathon" disabled={demo} />
          </Field>
          <Field label="From" htmlFor="ev-from">
            <TextInput id="ev-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} max={to || undefined} disabled={demo} />
          </Field>
          <Field label="To" htmlFor="ev-to">
            <TextInput id="ev-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} min={from || undefined} disabled={demo} />
          </Field>
          <div className="flex items-end gap-2">
            <Button kind="primary" type="submit" disabled={demo || list.status === 'loading'}>
              <Search size={15} aria-hidden="true" />
              {list.status === 'loading' ? 'Searching…' : 'Search'}
            </Button>
            <Button kind="secondary" type="button" onClick={() => runSearch(false)} disabled={demo || list.status === 'loading'} aria-label="Refresh results">
              <RefreshCw size={15} aria-hidden="true" />
            </Button>
          </div>
        </form>
      </Card>

      <div className="mt-4">
        {list.status === 'loading' && accumulated.length === 0 && !demo ? (
          <div className="space-y-2"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
        ) : list.status === 'error' ? (
          <ErrorState error={list.error} requestId={list.requestId} onRetry={() => runSearch(false)} title="Event search failed" />
        ) : !searched && !demo ? (
          <EmptyState
            icon={Search}
            title="Search the official calendar"
            body="Enter a query or date range and press Search. Results come from the live provider — nothing is listed from memory."
          />
        ) : shownEvents.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="No events found"
            body="The provider returned no events for this search. Widen the date range or check the calendar connection."
          />
        ) : (
          <>
            <ul className="space-y-3">
              {shownEvents.map((event) => (
                <EventCard key={event.sourceEventId} event={event} selected={event.sourceEventId === selectedId} onSelect={select} />
              ))}
            </ul>
            {!demo && nextToken ? (
              <div className="mt-3 text-center">
                <Button kind="secondary" onClick={() => runSearch(true)} disabled={list.status === 'loading'}>
                  {list.status === 'loading' ? <Spinner label="Loading more…" /> : 'Show more'}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <Card className="mt-6 p-4">
        <h2 className="text-base font-semibold text-slate-900">Look up by event ID</h2>
        <p className="mb-3 mt-1 text-sm text-slate-600">
          Know the exact source identifier? Fetch that record directly — this is the same operation verification uses.
        </p>
        <form onSubmit={runLookup} className="flex flex-col gap-2 sm:flex-row">
          <TextInput
            aria-label="Official event ID"
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            placeholder="Paste the source event ID"
            className="font-mono"
            disabled={demo}
          />
          <Button kind="secondary" type="submit" disabled={demo || single.status === 'loading' || !eventId.trim()} className="shrink-0 whitespace-nowrap">
            {single.status === 'loading' ? 'Fetching…' : 'Fetch record'}
          </Button>
        </form>
        {single.status === 'error' ? (
          <div className="mt-3">
            <ErrorState
              error={single.error}
              requestId={single.requestId}
              onRetry={() => single.run(eventId.trim())}
              title={single.error?.code === 'EVENT_NOT_FOUND' ? 'Event not found' : 'Lookup failed'}
            />
          </div>
        ) : null}
        {singleEvent ? (
          <div className="mt-4 rounded-md border border-slate-200 p-4">
            {singleEvent.status === 'cancelled' ? (
              <p role="alert" className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
                This official event is cancelled. Verification will refuse it.
              </p>
            ) : null}
            <EventDetail event={singleEvent} />
            <div className="mt-3">
              <Link to={`/verify?eventId=${encodeURIComponent(singleEvent.sourceEventId)}`}>
                <Button kind="primary">Verify against this event</Button>
              </Link>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
