import { describe, expect, it } from 'vitest';
import type { Job, TrackerStatus, UpdateStatus } from '@torrent-tv/shared';
import { groupNote, groupOfKey, settingsGroups } from './settings-groups';

const job = (state: string): Job => ({ id: state, kind: 'catalog-sync', state, label: 'x', dedupeKey: state, progress: 0, attempt: 1, retryable: false, createdAt: '', updatedAt: '' });
const tracker = (enabled: boolean, configured: boolean): TrackerStatus => ({ id: String(Math.random()), name: 'T', enabled, configured } as TrackerStatus);

describe('Settings groups', () => {
  it('lists the eight groups in the board order, Other projects only while the server publishes links', () => {
    expect(settingsGroups(true).map(group => group.label)).toEqual(['Playback', 'Trackers', 'Catalog', 'Server', 'Background jobs', 'Updates', 'Other projects', 'Danger zone']);
    expect(settingsGroups(false).map(group => group.label)).toEqual(['Playback', 'Trackers', 'Catalog', 'Server', 'Background jobs', 'Updates', 'Danger zone']);
  });

  it('knows which group holds a control, so a return to Settings opens the right pane', () => {
    expect(groupOfKey('settings-jobs')).toBe('jobs');
    expect(groupOfKey('settings-projects')).toBe('projects');
    expect(groupOfKey('catalog-rebuild')).toBe('danger');
    expect(groupOfKey('catalog-fetch-latest')).toBe('catalog');
    expect(groupOfKey('change-server')).toBe('server');
    expect(groupOfKey('test-tmdb')).toBe('server');
    expect(groupOfKey('update-apply')).toBe('updates');
    expect(groupOfKey('setting-piratebay-api')).toBe('trackers');
    expect(groupOfKey('setting-workers')).toBe('jobs');
    expect(groupOfKey('settings-group-server')).toBe('server');
    expect(groupOfKey('setting-audio-primary')).toBe('playback');
    expect(groupOfKey('')).toBe('playback');
  });

  it('shows a short status beside each group name', () => {
    const facts = { trackers: [tracker(true, true), tracker(true, true)], coverage: { observed: 48210, seeded: 12000 }, host: 'pi.local:8080', jobs: [job('running'), job('running'), job('failed')], update: { currentVersion: '0.10.10', available: false } as UpdateStatus };
    expect(groupNote('playback', facts)).toEqual({ text: '', attention: false });
    expect(groupNote('trackers', facts)).toEqual({ text: '2 on', attention: false });
    expect(groupNote('catalog', facts).text).toBe('48,210 releases');
    expect(groupNote('server', facts).text).toBe('pi.local:8080');
    expect(groupNote('jobs', facts).text).toBe('2 running');
    expect(groupNote('updates', facts).text).toBe('0.10.10');
    expect(groupNote('danger', facts).text).toBe('');
  });

  it('flags a tracker that is on but not set up, and says when every tracker is off', () => {
    expect(groupNote('trackers', { trackers: [tracker(true, false), tracker(true, true)] })).toEqual({ text: 'Needs attention', attention: true });
    expect(groupNote('trackers', { trackers: [tracker(false, true), tracker(false, false)] }).text).toBe('All off');
    expect(groupNote('trackers', { trackers: null }).text).toBe('');
  });

  it('says an update is waiting, and nothing for idle jobs or unknown facts', () => {
    expect(groupNote('updates', { update: { currentVersion: '0.10.10', available: true, latest: '0.11.0' } as UpdateStatus }).text).toBe('0.11.0 available');
    expect(groupNote('jobs', { jobs: [job('completed')] }).text).toBe('');
    expect(groupNote('catalog', {}).text).toBe('');
    expect(groupNote('updates', { update: null }).text).toBe('');
  });
});
