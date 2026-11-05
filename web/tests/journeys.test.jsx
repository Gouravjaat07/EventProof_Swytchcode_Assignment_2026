import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import { DemoProvider, ToastProvider } from '../src/app/providers.jsx';
import { Toasts } from '../src/components/Toasts.jsx';
import { App } from '../src/app/App.jsx';
import { DashboardPage } from '../src/features/dashboard/DashboardPage.jsx';
import { EventsPage } from '../src/features/events/EventsPage.jsx';
import { VerifyPage } from '../src/features/verification/VerifyPage.jsx';
import { HistoryPage } from '../src/features/history/HistoryPage.jsx';
import { ApiError, api } from '../src/lib/api-client.js';

vi.mock('../src/lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal();
  const fns = {};
  const table = new Proxy(fns, { get: (t, p) => t[p] ?? (t[p] = vi.fn()) });
  return { ...actual, api: table };
});

const OFFICIAL = {
  id: 'evt1', source: 'google_calendar', sourceEventId: 'evt1', title: 'Hacknite 2026',
  description: null, startDate: '2026-08-07', endDate: '2026-08-07', startTime: '10:00',
  endTime: '18:00', timeZone: 'Asia/Kolkata', timeZoneSource: 'event', allDay: false,
  location: 'SVSU Campus', status: 'confirmed', sourceUpdatedAt: null,
  fetchedAt: '2026-11-05T00:00:00.000Z', sourceReference: { calendarId: 'primary', htmlLink: null },
};

function fieldResult(field, official, draft, state, critical, explanation) {
  return { field, official, draft, state, explanation: explanation || `${field} ${state}`, correction: state === 'MISMATCH' ? official : null, critical };
}

function verificationResult(status, overrides = {}) {
  return {
    verificationId: 'ver-1',
    status,
    eventReference: { source: 'google_calendar', sourceEventId: 'evt1', fetchedAt: '2026-11-05T00:00:00.000Z', sourceUpdatedAt: null },
    summary: { totalFields: 7, matchingFields: status === 'VERIFIED' ? 6 : 5, mismatchingFields: status === 'VERIFIED' ? 0 : 1, unverifiableFields: 1 },
    fieldResults: [
      fieldResult('title', 'Hacknite 2026', 'Hacknite 2026', 'MATCH', true),
      fieldResult('eventDate', '2026-08-07', overrides.eventDate || '2026-08-07', overrides.eventDate ? 'MISMATCH' : 'MATCH', true),
      fieldResult('startTime', '10:00', '10:00', 'MATCH', true),
      fieldResult('endTime', '18:00', '18:00', 'MATCH', false),
      fieldResult('timeZone', 'Asia/Kolkata', 'Asia/Kolkata', 'MATCH', false),
      fieldResult('venue', 'SVSU Campus', overrides.venue === undefined ? 'SVSU Campus' : overrides.venue, overrides.venue !== undefined && overrides.venue !== 'SVSU Campus' ? 'MISMATCH' : 'MATCH', true),
      fieldResult('registrationUrl', null, null, 'NOT_APPLICABLE', false),
    ],
    verifiedAt: '2026-11-05T01:00:00.000Z',
    requestId: 'req-1',
  };
}

function renderWithProviders(ui, initialEntries = ['/']) {
  return render(
    <ToastProvider>
      <DemoProvider>
        <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
        <Toasts />
      </DemoProvider>
    </ToastProvider>
  );
}

beforeEach(() => {
  for (const fn of Object.values(api)) {
    if (typeof fn?.mockReset === 'function') fn.mockReset();
  }
});

