import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useToasts } from '../app/providers.jsx';

const KINDS = {
  info: { cls: 'border-slate-300 bg-white text-slate-800', Icon: Info },
  success: { cls: 'border-lime-300 bg-lime-50 text-lime-900', Icon: CheckCircle2 },
  error: { cls: 'border-red-300 bg-red-50 text-red-900', Icon: AlertTriangle },
};

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,24rem)] flex-col gap-2">
      {toasts.map((t) => {
        const style = KINDS[t.kind] || KINDS.info;
        return (
          <div key={t.id} role="status" className={`pointer-events-auto flex items-start gap-2 rounded-lg border p-3 shadow-md ${style.cls}`}>
            <style.Icon size={17} aria-hidden="true" className="mt-0.5 shrink-0" />
            <p className="flex-1 text-sm">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
