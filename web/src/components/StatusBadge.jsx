import { AlertTriangle, CheckCircle2, HelpCircle, MinusCircle, XCircle } from 'lucide-react';
import { fieldStateLabel, statusLabel } from '../lib/format.js';

// Status is NEVER color-only: every pill carries an icon + text label.
const STATUS_STYLE = {
  VERIFIED: { cls: 'bg-lime-100 text-lime-900 border-lime-300', Icon: CheckCircle2 },
  REVIEW_REQUIRED: { cls: 'bg-amber-100 text-amber-900 border-amber-300', Icon: AlertTriangle },
  UNVERIFIABLE: { cls: 'bg-slate-200 text-slate-800 border-slate-300', Icon: HelpCircle },
};

const FIELD_STYLE = {
  MATCH: { cls: 'bg-lime-100 text-lime-900 border-lime-300', Icon: CheckCircle2 },
  MISMATCH: { cls: 'bg-red-100 text-red-900 border-red-300', Icon: XCircle },
  MISSING_IN_DRAFT: { cls: 'bg-amber-100 text-amber-900 border-amber-300', Icon: AlertTriangle },
  MISSING_IN_SOURCE: { cls: 'bg-amber-100 text-amber-900 border-amber-300', Icon: AlertTriangle },
  UNVERIFIABLE: { cls: 'bg-slate-200 text-slate-800 border-slate-300', Icon: HelpCircle },
  NOT_APPLICABLE: { cls: 'bg-slate-100 text-slate-600 border-slate-200', Icon: MinusCircle },
};

function Pill({ cls, Icon, label }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      <Icon size={13} aria-hidden="true" />
      {label}
    </span>
  );
}

export function StatusBadge({ status }) {
  const style = STATUS_STYLE[status] || { cls: 'bg-slate-200 text-slate-800 border-slate-300', Icon: HelpCircle };
  return <Pill cls={style.cls} Icon={style.Icon} label={statusLabel(status)} />;
}

export function FieldStateBadge({ state }) {
  const style = FIELD_STYLE[state] || { cls: 'bg-slate-200 text-slate-800 border-slate-300', Icon: HelpCircle };
  return <Pill cls={style.cls} Icon={style.Icon} label={fieldStateLabel(state)} />;
}
