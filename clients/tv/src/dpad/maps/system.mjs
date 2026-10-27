// Settings and the screens reached from it (Background jobs, Other projects). See ../model.mjs for the map format.
import { lines, onRoute, row } from './common.mjs';

// Background jobs and Other projects left the rail: they belong to the Settings hub, and Back returns to their entry there.
const FROM_SETTINGS = { hub: 'settings', regions: ['content'] };

// A job row is "job-<id>" and its Retry button "job-<id>-retry"; the filters are "jobs-*".
const JOB = '^job-(?!detail-back$|log-|logs-)';

export const jobs = {
  name: 'jobs',
  route: 'jobs',
  ...FROM_SETTINGS,
  notes: 'Background jobs (Settings > Background jobs): search and filter cycles, then one line per job (the job, its Retry when retryable). Down near the end pages more in. Back returns to the Background jobs entry in Settings.',
  detect: [onRoute('jobs'), '[data-focus-key="jobs-search"]'],
  reach: [{ go: 'jobs' }],
  landing: 'list[first]',
  stops: {},
  groups: {
    filters: { ...row('^jobs-', { up: 'stay', down: 'list[same]' }), first: { back: 'settings:settings-jobs' } },
    list: { ...lines(JOB, { up: 'filters[same]', down: 'stay' }), first: { back: 'settings:settings-jobs' } },
  },
  bursts: [{ from: 'list[first]', key: 'down', presses: 14 }],
};

export const jobDetail = {
  name: 'job-detail',
  route: 'jobs',
  ...FROM_SETTINGS,
  notes: 'A job\'s detail: the back-to-Jobs button, the log filters, the log entries. It opens on the back-to-Jobs button; Back (or the back-to-Jobs button) returns to the job row it was opened from.',
  detect: [onRoute('jobs'), '[data-focus-key="job-detail-back"]'],
  reach: [{ go: 'jobs' }, { focus: '[data-focus-key^="job-job-"]' }, { press: 'enter' }],
  landing: 'job-detail-back',
  stops: {
    // Back closes the detail first, from any stop.
    'job-detail-back': { up: 'stay', down: 'filters[first]', left: 'rail', right: 'stay', back: 'jobs:list[first]', ok: 'jobs:list[first]' },
    'job-logs-older': { optional: true, up: 'logs[last]', down: 'stay', left: 'rail', right: 'stay' },
  },
  groups: {
    filters: row('^log-(level|attempt)$', { up: 'job-detail-back', down: 'logs[first]' }),
    logs: lines('^job-log-', { up: 'filters[first]', down: 'job-logs-older' }),
  },
  bursts: [{ from: 'logs[first]', key: 'down', expect: 'logs[last]' }],
};

// The Settings page is one column; "settings-diagnostics" opens the connection tests below it.
const SETTINGS = '^(setting-|settings-(save|diagnostics|jobs|projects|reload)$|update-|catalog-|change-server$|forget-server$)';

export const settings = {
  name: 'settings',
  route: 'settings',
  notes: 'Settings: one column of fields and actions top to bottom (Playback, Background work, trackers, Save, Updates, Diagnostics, Catalog, Background jobs and Other projects, Server with Reload library, Danger zone). Left opens the rail from every row.',
  detect: onRoute('settings'),
  regions: ['content'],
  reach: [{ go: 'settings' }],
  landing: 'list[first]',
  stops: {},
  groups: { list: lines(SETTINGS, { up: 'stay', down: 'stay', sample: 'all' }) },
  bursts: [{ from: 'list[first]', key: 'down', expect: 'list[last]' }, { from: 'list[last]', key: 'up', expect: 'list[first]' }],
};

export const settingsDiagnostics = {
  name: 'settings-diagnostics',
  route: 'settings',
  notes: 'Settings with Diagnostics open: the connection tests sit four to a line between Diagnostics and the Catalog actions.',
  detect: [onRoute('settings'), '[data-focus-key^="test-"]'],
  regions: ['content'],
  reach: [{ go: 'settings' }, { focus: '[data-focus-key="settings-diagnostics"]' }, { press: 'enter' }],
  landing: 'settings-diagnostics',
  settleMs: 900,
  stops: {
    'settings-diagnostics': { up: 'list[same]', down: 'tests[first]', left: 'rail', right: 'stay' },
  },
  groups: {
    list: lines('^(setting-|settings-save$|update-)', { up: 'stay', down: 'settings-diagnostics' }),
    tests: lines('^test-', { up: 'settings-diagnostics', down: 'below[first]' }),
    below: lines('^(catalog-|settings-(jobs|projects|reload)$|change-server$|forget-server$)', { up: 'tests[same]', down: 'stay' }),
  },
};

export const rebuildDialog = {
  name: 'rebuild-dialog',
  notes: 'Rebuild catalog confirmation: Cancel first; Back cancels and returns to the Rebuild button.',
  detect: '.tv-rebuild-confirm',
  regions: ['rebuild-dialog'],
  reach: [{ go: 'settings' }, { focus: '[data-focus-key="catalog-rebuild"]' }, { press: 'enter' }],
  opener: 'settings:list[last]',
  landing: 'rebuild-confirm-cancel',
  stops: {
    'rebuild-confirm-cancel': { up: 'stay', down: 'stay', left: 'stay', right: 'rebuild-confirm-apply', back: 'return' },
    'rebuild-confirm-apply': { up: 'stay', down: 'stay', left: 'rebuild-confirm-cancel', right: 'stay', back: 'return' },
  },
};

export const projects = {
  name: 'projects',
  route: 'projects',
  ...FROM_SETTINGS,
  notes: 'Other projects (Settings > Other projects): one link per line. Back returns to the Other projects entry in Settings.',
  detect: onRoute('projects'),
  reach: [{ go: 'projects' }],
  landing: 'links[first]',
  stops: {},
  groups: { links: { ...lines('^project-', { up: 'stay', down: 'stay' }), first: { back: 'settings:settings-projects' } } },
};

export const setup = {
  name: 'setup',
  notes: 'Server setup (no server saved; here reached through Settings > Forget server): Rescan and Enter address, the servers found, the address field and Connect. Back leaves manual entry or exits the app, so it is not pressed here.',
  detect: 'main.setup',
  noExit: 'the only ways off Setup are connecting to a server and Back, which exits the app',
  regions: ['setup'],
  reach: [{ go: 'settings' }, { focus: '[data-focus-key="forget-server"]' }, { press: 'enter' }, { wait: 1000 }],
  landing: 'modes[first]',
  stops: {},
  groups: {
    modes: { keys: '^setup-(rescan|manual)$', each: { up: 'stay', down: 'found[same]', left: '-1', right: '+1' }, start: { left: 'stay' }, end: { right: 'stay' } },
    found: { keys: '^discovered-server-', optional: true, each: { up: '-1', down: '+1', left: 'stay', right: 'stay' }, first: { up: 'modes[same]' }, last: { down: 'address[same]' } },
    address: { keys: '^setup-(address|connect|forget)$', each: { up: 'found[same]', down: 'stay', left: '-1', right: '+1' }, start: { left: 'stay' }, end: { right: 'stay' } },
  },
};

export const SYSTEM_MAPS = [jobDetail, jobs, settingsDiagnostics, rebuildDialog, settings, projects, setup];
