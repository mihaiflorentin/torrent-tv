// Settings and the screens reached from it (Background jobs, Other projects). See ../model.mjs for the map format.
import { lines, onRoute, row } from './common.mjs';

// Background jobs and Other projects left the rail: they belong to the Settings hub, and Back returns to their entry there.
const FROM_SETTINGS = { hub: 'settings', regions: ['content'] };
// Background jobs and Other projects are opened from their entry in Settings > Background jobs and > Other projects.

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
    filters: { ...row('^jobs-', { up: 'stay', down: 'list[same]' }), first: { back: 'settings-background-jobs:settings-jobs' } },
    list: { ...lines(JOB, { up: 'filters[same]', down: 'stay' }), first: { back: 'settings-background-jobs:settings-jobs' } },
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

// Settings in two panes (#60): the group list ("settings-group-<id>", focus region "settings-groups") on the left,
// the selected group's rows (region "content", one column, the connection tests four to a line) on the right.
// Up/Down walk the groups and stop at both ends without changing the pane; OK or Right opens the focused group
// and puts the cursor on its first row; Left and Back from a group open the rail. In the rows, Up/Down walk the
// rows and stop at both ends, and Left (from the first column) and Back return to the selected group.
const PANES = [
  ['playback', 'settings'], ['trackers', 'settings-trackers'], ['catalog', 'settings-catalog'], ['server', 'settings-server'],
  ['jobs', 'settings-background-jobs'], ['updates', 'settings-updates'], ['projects', 'settings-other-projects'], ['danger', 'settings-danger-zone'],
];
const groupKey = id => `settings-group-${id}`;
const paneOf = name => PANES.find(([, map]) => map === name)[0];
const openPane = id => [{ go: 'settings' }, { focus: `[data-focus-key="${groupKey(id)}"]` }, { press: 'enter' }];

// The group list as literal stops: each opens its own pane, and Other projects is listed only while the server
// publishes links (the fixture does).
const GROUP_STOPS = Object.fromEntries(PANES.map(([id, map], index) => {
  const target = map === 'settings' ? 'rows[first]' : `${map}:rows[first]`;
  return [groupKey(id), {
    optional: id === 'projects',
    up: index === 0 ? 'stay' : groupKey(PANES[index - 1][0]),
    down: index === PANES.length - 1 ? 'stay' : groupKey(PANES[index + 1][0]),
    left: 'rail', right: target, ok: target, back: 'rail',
  }];
}));

/** One pane's rows: a column of rows (Up/Down stop at both ends); Left from the first column and Back return to the group. */
const paneRows = (name, keys, rest = {}) => {
  const group = name === 'settings' ? groupKey('playback') : `settings:${groupKey(paneOf(name))}`;
  return { keys, each: { up: '-row', down: '+row', left: '-1', right: '+1', back: group }, top: { up: 'stay' }, bottom: { down: 'stay' }, start: { left: group }, end: { right: 'stay' }, ...rest };
};

const pane = (name, keys, notes, extra = {}) => ({
  name,
  route: 'settings',
  notes,
  detect: [onRoute('settings'), `[data-settings-pane="${paneOf(name)}"]`],
  regions: ['content'],
  reach: openPane(paneOf(name)),
  landing: 'rows[first]',
  stops: {},
  groups: { rows: paneRows(name, keys) },
  ...extra,
});

export const settings = {
  name: 'settings',
  route: 'settings',
  notes: 'Settings, Playback open (where Settings lands): the group list and the Playback rows (audio, subtitle and fallback languages, watched threshold, Save). Focus lands on the first row.',
  // Any pane: a row's Back or Left lands on the group list, which this map owns (the panes are told apart first).
  detect: onRoute('settings'),
  regions: ['settings-groups', 'content'],
  reach: [{ go: 'settings' }],
  landing: 'rows[first]',
  stops: GROUP_STOPS,
  groups: { rows: paneRows('settings', '^(setting-(audio|subtitle|watched)-?|settings-(save|retry)$)', { sample: 'all' }) },
  bursts: [{ from: 'rows[first]', key: 'down', expect: 'rows[last]' }, { from: 'rows[last]', key: 'up', expect: 'rows[first]' }, { from: groupKey('playback'), key: 'down', expect: groupKey('danger') }],
};

const settingsTrackers = pane('settings-trackers', '^(setting-(filelist|piratebay)-|settings-(save|retry)$)', 'Settings > Trackers: the FileList and Pirate Bay switches, the Pirate Bay addresses, Save.');
const settingsCatalog = pane('settings-catalog', '^catalog-fetch-latest$', 'Settings > Catalog: the release counts and Fetch latest.');
const settingsServer = pane('settings-server', '^(settings-reload|change-server|forget-server|settings-diagnostics)$', 'Settings > Server: Reload library, Change server address, Forget this server, and the Connection tests disclosure (closed).');
const settingsBackgroundJobs = pane('settings-background-jobs', '^(settings-jobs|setting-workers|setting-title-timeout|settings-(save|retry))$', 'Settings > Background jobs: the Background jobs screen entry, the two background-work limits, Save.');
const settingsUpdates = pane('settings-updates', '^update-', 'Settings > Updates: Check for updates, the release link while a notice shows, Install server update when one can be installed.');
const settingsOtherProjects = pane('settings-other-projects', '^settings-projects$', 'Settings > Other projects: the Other projects screen entry.');
const settingsDangerZone = pane('settings-danger-zone', '^catalog-rebuild$', 'Settings > Danger zone: Rebuild catalog, which asks first.');

