import { useCallback, useEffect, useRef, useState } from 'react';

// useApi: request state machine with abort + stale-response guard.
// States: idle | loading | success | error. A newer call always wins: late
// responses from older calls are dropped and never overwrite fresh state.
export function useApi(fetcher, { immediate = false, args = [] } = {}) {
  const [state, setState] = useState({ status: 'idle', data: null, error: null, requestId: null });
  const seq = useRef(0);
  const abortRef = useRef(null);

  const run = useCallback((...callArgs) => {
    const id = seq.current + 1;
    seq.current = id;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: 'loading', data: null, error: null, requestId: null });
    let settled = false;
    return fetcher(...callArgs, { signal: controller.signal }).then(
      (result) => {
        settled = true;
        if (seq.current !== id) return { stale: true };
        setState({ status: 'success', data: result.data, error: null, requestId: result.requestId || null });
        return { data: result.data, requestId: result.requestId || null };
      },
      (error) => {
        settled = true;
        if (seq.current !== id) return { stale: true };
        if (error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
          setState({ status: 'idle', data: null, error: null, requestId: null });
          return { aborted: true };
        }
        setState({ status: 'error', data: null, error, requestId: error?.requestId || null });
        return { error };
      }
    ).finally(() => {
      if (!settled) return;
      if (abortRef.current === controller) abortRef.current = null;
    });
  }, [fetcher]);

  const reset = useCallback(() => {
    seq.current += 1;
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = null;
    setState({ status: 'idle', data: null, error: null, requestId: null });
  }, []);

  useEffect(() => {
    if (immediate) run(...args);
    return () => {
      seq.current += 1;
      if (abortRef.current) abortRef.current.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...state, run, reset };
}