describe('JOURNEY 1 — dashboard loads real backend data', () => {
  it('shows stats, activity, and integration state from the API', async () => {
    api.verificationStats.mockResolvedValue({ data: { total: 4, verified: 2, reviewRequired: 1, unverifiable: 1 }, requestId: null });
    api.listVerifications.mockResolvedValue({
      data: { records: [verificationResult('VERIFIED'), verificationResult('REVIEW_REQUIRED', { venue: 'Elsewhere' })], total: 2, page: 1, pageSize: 5, totalPages: 1 },
      requestId: null,
    });
    api.integrationStatus.mockResolvedValue({
      data: { backend: 'online', swytchcode: { cliAvailable: true, cliVersion: '2.25.5', runtimeLoads: true, method: 'm' }, provider: { auth: 'connected', authCheckedAt: null, lastSuccessAt: '2026-11-05T00:00:00.000Z', lastFailureAt: null, lastErrorCategory: null } },
      requestId: null,
    });
    renderWithProviders(<DashboardPage />);
    await waitFor(() => expect(screen.getByText('4', { selector: 'p.tnum' })).toBeDefined());
    expect(screen.getAllByText('Hacknite 2026').length).toBeGreaterThan(0);
    expect(screen.getByText('Connected')).toBeDefined();
  });

  it('every sidebar destination resolves (no dead navigation)', async () => {
    api.verificationStats.mockResolvedValue({ data: { total: 0, verified: 0, reviewRequired: 0, unverifiable: 0 }, requestId: null });
    api.listVerifications.mockResolvedValue({ data: { records: [], total: 0, page: 1, pageSize: 5, totalPages: 1 }, requestId: null });
    api.integrationStatus.mockResolvedValue({ data: { backend: 'online', swytchcode: {}, provider: {} }, requestId: null });
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <DemoProvider>
          <MemoryRouter initialEntries={['/']}>
            <Routes>
              <Route path="/" element={<App />}>
                <Route index element={<DashboardPage />} />
                <Route path="events" element={<h1>Events stub</h1>} />
                <Route path="verify" element={<VerifyPage />} />
                <Route path="history" element={<HistoryPage />} />
                <Route path="integrations" element={<h1>Status stub</h1>} />
                <Route path="settings" element={<h1>Settings stub</h1>} />
              </Route>
            </Routes>
          </MemoryRouter>
        </DemoProvider>
      </ToastProvider>
    );
    for (const [label, heading] of [['Events', 'Events stub'], ['Verify Announcement', 'Verification Workspace'], ['Verification History', 'Verification History'], ['Integrations', 'Status stub'], ['Settings', 'Settings stub']]) {
      await user.click(screen.getByRole('link', { name: label }));
      expect(await screen.findByRole('heading', { name: heading })).toBeDefined();
    }
  });
});

describe('JOURNEY 2 — verify flow renders the backend decision', () => {
  it('loads the official record, submits, and shows VERIFIED with evidence', async () => {
    const user = userEvent.setup();
    api.getEvent.mockResolvedValue({ data: { event: OFFICIAL }, requestId: 'r1' });
    api.createVerification.mockResolvedValue({ data: verificationResult('VERIFIED'), requestId: 'r2' });
    renderWithProviders(<VerifyPage />, ['/verify?eventId=evt1']);

    await waitFor(() => expect(screen.getByText('SVSU Campus')).toBeDefined());
    await user.type(screen.getByLabelText(/event title/i), 'Hacknite 2026');
    await user.type(screen.getByLabelText(/event date/i), '2026-08-07');
    await user.type(screen.getByLabelText(/start time/i), '10:00');
    await user.type(screen.getByLabelText(/end time/i), '18:00');
    await user.type(screen.getByLabelText(/time zone/i), 'Asia/Kolkata');
    await user.type(screen.getByLabelText(/venue/i), 'SVSU Campus');
    await user.click(screen.getByRole('button', { name: /verify announcement/i }));

    expect((await screen.findAllByText('Verified')).length).toBeGreaterThan(0);
    expect(screen.getByText('Field-by-field evidence')).toBeDefined();
    // The request carried the exact backend contract.
    expect(api.createVerification).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt1', announcement: expect.objectContaining({ title: 'Hacknite 2026', eventDate: '2026-08-07' }) }),
      expect.anything()
    );
  });
});

