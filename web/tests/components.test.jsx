import { describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToasts } from '../src/app/providers.jsx';
import { Button, EmptyState, ErrorState } from '../src/components/ui.jsx';
import { FieldStateBadge, StatusBadge } from '../src/components/StatusBadge.jsx';
import { Toasts } from '../src/components/Toasts.jsx';
import { useApi } from '../src/hooks/use-api.js';
import { ApiError } from '../src/lib/api-client.js';

describe('badges carry text, never color alone', () => {
  it.each([
    ['VERIFIED', 'Verified'],
    ['REVIEW_REQUIRED', 'Review required'],
    ['UNVERIFIABLE', 'Unverifiable'],
  ])('status %s renders "%s"', (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeDefined();
  });

  it.each([
    ['MATCH', 'Match'],
    ['MISMATCH', 'Mismatch'],
    ['MISSING_IN_DRAFT', 'Missing in draft'],
    ['MISSING_IN_SOURCE', 'Missing in source'],
    ['UNVERIFIABLE', 'Unverifiable'],
    ['NOT_APPLICABLE', 'Not applicable'],
  ])('field state %s renders "%s"', (state, label) => {
    render(<FieldStateBadge state={state} />);
    expect(screen.getByText(label)).toBeDefined();
  });
});

describe('feedback primitives', () => {
  it('ErrorState shows a friendly message, request id, and working retry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <ErrorState error={new ApiError({ code: 'EVENT_NOT_FOUND', message: 'raw' })} requestId="req-42" onRetry={onRetry} />
    );
    expect(screen.getByText(/could not be found/)).toBeDefined();
    expect(screen.getByText(/req-42/)).toBeDefined();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('EmptyState renders title, body, and action', () => {
    render(<EmptyState title="Nothing here" body="Do the thing." action={<Button>Act</Button>} />);
    expect(screen.getByText('Nothing here')).toBeDefined();
    expect(screen.getByText('Do the thing.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Act' })).toBeDefined();
  });

  it('toasts announce politely and dismiss', async () => {
    const user = userEvent.setup();
    function Harness() {
      const { push } = useToasts();
      return <Button onClick={() => push('Saved ok.', 'success')}>Save</Button>;
    }
    render(<ToastProvider><Toasts /><Harness /></ToastProvider>);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Saved ok.')).toBeDefined();
    await user.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByText('Saved ok.')).toBeNull();
  });
});

describe('useApi stale-response guard', () => {
  it('drops late responses from superseded calls', async () => {
    let resolveFirst;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    const fetcher = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({ data: 'second', requestId: null });
    const { result } = renderHook(() => useApi(fetcher));
    let p1;
    act(() => { p1 = result.current.run('a'); });
    let p2;
    await act(async () => { p2 = await result.current.run('b'); });
    expect(p2).toEqual({ data: 'second', requestId: null });
    expect(result.current.data).toBe('second');
    await act(async () => {
      resolveFirst({ data: 'first-late', requestId: null });
      await p1;
    });
    expect(result.current.data).toBe('second'); // late first response dropped
  });

  it('maps thrown errors to error state with request ids', async () => {
    const fetcher = vi.fn(async () => { throw new ApiError({ code: 'X', message: 'bad', requestId: 'r1' }); });
    const { result } = renderHook(() => useApi(fetcher));
    await act(async () => { await result.current.run(); });
    expect(result.current.status).toBe('error');
    expect(result.current.requestId).toBe('r1');
  });
});
