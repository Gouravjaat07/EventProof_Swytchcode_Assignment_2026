import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import { userMessageFor } from '../lib/api-client.js';

export function Card({ className = '', children, ...rest }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`} {...rest}>
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

const BUTTON_KINDS = {
  primary: 'bg-teal-700 text-white hover:bg-teal-800 disabled:bg-slate-300',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-300',
  ghost: 'text-teal-800 hover:bg-teal-50 disabled:text-slate-400',
};

export function Button({ kind = 'secondary', className = '', ...rest }) {
  return (
    <button
      className={`inline-flex min-h-[2.5rem] items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${BUTTON_KINDS[kind] || BUTTON_KINDS.secondary} ${className}`}
      {...rest}
    />
  );
}

export function Field({ label, hint, error, children, htmlFor, required }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-800">
        {label}
        {required ? <span aria-hidden="true" className="ml-1 text-red-600">*</span> : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      {error ? (
        <p role="alert" className="mt-1 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({ invalid, className = '', ...rest }) {
  return (
    <input
      className={`w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 ${
        invalid ? 'border-red-500' : 'border-slate-300'
      } ${className}`}
      aria-invalid={invalid ? 'true' : undefined}
      {...rest}
    />
  );
}

export function Select({ invalid, className = '', children, ...rest }) {
  return (
    <select
      className={`w-full rounded-md border bg-white px-3 py-2 text-sm text-slate-900 ${
        invalid ? 'border-red-500' : 'border-slate-300'
      } ${className}`}
      aria-invalid={invalid ? 'true' : undefined}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-slate-600">
      <span aria-hidden="true" className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-teal-700" />
      {label}
    </span>
  );
}

export function Skeleton({ className = '' }) {
  return <div aria-hidden="true" className={`ep-skeleton rounded-md ${className}`} />;
}

export function EmptyState({ icon: Icon = Inbox, title, body, action }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <Icon size={22} aria-hidden="true" />
      </span>
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {body ? <p className="mt-1 max-w-md text-sm text-slate-600">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, requestId, onRetry, title = 'Something went wrong' }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-4" role="alert">
      <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
        <AlertTriangle size={16} aria-hidden="true" />
        {title}
      </p>
      <p className="text-sm text-red-700">{userMessageFor(error)}</p>
      {requestId ? (
        <p className="font-mono text-xs text-red-600">
          Request ID: <span className="ep-break">{requestId}</span>
        </p>
      ) : null}
      {onRetry ? (
        <Button kind="secondary" onClick={onRetry} className="mt-1 border-red-300">
          <RefreshCw size={15} aria-hidden="true" />
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function DemoBanner() {
  return (
    <div role="status" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <strong className="font-semibold">DEMO DATA.</strong> Synthetic fixtures for exploring the UI —
      not real calendar records. Turn demo mode off in Settings for the live workflow.
    </div>
  );
}