describe('JOURNEY 3 — date mismatch, correction, copy', () => {
  it('highlights the mismatch and copies the official date', async () => {
    const user = userEvent.setup();
    api.getEvent.mockResolvedValue({ data: { event: OFFICIAL }, requestId: 'r1' });
    api.createVerification.mockResolvedValue({ data: verificationResult('REVIEW_REQUIRED', { eventDate: '2026-08-08' }), requestId: 'r2' });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderWithProviders(<VerifyPage />, ['/verify?eventId=evt1']);
    await waitFor(() => expect(screen.getByText('SVSU Campus')).toBeDefined());

    await user.type(screen.getByLabelText(/event title/i), 'Hacknite 2026');
    await user.type(screen.getByLabelText(/event date/i), '2026-08-08');
    await user.click(screen.getByRole('button', { name: /verify announcement/i }));

    expect((await screen.findAllByText('Review required')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mismatch').length).toBeGreaterThan(0);
    // Correction preview uses the actual official date.
    expect(screen.getByText('Correction assistant')).toBeDefined();
    await user.click(screen.getByRole('button', { name: /copy corrections/i }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('2026-08-07'));
    expect(await screen.findByText(/copied to clipboard/i)).toBeDefined();
  });
});

describe('JOURNEY 4/5 — venue mismatch and missing source data', () => {
  it('reports a venue mismatch', async () => {
    const user = userEvent.setup();
    api.getEvent.mockResolvedValue({ data: { event: OFFICIAL }, requestId: 'r1' });
    api.createVerification.mockResolvedValue({ data: verificationResult('REVIEW_REQUIRED', { venue: 'Nowhere Hall' }), requestId: 'r2' });
    renderWithProviders(<VerifyPage />, ['/verify?eventId=evt1']);
    await waitFor(() => expect(screen.getByText('SVSU Campus')).toBeDefined());
    await user.type(screen.getByLabelText(/event title/i), 'Hacknite 2026');
    await user.type(screen.getByLabelText(/event date/i), '2026-08-07');
    await user.type(screen.getByLabelText(/venue/i), 'Nowhere Hall');
    await user.click(screen.getByRole('button', { name: /verify announcement/i }));
    const rows = await screen.findAllByText('Mismatch');
    expect(rows.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Venue').length).toBeGreaterThan(0);
  });

  it('marks missing authoritative venue as missing-in-source, never verified', async () => {
    const user = userEvent.setup();
    api.getEvent.mockResolvedValue({ data: { event: { ...OFFICIAL, location: null } }, requestId: 'r1' });
    const result = verificationResult('UNVERIFIABLE');
    result.fieldResults = result.fieldResults.map((f) => (f.field === 'venue' ? { ...f, official: null, draft: 'Somewhere', state: 'MISSING_IN_SOURCE', correction: null } : f));
    api.createVerification.mockResolvedValue({ data: result, requestId: 'r2' });
    renderWithProviders(<VerifyPage />, ['/verify?eventId=evt1']);
    await waitFor(() => expect(screen.getByText('Hacknite 2026')).toBeDefined());
    await user.type(screen.getByLabelText(/event title/i), 'Hacknite 2026');
    await user.type(screen.getByLabelText(/event date/i), '2026-08-07');
    await user.type(screen.getByLabelText(/venue/i), 'Somewhere');
    await user.click(screen.getByRole('button', { name: /verify announcement/i }));
    expect((await screen.findAllByText('Unverifiable')).length).toBeGreaterThan(0);
    expect(screen.getByText('Missing in source')).toBeDefined();
  });
});

describe('JOURNEY 7 — backend failure preserves the draft', () => {
  it('shows an actionable error and keeps every typed value', async () => {
    const user = userEvent.setup();
    api.getEvent.mockResolvedValue({ data: { event: OFFICIAL }, requestId: 'r1' });
    api.createVerification.mockRejectedValue(new ApiError({ code: 'EVENT_SOURCE_UNAVAILABLE', message: 'unreachable' }));
    renderWithProviders(<VerifyPage />, ['/verify?eventId=evt1']);
    await waitFor(() => expect(screen.getByText('SVSU Campus')).toBeDefined());
    await user.type(screen.getByLabelText(/event title/i), 'Keep Me');
    await user.type(screen.getByLabelText(/event date/i), '2026-08-07');
    await user.click(screen.getByRole('button', { name: /verify announcement/i }));
    expect(await screen.findByText(/event source is unreachable/i)).toBeDefined();
    expect(screen.getByLabelText(/event title/i)).toHaveProperty('value', 'Keep Me');
    expect(screen.getByLabelText(/event date/i)).toHaveProperty('value', '2026-08-07');
  });
});

describe('JOURNEY 8 — history filters and pagination', () => {
  it('filters by status and pages without losing state', async () => {
    const user = userEvent.setup();
    const page1 = { records: [verificationResult('VERIFIED')], total: 3, page: 1, pageSize: 10, totalPages: 2 };
    api.listVerifications.mockResolvedValue({ data: page1, requestId: null });
    renderWithProviders(<HistoryPage />, ['/history']);
    expect(await screen.findByText('Hacknite 2026')).toBeDefined();

    await user.selectOptions(screen.getByLabelText(/status/i), 'VERIFIED');
    await user.click(screen.getByRole('button', { name: /filter/i }));
    await waitFor(() => {
      const last = api.listVerifications.mock.calls.at(-1)[0];
      expect(last.status).toBe('VERIFIED');
      expect(last.page).toBe(1);
    });

    api.listVerifications.mockResolvedValue({ data: { ...page1, page: 2 }, requestId: null });
    await user.click(screen.getByRole('button', { name: /next page/i }));
    await waitFor(() => {
      expect(api.listVerifications.mock.calls.at(-1)[0].page).toBe(2);
    });
  });
});

describe('JOURNEY — event selection carries the Google event id', () => {
  it('selects the listed record by its items[].id and opens verify with it', async () => {
    window.localStorage.removeItem('ep-demo');
    const user = userEvent.setup();
    const GOOGLE_ID = '_8ck30c1g8cqk8b9k84ojcba2688qje9g6';
    api.listEvents.mockResolvedValue({
      data: { events: [{ ...OFFICIAL, id: GOOGLE_ID, sourceEventId: GOOGLE_ID }], nextPageToken: null },
      requestId: null,
    });
    let seenEventId = null;
    function VerifyProbe() {
      const [params] = useSearchParams();
      seenEventId = params.get('eventId');
      return <h1>Verify probe</h1>;
    }
    render(
      <ToastProvider>
        <DemoProvider>
          <MemoryRouter initialEntries={['/events']}>
            <Routes>
              <Route path="/events" element={<EventsPage />} />
              <Route path="/verify" element={<VerifyProbe />} />
            </Routes>
          </MemoryRouter>
        </DemoProvider>
      </ToastProvider>
    );
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    expect(await screen.findByText('Hacknite 2026')).toBeDefined();
    await user.click(screen.getByRole('button', { name: /^select$/i }));
    expect(await screen.findByRole('heading', { name: 'Verify probe' })).toBeDefined();
    expect(seenEventId).toBe(GOOGLE_ID);
  });
});

describe('JOURNEY — invalid draft blocked with inline errors', () => {
  it('shows field errors and never calls the backend', async () => {
    const user = userEvent.setup();
    api.getEvent.mockResolvedValue({ data: { event: OFFICIAL }, requestId: 'r1' });
    renderWithProviders(<VerifyPage />, ['/verify?eventId=evt1']);
    await waitFor(() => expect(screen.getByText('SVSU Campus')).toBeDefined());

    await user.type(screen.getByLabelText(/time zone/i), 'Mars/Olympus');
    await user.type(screen.getByLabelText(/start time/i), '99:99');
    await user.click(screen.getByRole('button', { name: /verify announcement/i }));

    expect(await screen.findByText('Title is required.')).toBeDefined();
    expect(screen.getByText('Event date is required.')).toBeDefined();
    expect(screen.getByText(/valid IANA name/)).toBeDefined();
    expect(screen.getByText(/HH:MM or h:MM/)).toBeDefined();
    expect(screen.getByText(/Fix the highlighted fields/)).toBeDefined();
    expect(api.createVerification).not.toHaveBeenCalled();
  });
});
