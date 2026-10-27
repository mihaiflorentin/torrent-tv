// The declared D-pad maps (./maps) and the rules that read them. Plain JavaScript with no
// dependencies so the happy-dom tests (vitest) and the real-Chromium audit
// (tools/tv_perf/dpad.mjs) share one source of truth for where every key goes.
//
// A map describes one screen or overlay:
//   name      unique, lower-case words joined by hyphens
//   route     the rail route the screen belongs to (expected target "rail" opens the rail on it)
//   detect    CSS selector (or a list, all of them) visible only while this screen or overlay is up
//   regions   the data-focus-region values whose stops belong to this map
//   landing   the stop focus lands on when the screen opens
//   reach     how the audit gets there from Home (tools/tv_perf/journey.mjs actions)
//   opener    overlays: the screen:stop focus returns to when the overlay closes ("return")
//   stops     literal stops by data-focus-key: { up, down, left, right, ok?, back? }
//   groups    lists of like stops (a rail of posters, a grid, a column of rows), matched by a
//             data-focus-key pattern; a member is named group[i] (0-based, reading order)
//   bursts    held-key runs along a group, checked stop by stop
//   noExit    why no key leads off this screen (it is then not reported as a trap)
//
// Targets: "stay" (focus does not move), "rail" (the rail opens on map.route), "return"
// (back to map.opener), a literal stop key, a group ("posters" = its first member,
// "posters[first]", "posters[last]", "posters[2]", "posters[same]" = the stop nearest the same column in
// the nearest line of that group, "posters[selected]" = the member drawn as current: the
// active season tab, the selected episode, the rail's current route), relative moves inside the member's own group ("+1", "-1",
// "+row", "-row" = the stop nearest the same column one line down/up), or "screen:target" for a
// stop on another map (a key there opens that screen).
//
// A group with nothing on screen (a lazy rail, recent searches before the first search) is passed
// through: a move into it follows that group's own "each" move in the same direction.
//
// Group rules merge in this order, later wins: each, top, bottom, start, end, first, last
// (first/last = reading order; top/bottom = first/last line; start/end = first/last of a line).

export const DIRECTIONS = ['up', 'down', 'left', 'right'];
export const KEYS = [...DIRECTIONS, 'ok', 'back'];
const POSITIONS = ['each', 'top', 'bottom', 'start', 'end', 'first', 'last'];
const MEMBER = /^([a-z][a-z0-9-]*)\[(first|last|same|selected|\d+)\]$/;
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const finite = value => typeof value === 'number' && Number.isFinite(value);

function inGroup(group, element) {
  if (!new RegExp(group.keys).test(element.key || '')) return false;
  if (group.region && element.region !== group.region) return false;
  if (group.rows !== undefined) {
    const rows = Array.isArray(group.rows) ? group.rows : [group.rows];
    if (!rows.includes(element.row)) return false;
  }
  return true;
}

/**
 * Names every focus stop of the map among the visible focusables (DOM order).
 * elements: [{ key, region, row, col, top, left }]
 * Returns { stops: [{ id, element, group?, index?, line?, pos? }], unmapped: [element], groups: { name: Layout } }
 * where Layout = { lines: [[stop...]...], members: [stop...] }.
 */
export function classify(map, elements) {
  const regions = new Set(map.regions);
  const stops = [];
  const unmapped = [];
  const buckets = {};
  for (const element of elements) {
    if (!regions.has(element.region)) continue;
    if (element.key && map.stops && map.stops[element.key]) { stops.push({ id: element.key, element }); continue; }
    const name = Object.keys(map.groups || {}).find(group => inGroup(map.groups[group], element));
    if (name) (buckets[name] = buckets[name] || []).push(element);
    else unmapped.push(element);
  }
  const groups = {};
  for (const [name, members] of Object.entries(buckets)) {
    const lineOf = element => (finite(element.row) ? element.row : Math.round(element.top || 0));
    const posOf = element => (finite(element.col) ? element.col : element.left || 0);
    const values = [...new Set(members.map(lineOf))].sort((a, b) => a - b);
    const lines = values.map(value => members.filter(element => lineOf(element) === value).sort((a, b) => posOf(a) - posOf(b)));
    const ordered = [];
    lines.forEach((line, lineIndex) => line.forEach((element, pos) => ordered.push({ id: '', element, group: name, line: lineIndex, pos })));
    ordered.forEach((stop, index) => { stop.index = index; stop.id = `${name}[${index}]`; });
    groups[name] = { members: ordered, lines: lines.map((_, lineIndex) => ordered.filter(stop => stop.line === lineIndex)) };
    stops.push(...ordered);
  }
  return { stops, unmapped, groups };
}

