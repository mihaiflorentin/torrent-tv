// TV Settings in two panes (#60, the "Settings" board): the group list on the left and the selected
// group's rows on the right. Pure on purpose, so the group order, the control-to-group table (which
// pane a return to Settings opens) and the status beside each name are tested without a DOM.
import type { Job, TrackerStatus, UpdateStatus } from '@torrent-tv/shared';

export type SettingsGroupId = 'playback' | 'trackers' | 'catalog' | 'server' | 'jobs' | 'updates' | 'projects' | 'danger';
export interface SettingsGroup { id: SettingsGroupId; label: string }

const GROUPS: SettingsGroup[] = [
  { id: 'playback', label: 'Playback' },
  { id: 'trackers', label: 'Trackers' },
  { id: 'catalog', label: 'Catalog' },
  { id: 'server', label: 'Server' },
  { id: 'jobs', label: 'Background jobs' },
  { id: 'updates', label: 'Updates' },
  { id: 'projects', label: 'Other projects' },
  { id: 'danger', label: 'Danger zone' },
];

/** The groups in board order; Other projects only while the server publishes project links. */
export function settingsGroups(hasProjects: boolean): SettingsGroup[] {
  return GROUPS.filter(group => hasProjects || group.id !== 'projects');
}

// Which group draws a control (by its data-focus-key). Anything unknown opens on Playback.
const KEY_GROUPS: Array<[RegExp, SettingsGroupId]> = [
  [/^(settings-jobs|setting-workers|setting-title-timeout)$/, 'jobs'],
  [/^settings-projects$/, 'projects'],
  [/^catalog-rebuild$/, 'danger'],
  [/^catalog-/, 'catalog'],
  [/^(settings-reload|settings-diagnostics|change-server|forget-server|test-.+)$/, 'server'],
  [/^update-/, 'updates'],
  [/^setting-(filelist|piratebay)-/, 'trackers'],
];
export function groupOfKey(key: string): SettingsGroupId {
  const group = /^settings-group-(\w+)$/.exec(key || '');
  if (group && GROUPS.some(item => item.id === group[1])) return group[1] as SettingsGroupId;
  for (const [pattern, id] of KEY_GROUPS) if (pattern.test(key || '')) return id;
  return 'playback';
}

export interface GroupFacts {
  trackers?: TrackerStatus[] | null;
  coverage?: { observed: number; seeded: number } | null;
  host?: string;
  jobs?: Job[];
  update?: UpdateStatus | null;
}

/** The short status beside a group's name; `attention` draws it in the danger colour. An unknown fact says nothing. */
export function groupNote(id: SettingsGroupId, facts: GroupFacts): { text: string; attention: boolean } {
  const note = (text: string, attention = false) => ({ text, attention });
  switch (id) {
    case 'trackers': {
      const list = facts.trackers;
      if (!list || list.length === 0) return note('');
      if (list.some(item => item.enabled && !item.configured)) return note('Needs attention', true);
      const on = list.filter(item => item.enabled).length;
      return note(on ? `${on} on` : 'All off');
    }
    case 'catalog': return note(facts.coverage ? `${facts.coverage.observed.toLocaleString('en-US')} releases` : '');
    case 'server': return note(facts.host || '');
    case 'jobs': { const running = (facts.jobs || []).filter(job => job.state === 'running').length; return note(running ? `${running} running` : ''); }
    case 'updates': return note(!facts.update ? '' : facts.update.available && facts.update.latest ? `${facts.update.latest} available` : facts.update.currentVersion || '');
    default: return note('');
  }
}
