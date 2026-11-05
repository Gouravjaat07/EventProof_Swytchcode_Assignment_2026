import { useState } from 'react';
import { useDemo, useToasts } from '../../app/providers.jsx';
import { getStoredBaseOverride, resolveBaseUrl, setStoredBaseOverride } from '../../lib/api-client.js';
import { Button, Card, Field, PageHeader, TextInput } from '../../components/ui.jsx';

export function SettingsPage() {
  const { demo, setDemo } = useDemo();
  const { push } = useToasts();
  const [base, setBase] = useState(getStoredBaseOverride());
  const [baseError, setBaseError] = useState(null);

  function saveBase(e) {
    e.preventDefault();
    const value = base.trim().replace(/\/+$/, '');
    if (value) {
      try {
        const u = new URL(value);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          setBaseError('Must be an http(s) URL, or empty for same-origin.');
          return;
        }
      } catch {
        setBaseError('Must be a valid URL, or empty for same-origin.');
        return;
      }
    }
    setStoredBaseOverride(value);
    setBase(value);
    setBaseError(null);
    push(value ? `API base set to ${value}.` : 'Using same-origin API (dev proxy).', 'success');
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Local console preferences. No credentials are stored here." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-base font-semibold text-slate-900">Backend connection</h2>
          <p className="mb-3 mt-1 text-sm text-slate-600">
            Current base: <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs ep-break">{resolveBaseUrl() || '(same origin)'}</code>
          </p>
          <form onSubmit={saveBase} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label="API base URL override" htmlFor="set-base" error={baseError} hint="Empty = same origin (recommended with npm run dev)">
                <TextInput
                  id="set-base"
                  value={base}
                  onChange={(e) => { setBase(e.target.value); setBaseError(null); }}
                  placeholder="http://127.0.0.1:3000"
                  invalid={!!baseError}
                />
              </Field>
            </div>
            <Button kind="secondary" type="submit">Save</Button>
          </form>
        </Card>

        <Card className="p-4">
          <h2 className="text-base font-semibold text-slate-900">Demo mode</h2>
          <p className="mb-3 mt-1 text-sm text-slate-600">
            Explore the interface with clearly labeled synthetic fixtures. Demo data never touches
            the backend and never appears in real history or statistics.
          </p>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={demo}
              onChange={(e) => {
                setDemo(e.target.checked);
                push(e.target.checked ? 'Demo mode on — synthetic fixtures active.' : 'Demo mode off — live backend active.', 'info');
              }}
              className="h-5 w-5 accent-teal-700"
            />
            <span className="text-sm font-medium text-slate-800">Enable demo mode</span>
          </label>
        </Card>

        <Card className="p-4 lg:col-span-2">
          <h2 className="text-base font-semibold text-slate-900">About EventProof</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            EventProof verifies campus event announcements against authoritative calendar records
            fetched through Swytchcode, then explains every decision field by field. It never
            publishes, modifies calendar events, or stores provider credentials in the browser.
            Verification decisions come solely from the backend engine.
          </p>
        </Card>
      </div>
    </div>
  );
}