/** The member stops the audit presses keys on: every literal stop, and first, second, middle, second-to-last and last of each group (or all when the group asks). */
export function sampleStops(map, layout) {
  const literal = layout.stops.filter(stop => !stop.group);
  const picked = [];
  for (const [name, group] of Object.entries(layout.groups)) {
    const n = group.members.length;
    const all = map.groups[name].sample === 'all';
    const indexes = all ? group.members.map((_, i) => i) : [...new Set([0, 1, Math.floor((n - 1) / 2), n - 2, n - 1])].filter(i => i >= 0 && i < n);
    // In a grid the ends of the lines matter too: both ends of the first two, middle and last two lines.
    const L = group.lines.length;
    if (!all && L > 1) for (const l of new Set([0, 1, Math.floor((L - 1) / 2), L - 2, L - 1])) { const line = group.lines[l]; indexes.push(line[0].index, line[line.length - 1].index); }
    for (const i of [...new Set(indexes)].sort((a, b) => a - b)) picked.push(group.members[i]);
  }
  return [...literal, ...picked];
}

/** The declared moves for one stop: the literal entry, or its group's rules merged for the member's position. */
export function movesOf(map, layout, stop) {
  if (!stop.group) return map.stops[stop.id];
  const group = map.groups[stop.group];
  const { lines } = layout.groups[stop.group];
  const line = lines[stop.line];
  const n = layout.groups[stop.group].members.length;
  const applies = {
    each: true,
    top: stop.line === 0,
    bottom: stop.line === lines.length - 1,
    start: stop.pos === 0,
    end: stop.pos === line.length - 1,
    first: stop.index === 0,
    last: stop.index === n - 1,
  };
  const moves = {};
  for (const position of POSITIONS) if (applies[position] && group[position]) Object.assign(moves, group[position]);
  return moves;
}

// The column a stop sits in: its data-focus-col when it has one, else its place in its line.
const columnOf = stop => (stop && finite(stop.element.col) ? stop.element.col : stop && stop.pos !== undefined ? stop.pos : 0);

/** The stop of a line nearest the column of `from` (vertical moves keep the column, clamped; a tie takes the earlier). */
function nearestColumn(line, from) {
  const column = columnOf(from);
  let best = line[0];
  for (const stop of line) if (Math.abs(columnOf(stop) - column) < Math.abs(columnOf(best) - column)) best = stop;
  return best;
}

function memberAt(layout, name, which, from, direction) {
  const group = layout.groups[name];
  if (!group || !group.members.length) return null;
  if (which === 'first') return group.members[0].id;
  if (which === 'last') return group.members[group.members.length - 1].id;
  if (which === 'selected') {
    // The member drawn as the current one (the active season tab, the selected episode, the current route).
    const selected = group.members.find(stop => stop.element.selected);
    return selected ? selected.id : null;
  }
  if (which === 'same') {
    // Entering from above lands in the group's first line, from below in its last.
    const line = direction === 'up' ? group.lines[group.lines.length - 1] : group.lines[0];
    return nearestColumn(line, from).id;
  }
  const index = Number(which);
  return group.members[Math.min(index, group.members.length - 1)].id;
}

/**
 * Resolves a declared target for a stop of `map` (layout from classify) to
 * { screen, stop } where stop is a stop id on that screen, or { screen, token } when the
 * target lives on another screen and is resolved once that screen is up (resolveOn).
 */
export function resolveTarget(map, layout, stop, token, direction) {
  if (token === 'stay') return { screen: map.name, stop: stop.id };
  if (token === 'rail') return { screen: 'rail', token: `menu-${map.route}` };
  if (token === 'return') { const [screen, target] = splitScreen(map.opener); return { screen, token: target }; }
  if (token.includes(':')) { const [screen, target] = splitScreen(token); return { screen, token: target }; }
  if (/^[+-](1|row)$/.test(token)) {
    const group = layout.groups[stop.group];
    if (token === '+1' || token === '-1') {
      const index = stop.index + (token === '+1' ? 1 : -1);
      return { screen: map.name, stop: group.members[Math.max(0, Math.min(index, group.members.length - 1))].id };
    }
    const line = group.lines[Math.max(0, Math.min(stop.line + (token === '+row' ? 1 : -1), group.lines.length - 1))];
    return { screen: map.name, stop: nearestColumn(line, stop).id };
  }
  return { screen: map.name, stop: resolveOn(map, layout, token, stop, direction) };
}

/** A target token on `map` as a stop id there (null when the screen has no such stop right now). */
export function resolveOn(map, layout, token, from, direction, depth = 0) {
  const member = MEMBER.exec(token);
  const name = member ? member[1] : map.groups && map.groups[token] ? token : null;
  if (!name) {
    // An optional literal stop that is not drawn is passed through the same way.
    const literal = map.stops && map.stops[token];
    const drawn = layout.stops.some(stop => stop.id === token);
    if (literal && literal.optional && !drawn && direction && literal[direction] && depth < 8)
      return literal[direction] === 'stay' ? (from ? from.id : null) : resolveOn(map, layout, literal[direction], from, direction, depth + 1);
    // A plain data-focus-key names the stop that carries it (a list member included: "menu-search").
    const keyed = !literal && layout.stops.find(stop => stop.element.key === token);
    return keyed ? keyed.id : token;
  }
  // An optional group with nothing on screen is passed through: its own move in the same direction.
  const empty = !layout.groups[name] || !layout.groups[name].members.length;
  const group = map.groups[name];
  // The way out of the group in that direction: its edge rules (top/bottom/start/end, first/last), else "each", never a move inside it.
  const edges = { up: ['top', 'first'], down: ['bottom', 'last'], left: ['start', 'first'], right: ['end', 'last'] }[direction] || [];
  const next = group && [...edges.map(edge => group[edge]), group.each].map(moves => moves && moves[direction]).find(t => t && !/^[+-](1|row)$/.test(t));
  if (empty && next && depth < 8) {
    return next === 'stay' ? (from ? from.id : null) : resolveOn(map, layout, next, from, direction, depth + 1);
  }
  return memberAt(layout, name, member ? member[2] : 'first', from, direction);
}

