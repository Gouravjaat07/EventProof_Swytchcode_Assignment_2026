import { useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../../lib/api-client.js';
import { useApi } from '../../hooks/use-api.js';
import { ErrorState, PageHeader, Skeleton } from '../../components/ui.jsx';
import { ComparisonTable, CorrectionPanel, EvidencePanel, ResultSummary } from '../verification/ResultView.jsx';

export function HistoryDetailPage() {
  const { verificationId } = useParams();
  const fetchOne = useCallback((opts) => api.getVerification(verificationId, opts), [verificationId]);
  const detail = useApi(fetchOne, { immediate: true });

  return (
    <div>
      <PageHeader
        title="Verification record"
        subtitle="Stored audit evidence, replayed verbatim."
        actions={
          <Link to="/history" className="inline-flex items-center gap-1 text-sm font-medium text-teal-800 hover:underline">
            <ArrowLeft size={14} aria-hidden="true" /> Back to history
          </Link>
        }
      />
      {detail.status === 'loading' || detail.status === 'idle' ? (
        <div className="space-y-3"><Skeleton className="h-32" /><Skeleton className="h-64" /></div>
      ) : detail.status === 'error' ? (
        <ErrorState
          error={detail.error}
          requestId={detail.requestId}
          onRetry={() => detail.run()}
          title={detail.error?.code === 'VERIFICATION_NOT_FOUND' ? 'Record not found' : 'Could not load this record'}
        />
      ) : (
        <div className="space-y-4">
          <ResultSummary result={detail.data} />
          <ComparisonTable fieldResults={detail.data.fieldResults} />
          <div className="grid gap-4 lg:grid-cols-2">
            <CorrectionPanel result={detail.data} onApply={null} />
            <EvidencePanel result={detail.data} requestId={detail.data.requestId} />
          </div>
        </div>
      )}
    </div>
  );
}
