import { useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ClipboardCheck, AlertTriangle, Plug2 } from 'lucide-react';
import { api } from '../../lib/api-client.js';
import { useApi } from '../../hooks/use-api.js';
import { useDemo } from '../../app/providers.jsx';
import { DEMO_STATS } from '../../lib/demo.js';
import { Card, DemoBanner, EmptyState, ErrorState, PageHeader, Skeleton, Spinner, Button } from '../../components/ui.jsx';
import { StatusBadge } from '../../components/StatusBadge.jsx';
import { fieldLabel, formatDateTime, timeAgo } from '../../lib/format.js';

export function recordTitle(record) {
  const title = (record.fieldResults || []).find((f) => f.field === 'title') || {};
  return title.official || title.draft || record.eventReference?.sourceEventId || 'Untitled event';
}

function StatCard({ label, value, state }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-600">{label}</p>
      <p className="tnum mt-1 text-3xl font-semibold tracking-tight text-slate-900" aria-live="polite">
        {state === 'loading' ? '…' : value}
      </p>
    </div>
  );
}

function ActivityRow({ record }) {
  const mism = record.summary?.mismatchingFields ?? 0;
  return (
    <Link
      to={`/history/${record.verificationId}`}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-3 py-3 hover:bg-slate-50"
    >
      <span className="min-w-0 flex-1">
        <span className="ep-break block truncate text-sm font-medium text-slate-900">{recordTitle(record)}</span>
        <span className="block text-xs text-slate-500" title={formatDateTime(record.verifiedAt)}>
          {timeAgo(record.verifiedAt)} · {record.summary?.matchingFields ?? 0} matched · {mism} mismatched
        </span>
      </span>
      <StatusBadge status={record.status} />
    </Link>
  );
}

export function DashboardPage() {
  const { demo } = useDemo();
  const fetchStats = useCallback((opts) => api.verificationStats(opts), []);
  const fetchRecent = useCallback((opts) => api.listVerifications({ page: 1, pageSize: 5 }, opts), []);
  const fetchStatus = useCallback((opts) => api.integrationStatus(opts), []);
  const stats = useApi(fetchStats, { immediate: !demo });
  const recent = useApi(fetchRecent, { immediate: !demo });
  const status = useApi(fetchStatus, { immediate: !demo });

  const shownStats = demo ? { status: 'success', data: DEMO_STATS } : stats;

  const discrepancies = !demo && recent.status === 'success'
    ? recent.data.records
      .filter((r) => r.status === 'REVIEW_REQUIRED')
      .flatMap((r) => (r.fieldResults || []).filter((f) => f.state === 'MISMATCH').map((f) => ({ record: r, field: f })))
      .slice(0, 4)
    : [];

  return (
    <div>
      <PageHeader
        title="Verification Overview"
        subtitle="Know what's accurate before your next event announcement goes live."
        actions={
          <Link to="/verify">
            <Button kind="primary">
              <ClipboardCheck size={16} aria-hidden="true" />
              New verification
            </Button>
          </Link>
        }
      />
      {demo ? <DemoBanner /> : null}

      {/* Statistics: genuine zeros render as 0; failures render as errors, never as 0. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Verification statistics">
        {shownStats.status === 'error' ? (
          <div className="col-span-full">
            <ErrorState error={shownStats.error} requestId={shownStats.requestId} onRetry={() => stats.run()} title="Statistics unavailable" />
          </div>
        ) : (
          <>
            <StatCard label="Total attempts" value={shownStats.data?.total ?? '—'} state={shownStats.status} />
            <StatCard label="Verified" value={shownStats.data?.verified ?? '—'} state={shownStats.status} />
            <StatCard label="Review required" value={shownStats.data?.reviewRequired ?? '—'} state={shownStats.status} />
            <StatCard label="Unverifiable" value={shownStats.data?.unverifiable ?? '—'} state={shownStats.status} />
          </>
        )}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <Card className="p-2 lg:col-span-3">
          <div className="flex items-center justify-between px-3 pb-1 pt-2">
            <h2 className="text-base font-semibold text-slate-900">Recent activity</h2>
            <Link to="/history" className="inline-flex items-center gap-1 text-sm font-medium text-teal-800 hover:underline">
              View all <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
          {demo ? (
            <EmptyState
              icon={ClipboardCheck}
              title="Demo mode hides real history"
              body="Turn demo mode off in Settings to see genuine verification activity."
            />
          ) : recent.status === 'loading' || recent.status === 'idle' ? (
            <div className="space-y-2 p-3"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
          ) : recent.status === 'error' ? (
            <div className="p-3"><ErrorState error={recent.error} requestId={recent.requestId} onRetry={() => recent.run()} title="Activity unavailable" /></div>
          ) : recent.data.records.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="No verifications yet"
              body="Run your first verification to see activity here. Nothing is fabricated — this list fills with real records."
              action={<Link to="/verify"><Button kind="primary">Start verifying</Button></Link>}
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent.data.records.map((r) => (
                <li key={r.verificationId}><ActivityRow record={r} /></li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Card className="p-4">
            <h2 className="mb-2 text-base font-semibold text-slate-900">Needs attention</h2>
            {demo ? (
              <p className="text-sm text-slate-600">Demo mode: discrepancies are hidden with real history.</p>
            ) : recent.status === 'loading' || recent.status === 'idle' ? (
              <Spinner label="Checking recent results…" />
            ) : recent.status === 'error' ? (
              <p className="text-sm text-slate-600">Unavailable while activity fails to load.</p>
            ) : discrepancies.length === 0 ? (
              <p className="flex items-start gap-2 text-sm text-slate-600">
                <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-lime-700" />
                No open mismatches in recent verifications.
              </p>
            ) : (
              <ul className="space-y-3">
                {discrepancies.map(({ record, field }) => (
                  <li key={`${record.verificationId}-${field.field}`} className="text-sm">
                    <Link to={`/history/${record.verificationId}`} className="font-medium text-slate-900 hover:underline ep-break">
                      {recordTitle(record)}
                    </Link>
                    <p className="mt-0.5 flex items-start gap-1.5 text-slate-600">
                      <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-600" />
                      {fieldLabel(field.field)}: {field.explanation}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 text-base font-semibold text-slate-900">Source integration</h2>
            {demo ? (
              <p className="text-sm text-slate-600">Demo mode: live status hidden.</p>
            ) : status.status === 'loading' || status.status === 'idle' ? (
              <Spinner label="Checking integration…" />
            ) : status.status === 'error' ? (
              <p className="text-sm text-red-700">Backend unreachable — integration state unknown.</p>
            ) : (
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-slate-600">Backend</dt><dd className="font-medium text-slate-900">Online</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate-600">Swytchcode CLI</dt><dd className="font-medium text-slate-900">{status.data.swytchcode.cliAvailable ? `Installed${status.data.swytchcode.cliVersion ? ` (${status.data.swytchcode.cliVersion})` : ''}` : 'Not found'}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate-600">Calendar authorization</dt><dd className="font-medium text-slate-900">{authLabel(status.data.provider.auth)}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-slate-600">Last successful fetch</dt><dd className="font-medium text-slate-900">{status.data.provider.lastSuccessAt ? timeAgo(status.data.provider.lastSuccessAt) : 'Not yet verified'}</dd></div>
              </dl>
            )}
            <Link to="/integrations" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-teal-800 hover:underline">
              <Plug2 size={14} aria-hidden="true" /> Full diagnostics <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}

function authLabel(auth) {
  if (auth === 'connected') return 'Connected';
  if (auth === 'not_connected') return 'Authorization required';
  return 'Not yet verified';
}
