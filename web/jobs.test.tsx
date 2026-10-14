import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API, type Job } from '@torrent-tv/shared';
import { Jobs } from './jobs';

// Jobs: status, what ran and the last message lead; time and duration follow;
// the job id and raw logs wait behind Details, newest first. Prior art:
// downloads.test.tsx for the mocking style.

const job = (patch: Partial<Job>): Job => ({
  id: 'job-8f31-aaaa', kind: 'catalog.sync', state: 'completed', label: 'Fetch latest releases', dedupeKey: 'k', progress: 1, attempt: 1, retryable: true,
  createdAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:03:20Z', ...patch,
});

class FakeEventSource { addEventListener() { } close() { } }
const mountedHosts: HTMLElement[] = [];
async function mountJobs(items: Job[]) {
  vi.spyOn(API.prototype, 'jobs').mockResolvedValue({ items, nextCursor: null, total: items.length });
  const host = document.createElement('div');
  document.body.appendChild(host);
  mountedHosts.push(host);
  await act(async () => { render(<Jobs onError={() => { }} onOpenDetail={() => { }} onCloseDetail={() => { }} />, host) });
  // The list loads after a 300 ms debounce.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)) });
  await act(async () => { });
  return host;
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  class FakeObserver { observe() { } disconnect() { } }
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});
afterEach(() => {
  while (mountedHosts.length) render(null, mountedHosts.pop()!);
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Jobs list', () => {
  it('names the status in words and shows what ran', async () => {
    const host = await mountJobs([job({}), job({ id: 'j2', state: 'failed', label: 'Rebuild catalog', error: 'FileList answered 503' }), job({ id: 'j3', state: 'retry_wait', nextAttemptAt: '2026-10-15T09:00:00Z', progress: 0.1 })]);
    const cards = Array.from(host.querySelectorAll('.job-card'));
    expect(cards.map(card => card.querySelector('.status-badge')!.textContent)).toEqual(['Completed', 'Failed', 'Waiting to retry']);
    expect(cards[0].querySelector('h2')!.textContent).toBe('Fetch latest releases');
  });

  it('shows the error as the last message and the next attempt for a waiting job', async () => {
    const host = await mountJobs([job({ id: 'j2', state: 'failed', error: 'FileList answered 503' }), job({ id: 'j3', state: 'retry_wait', nextAttemptAt: '2026-10-15T09:00:00Z' })]);
    const [failed, waiting] = Array.from(host.querySelectorAll('.job-card'));
    expect(failed.querySelector('.job-message')!.textContent).toBe('FileList answered 503');
    expect(waiting.querySelector('.job-message')!.textContent).toContain('Next automatic attempt');
  });

  it('keeps the job id off the list and puts time and duration second', async () => {
    const host = await mountJobs([job({})]);
    const card = host.querySelector('.job-card')!;
    expect(card.textContent).not.toContain('job-8f31');
    expect(card.querySelector('.job-meta')!.textContent).toMatch(/^Updated .* · took 3 min$/);
  });

  it('shows progress only while a job is running', async () => {
    const host = await mountJobs([job({ id: 'a', state: 'running', progress: 0.4 }), job({ id: 'b' })]);
    const [running, done] = Array.from(host.querySelectorAll('.job-card'));
    expect(running.querySelector('progress')).not.toBeNull();
    expect(done.querySelector('progress')).toBeNull();
  });

  it('says what to do when no job matches', async () => {
    const host = await mountJobs([]);
    const empty = host.querySelector('.empty-state')!;
    expect(empty.querySelector('h2')!.textContent).toBe('No jobs found');
    expect(empty.textContent).toContain('Clear the search or state filter');
  });

  it('reveals the job id and structured logs only through Details', async () => {
    vi.spyOn(API.prototype, 'job').mockResolvedValue({ job: job({}), logs: [] });
    vi.spyOn(API.prototype, 'jobLogs').mockResolvedValue({ items: [{ id: 2, jobId: 'job-8f31-aaaa', attempt: 1, level: 'info', phase: 'fetch', message: 'Fetched 100 releases', createdAt: '2026-10-14T10:03:00Z' }], nextCursor: null, total: 1 });
    const host = await mountJobs([job({})]);
    await act(async () => { Array.from(host.querySelectorAll<HTMLButtonElement>('.job-card button')).find(button => button.textContent === 'Details')!.click() });
    await act(async () => { });
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('.job-id')!.textContent).toContain('job-8f31-aaaa');
    expect(dialog.textContent).toContain('Fetched 100 releases');
  });
});