function splitScreen(token) {
  const at = token.indexOf(':');
  return [token.slice(0, at), token.slice(at + 1)];
}

/** Lists what is wrong with the maps themselves (unknown targets, missing directions); [] when sound. */
export function checkMaps(maps) {
  const problems = [];
  const names = new Map(maps.map(map => [map.name, map]));
  if (names.size !== maps.length) problems.push('two maps share a name');
  const known = (map, token) => {
    if (token === 'stay') return true;
    if (token === 'rail') return Boolean(map.route) || 'needs map.route';
    if (token === 'return') return Boolean(map.opener && names.has(splitScreen(map.opener)[0])) || 'needs map.opener naming a map';
    if (/^[+-](1|row)$/.test(token)) return true;
    if (token.includes(':')) {
      const [screen, target] = splitScreen(token);
      const other = names.get(screen);
      if (!other) return `no map named ${screen}`;
      return knownStop(other, target) || `${screen} has no stop ${target}`;
    }
    return knownStop(map, token) || 'no such stop or group';
  };
  for (const map of maps) {
    const where = `map ${map.name}`;
    if (!NAME.test(map.name || '')) problems.push(`${where}: name must be lower-case words joined by hyphens`);
    if (!map.detect || ![].concat(map.detect).every(selector => typeof selector === 'string' && selector)) problems.push(`${where}: no detect selector`);
    if (!Array.isArray(map.regions) || !map.regions.length) problems.push(`${where}: no regions`);
    if (!map.landing || !knownStop(map, map.landing)) problems.push(`${where}: landing ${map.landing} is not a stop of the map`);
    if (!Array.isArray(map.reach)) problems.push(`${where}: no reach actions`);
    const entries = [...Object.entries(map.stops || {}).map(([key, moves]) => [`stop ${key}`, moves, true])];
    for (const [name, group] of Object.entries(map.groups || {})) {
      if (!NAME.test(name)) problems.push(`${where}: group name ${name} must be lower-case words joined by hyphens`);
      if (!group.keys) problems.push(`${where}: group ${name} has no keys pattern`);
      for (const position of Object.keys(group)) if (!POSITIONS.includes(position) && !['keys', 'rows', 'region', 'sample', 'optional'].includes(position)) problems.push(`${where}: group ${name} has unknown field ${position}`);
      for (const position of POSITIONS) if (group[position]) entries.push([`group ${name}.${position}`, group[position], position === 'each']);
    }
    for (const [label, moves, complete] of entries) {
      for (const key of Object.keys(moves)) if (!KEYS.includes(key) && key !== 'optional') problems.push(`${where}: ${label} has unknown key ${key}`);
      if (complete) for (const direction of DIRECTIONS) if (!moves[direction]) problems.push(`${where}: ${label} does not say where ${direction} goes`);
      for (const [key, token] of Object.entries(moves)) {
        if (key === 'optional') continue;
        if (typeof token !== 'string') { problems.push(`${where}: ${label} ${key} must be a string`); continue; }
        if (/^[+-](1|row)$/.test(token) && label.startsWith('stop ')) problems.push(`${where}: ${label} ${key}: ${token} only works inside a group`);
        const ok = known(map, token);
        if (ok !== true) problems.push(`${where}: ${label} ${key} -> ${token}: ${ok}`);
      }
    }
    for (const burst of map.bursts || []) {
      if (!DIRECTIONS.includes(burst.key)) problems.push(`${where}: burst key ${burst.key}`);
      for (const token of [burst.from, burst.expect].filter(Boolean)) if (!knownStop(map, token)) problems.push(`${where}: burst stop ${token} is not a stop of the map`);
    }
  }
  return problems;
}

function knownStop(map, token) {
  if (map.stops && map.stops[token]) return true;
  if (map.groups && map.groups[token]) return true;
  const member = MEMBER.exec(token);
  if (member) return Boolean(map.groups && map.groups[member[1]]);
  // A data-focus-key one of the map's lists would name ("player-audio" on the toolbar).
  return Object.values(map.groups || {}).some(group => new RegExp(group.keys).test(token));
}

/** Fixed-width text table: rows of equal-length string arrays, the first being the header. */
export function formatTable(rows) {
  if (!rows.length) return '';
  const widths = rows[0].map((_, column) => Math.max(...rows.map(row => String(row[column]).length)));
  const line = row => row.map((cell, column) => String(cell).padEnd(widths[column])).join('  ').trimEnd();
  return [line(rows[0]), widths.map(width => '-'.repeat(width)).join('  '), ...rows.slice(1).map(line)].join('\n');
}
