import { useCallback } from 'react';
import { CheckCircle2, HelpCircle, RefreshCw, XCircle } from 'lucide-react';
import { api } from '../../lib/api-client.js';
import { useApi } from '../../hooks/use-api.js';
import { Button, Card, ErrorState, PageHeader, Skeleton } from '../../components/ui.jsx';
import { formatDateTime } from '../../lib/format.js';

function StateIcon({ state }) {
  if (state === 'good') return <CheckCircle2 size={16} aria-hidden="true" className="text-lime-700" />;
  if (state === 'bad') return <XCircle size={16} aria-hidden="true" className="text-red-600" />;
  return <HelpCircle size={16} aria-hidden="true" className="text-slate-400" />;
}

function Row({ label, state, value, hint }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 py-3 last:border-0">
      <div>
        <p className="text-sm font-medium text-slate-900">{label}</p>
        {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
      </div>
      <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
        <StateIcon state={state} />
        <span className="ep-break">{value}</span>
      </p>
    </div>
  );
}

export function StatusPage() {
  const fetchStatus = useCallback((opts) => api.integrationStatus(opts), []);
  const status = useApi(fetchStatus, { immediate: true });

  const d = status.status === 'success' ? status.data : null;
  const auth = d?.provider?.auth;
  const authState = auth === 'connected' ? 'good' : auth === 'not_connected' ? 'bad' : 'unknown';
  const authValue = auth === 'connected' ? 'Connected' : auth === 'not_connected' ? 'Authorization required' : 'Not yet verified';

  return (
    <div>
      <PageHeader
        title="Integrations"
        subtitle="Safe diagnostics for the Swytchcode-backed event source. No tokens or secrets are ever shown here."
        actions={
          <Button kind="secondary" onClick={() => status.run()} disabled={status.status === 'loading'}>
            <RefreshCw size={15} aria-hidden="true" />
            Recheck
          </Button>
        }
      />
      {status.status === 'loading' || status.status === 'idle' ? (
        <div className="space-y-2"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : status.status === 'error' ? (
        <ErrorState error={status.error} requestId={status.requestId} onRetry={() => status.run()} title="Status unavailable" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="px-4 py-1">
            <Row label="Backend" state="good" value="Online" hint="This page loaded, so the API answers." />
            <Row
              label="Swytchcode CLI"
              state={d.swytchcode.cliAvailable ? 'good' : 'bad'}
              value={d.swytchcode.cliAvailable ? `Installed${d.swytchcode.cliVersion ? ` (${d.swytchcode.cliVersion})` : ''}` : 'Not found'}
              hint="Local execution binary."
            />
            <Row
              label="Runtime package"
              state={d.swytchcode.runtimeLoads ? 'good' : 'bad'}
              value={d.swytchcode.runtimeLoads ? 'Loads correctly' : 'Failed to load'}
              hint="Node interface the server uses to invoke the CLI."
            />
            <Row label="Integration" state="good" value="Google Calendar" hint="Authoritative event source." />
            <Row label="Configured operation" state="good" value={d.swytchcode.method || '—'} hint="Read-only list operation." />
          </Card>
          <Card className="px-4 py-1">
            <Row
              label="Provider authorization"
              state={authState}
              value={authValue}
              hint={auth === 'unknown' ? 'Cannot be determined without an authenticated check.' : `Checked ${formatDateTime(d.provider.authCheckedAt)}.`}
            />
            <Row
              label="Last successful fetch"
              state={d.provider.lastSuccessAt ? 'good' : 'unknown'}
              value={d.provider.lastSuccessAt ? formatDateTime(d.provider.lastSuccessAt) : 'Not yet verified'}
              hint="Last time live event data arrived."
            />
            <Row
              label="Last failed fetch"
              state={d.provider.lastFailureAt ? 'bad' : 'unknown'}
              value={d.provider.lastFailureAt ? formatDateTime(d.provider.lastFailureAt) : 'None recorded'}
              hint={d.provider.lastErrorCategory ? `Category: ${d.provider.lastErrorCategory}` : 'No failures observed yet.'}
            />
            {auth === 'not_connected' ? (
              <p className="py-3 text-sm text-slate-700">
                Run <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">swytchcode auth connect google_calendar</code> in
                a terminal with a browser, then press Recheck.
              </p>
            ) : null}
          </Card>
        </div>
      )}
    </div>
  );
}