export const settingsDiagnostics = {
  name: 'settings-diagnostics',
  route: 'settings',
  notes: 'Settings > Server with Connection tests open: the tests sit four to a line below the disclosure.',
  detect: [onRoute('settings'), '[data-focus-key^="test-"]'],
  regions: ['content'],
  reach: [...openPane('server'), { focus: '[data-focus-key="settings-diagnostics"]' }, { press: 'enter' }],
  landing: 'settings-diagnostics',
  settleMs: 900,
  stops: {
    'settings-diagnostics': { up: 'rows[last]', down: 'tests[first]', left: `settings:${groupKey('server')}`, right: 'stay', back: `settings:${groupKey('server')}` },
  },
  groups: {
    rows: paneRows('settings-server', '^(settings-reload|change-server|forget-server)$', { bottom: { down: 'settings-diagnostics' } }),
    tests: paneRows('settings-server', '^test-', { top: { up: 'settings-diagnostics' } }),
  },
};

export const rebuildDialog = {
  name: 'rebuild-dialog',
  notes: 'Rebuild catalog confirmation: Cancel first; Back cancels and returns to the Rebuild button.',
  detect: '.tv-rebuild-confirm',
  regions: ['rebuild-dialog'],
  reach: [...openPane('danger'), { focus: '[data-focus-key="catalog-rebuild"]' }, { press: 'enter' }],
  opener: 'settings-danger-zone:catalog-rebuild',
  landing: 'rebuild-confirm-cancel',
  stops: {
    'rebuild-confirm-cancel': { up: 'stay', down: 'stay', left: 'stay', right: 'rebuild-confirm-apply', back: 'return' },
    'rebuild-confirm-apply': { up: 'stay', down: 'stay', left: 'rebuild-confirm-cancel', right: 'stay', back: 'return' },
  },
};

export const updateDialog = {
  name: 'update-dialog',
  notes: 'Install server update confirmation (Settings > Updates > Install server update, while an installable update is published; the audit\'s fixture publishes one): Cancel first, Install and restart beside it. Back and Cancel return to Install server update.',
  detect: '.tv-update-confirm',
  regions: ['update-dialog'],
  reach: [...openPane('updates'), { focus: '[data-focus-key="update-apply"]' }, { press: 'enter' }],
  opener: 'settings-updates:rows[last]',
  landing: 'update-confirm-cancel',
  stops: {
    'update-confirm-cancel': { up: 'stay', down: 'stay', left: 'stay', right: 'update-confirm-apply', ok: 'return', back: 'return' },
    'update-confirm-apply': { up: 'stay', down: 'stay', left: 'update-confirm-cancel', right: 'stay', back: 'return' },
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
  groups: { links: { ...lines('^project-', { up: 'stay', down: 'stay' }), first: { back: 'settings-other-projects:settings-projects' } } },
};

export const setup = {
  name: 'setup',
  notes: 'Server setup (no server saved; here reached through Settings > Forget server): Rescan and Enter address, the servers found, the address field and Connect. Back leaves manual entry or exits the app, so it is not pressed here.',
  detect: 'main.setup',
  noExit: 'the only ways off Setup are connecting to a server and Back, which exits the app',
  regions: ['setup'],
  reach: [...openPane('server'), { focus: '[data-focus-key="forget-server"]' }, { press: 'enter' }, { wait: 1000 }],
  landing: 'modes[first]',
  stops: {},
  groups: {
    modes: { keys: '^setup-(rescan|manual)$', each: { up: 'stay', down: 'found[same]', left: '-1', right: '+1' }, start: { left: 'stay' }, end: { right: 'stay' } },
    found: { keys: '^discovered-server-', optional: true, each: { up: '-1', down: '+1', left: 'stay', right: 'stay' }, first: { up: 'modes[same]' }, last: { down: 'address[same]' } },
    address: { keys: '^setup-(address|connect|forget)$', each: { up: 'found[same]', down: 'stay', left: '-1', right: '+1' }, start: { left: 'stay' }, end: { right: 'stay' } },
  },
};

// The panes come before "settings" and Diagnostics before the Server pane: the more specific screen is told apart first.
export const SYSTEM_MAPS = [jobDetail, jobs, rebuildDialog, updateDialog, settingsDiagnostics, settingsTrackers, settingsCatalog, settingsServer, settingsBackgroundJobs, settingsUpdates, settingsOtherProjects, settingsDangerZone, settings, projects, setup];
