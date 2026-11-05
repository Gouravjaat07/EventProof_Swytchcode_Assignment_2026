import { useState } from 'react';
import { CheckCircle2, Copy } from 'lucide-react';
import { useToasts } from '../../app/providers.jsx';
import { Button, Card } from '../../components/ui.jsx';
import { FieldStateBadge, StatusBadge } from '../../components/StatusBadge.jsx';
import { displayValue, fieldLabel, formatDateTime, statusLabel } from '../../lib/format.js';

export function ResultSummary({ result }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Verification decision</p>
          <p className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{statusLabel(result.status)}</p>
        </div>
        <StatusBadge status={result.status} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-slate-500">Compared</dt><dd className="tnum text-lg font-semibold text-slate-900">{result.summary.totalFields}</dd></div>
        <div><dt className="text-slate-500">Matching</dt><dd className="tnum text-lg font-semibold text-lime-700">{result.summary.matchingFields}</dd></div>
        <div><dt className="text-slate-500">Mismatching</dt><dd className="tnum text-lg font-semibold text-red-700">{result.summary.mismatchingFields}</dd></div>
        <div><dt className="text-slate-500">Unverifiable</dt><dd className="tnum text-lg font-semibold text-slate-700">{result.summary.unverifiableFields}</dd></div>
      </dl>
      <p className="mt-3 text-xs text-slate-500">
        Verified {formatDateTime(result.verifiedAt)} · Source: {result.eventReference.source} ·
        Record <span className="font-mono ep-break">{result.eventReference.sourceEventId}</span>
      </p>
    </Card>
  );
}

function ComparisonRow({ field }) {
  return (
    <div className="grid gap-2 border-b border-slate-100 px-4 py-3 last:border-0 md:grid-cols-[10rem_1fr_1fr_9rem] md:gap-4">
      <div>
        <p className="text-sm font-semibold text-slate-900">
          {fieldLabel(field.field)}
          {field.critical ? <span className="ml-1.5 rounded bg-slate-900 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-white">Critical</span> : null}
        </p>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Official</p>
        <p className="ep-break mt-0.5 text-sm text-slate-900">{displayValue(field.field, field.official)}</p>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Draft</p>
        <p className="ep-break mt-0.5 text-sm text-slate-900">{displayValue(field.field, field.draft)}</p>
      </div>
      <div className="flex flex-col items-start gap-1.5">
        <FieldStateBadge state={field.state} />
      </div>
      <p className="text-sm text-slate-600 md:col-span-4">{field.explanation}</p>
      {field.correction ? (
        <p className="text-sm md:col-span-4">
          <span className="font-medium text-slate-700">Correction: </span>
          <span className="ep-break font-mono text-[0.83rem] text-teal-900">{displayValue(field.field, field.correction)}</span>
        </p>
      ) : null}
    </div>
  );
}

export function ComparisonTable({ fieldResults }) {
  return (
    <Card>
      <h3 className="border-b border-slate-200 px-4 py-3 text-base font-semibold text-slate-900">Field-by-field evidence</h3>
      <div>
        {fieldResults.map((f) => (
          <ComparisonRow key={f.field} field={f} />
        ))}
      </div>
    </Card>
  );
}

export function EvidencePanel({ result, requestId }) {
  const ref = result.eventReference;
  const rows = [
    ['Source integration', ref.source],
    ['Source event ID', ref.sourceEventId],
    ['Source fetched', formatDateTime(ref.fetchedAt)],
    ['Source updated', ref.sourceUpdatedAt ? formatDateTime(ref.sourceUpdatedAt) : 'Not provided'],
    ['Verified', formatDateTime(result.verifiedAt)],
    ['Verification ID', result.verificationId],
    ['Request ID', requestId || '—'],
  ];
  return (
    <Card className="p-4">
      <h3 className="mb-2 text-base font-semibold text-slate-900">Evidence & provenance</h3>
      <dl className="space-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-wrap justify-between gap-2">
            <dt className="text-slate-500">{label}</dt>
            <dd className="ep-break max-w-full text-right font-mono text-[0.8rem] text-slate-800">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export function CorrectionPanel({ result, onApply }) {
  const { push } = useToasts();
  const [copied, setCopied] = useState(false);
  const correctable = result.fieldResults.filter((f) => f.state === 'MISMATCH' && f.correction);
  const manual = result.fieldResults.filter(
    (f) => (f.state === 'UNVERIFIABLE' || f.state === 'MISSING_IN_SOURCE') && f.draft
  );

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(area);
        return ok;
      } catch {
        return false;
      }
    }
  }

  async function handleCopy() {
    const lines = correctable.map((f) => `${fieldLabel(f.field)}: ${f.correction}`);
    const ok = await copyText(lines.join('\n'));
    setCopied(ok);
    push(ok ? 'Corrections copied to clipboard.' : 'Copy failed — clipboard permission denied. Select the text manually.', ok ? 'success' : 'error');
    if (ok) setTimeout(() => setCopied(false), 2500);
  }

  if (correctable.length === 0 && manual.length === 0) {
    return (
      <Card className="p-4">
        <h3 className="mb-1 text-base font-semibold text-slate-900">Correction assistant</h3>
        <p className="flex items-start gap-2 text-sm text-slate-600">
          <CheckCircle2 size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-lime-700" />
          Nothing to correct — every verifiable field already matches.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <h3 className="mb-1 text-base font-semibold text-slate-900">Correction assistant</h3>
      <p className="mb-3 text-sm text-slate-600">
        Deterministic fixes from the official record. Your draft stays untouched until you apply them.
      </p>
      {correctable.length > 0 ? (
        <>
          <ul className="space-y-2">
            {correctable.map((f) => (
              <li key={f.field} className="rounded-md border border-slate-200 p-3 text-sm">
                <p className="font-medium text-slate-900">{fieldLabel(f.field)}</p>
                <p className="mt-1 text-slate-600">
                  <span className="line-through ep-break">{displayValue(f.field, f.draft)}</span>
                  {' → '}
                  <strong className="ep-break font-semibold text-teal-900">{displayValue(f.field, f.correction)}</strong>
                </p>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {onApply ? (
              <Button kind="primary" onClick={() => onApply(correctable)}>
                Apply corrections to draft
              </Button>
            ) : null}
            <Button kind="secondary" onClick={handleCopy}>
              {copied ? <CheckCircle2 size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy corrections'}
            </Button>
          </div>
        </>
      ) : null}
      {manual.length > 0 ? (
        <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
          <p className="font-medium text-slate-900">Needs manual confirmation</p>
          <ul className="mt-1 list-disc pl-5">
            {manual.map((f) => (
              <li key={f.field}>
                {fieldLabel(f.field)} — no authoritative value to correct from. {f.explanation}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
