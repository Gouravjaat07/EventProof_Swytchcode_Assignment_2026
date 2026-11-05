import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, History as HistoryIcon, Search } from 'lucide-react';
import { api } from '../../lib/api-client.js';
import { useApi } from '../../hooks/use-api.js';
import { useDemo } from '../../app/providers.jsx';
import { Button, Card, DemoBanner, EmptyState, ErrorState, Field, PageHeader, Select, Skeleton, TextInput } from '../../components/ui.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { formatDateTime, timeAgo } from '../../lib/format.js';
import { recordTitle } from '../dashboard/DashboardPage.jsx';

const PAGE_SIZE = 10;

export function HistoryPage() {
  const { demo } = useDemo();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const fetchHistory = useCallback((params, opts) => api.listVerifications(params, opts), []);
  const history = useApi(fetchHistory);

  function load(nextPage = 1) {
    if (demo) return;
    setPage(nextPage);
    history.run({
      status: status || undefined,
      q: q.trim() || undefined,
      from: from ? `${from}T00:00:00Z` : undefined,
      to: to ? `${to}T23:59:59Z` : undefined,
      page: nextPage,
      pageSize: PAGE_SIZE,
    });
  }

  useEffect(() => {
    if (!demo) load(1);
    else history.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  const data = history.status === 'success' ? history.data : null;
  const totalPages = data ? Math.max(1, data.totalPages) : 1;

  return (
    <div>
      <PageHeader title="Verification History" subtitle="Durable audit trail — every record survives restarts." />
      {demo ? <DemoBanner /> : null}

      <Card className="p-4">
        <form
          onSubmit={(e) => { e.preventDefault(); load(1); }}
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[10rem_1fr_9rem_9rem_auto]"
        >
          <Field label="Status" htmlFor="h-status">
            <Select id="h-status" value={status} onChange={(e) => setStatus(e.target.value)} disabled={demo}>
              <option value="">All statuses</option>
              <option value="VERIFIED">Verified</option>
              <option value="REVIEW_REQUIRED">Review required</option>
              <option value="UNVERIFIABLE">Unverifiable</option>
            </Select>
          </Field>
          <Field label="Search" htmlFor="h-q" hint="Event name, verification or event ID">
            <TextInput id="h-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search history…" disabled={demo} />
          </Field>
          <Field label="From" htmlFor="h-from">
            <TextInput id="h-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} max={to || undefined} disabled={demo} />
          </Field>
          <Field label="To" htmlFor="h-to">
            <TextInput id="h-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} min={from || undefined} disabled={demo} />
          </Field>
          <div className="flex items-end">
            <Button kind="primary" type="submit" disabled={demo || history.status === 'loading'}>
              <Search size={15} aria-hidden="true" /> Filter
            </Button>
          </div>
        </form>
      </Card>

      <div className="mt-4">
        {demo ? (
          <EmptyState
            icon={HistoryIcon}
            title="Demo mode hides real history"
            body="Turn demo mode off in Settings to browse genuine audit records."
          />
        ) : history.status === 'loading' && !data ? (
          <div className="space-y-2"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
        ) : history.status === 'error' ? (
          <ErrorState error={history.error} requestId={history.requestId} onRetry={() => load(page)} title="History unavailable" />
        ) : !data || data.total === 0 ? (
          <EmptyState
            icon={HistoryIcon}
            title="No verification records"
            body="Nothing matches these filters yet. Verifications you run are recorded here permanently."
            action={<Link to="/verify"><Button kind="primary">Run a verification</Button></Link>}
          />
        ) : (
          <>
            <Card className="overflow-hidden">
              <ul className="divide-y divide-slate-100">
                {data.records.map((r) => (
                  <li key={r.verificationId}>
                    <Link to={`/history/${r.verificationId}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-slate-50">
                      <span className="min-w-0 flex-1">
                        <span className="ep-break block truncate text-sm font-medium text-slate-900">{recordTitle(r)}</span>
                        <span className="block font-mono text-xs text-slate-500" title={formatDateTime(r.verifiedAt)}>
                          {timeAgo(r.verifiedAt)} · {r.summary?.matchingFields ?? 0} matched · {r.summary?.mismatchingFields ?? 0} mismatched
                        </span>
                      </span>
                      <StatusBadge status={r.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
            <nav aria-label="History pages" className="mt-3 flex items-center justify-between">
              <p className="tnum text-sm text-slate-600">
                Page {data.page} of {totalPages} · {data.total} record{data.total === 1 ? '' : 's'}
              </p>
              <div className="flex gap-2">
                <Button kind="secondary" disabled={data.page <= 1 || history.status === 'loading'} onClick={() => load(data.page - 1)} aria-label="Previous page">
                  <ChevronLeft size={16} aria-hidden="true" /> Prev
                </Button>
                <Button kind="secondary" disabled={data.page >= totalPages || history.status === 'loading'} onClick={() => load(data.page + 1)} aria-label="Next page">
                  Next <ChevronRight size={16} aria-hidden="true" />
                </Button>
              </div>
            </nav>
          </>
        )}
      </div>
    </div>
  );
}
