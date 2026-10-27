import { describe, expect, it } from 'vitest';
import { checkMaps, classify, formatTable, movesOf, resolveOn, resolveTarget, sampleStops, type DpadMap, type ElementInfo } from './model.mjs';

const el = (key: string, row: number, col: number, region = 'content'): ElementInfo => ({ key, region, row, col });

const shelf: DpadMap = {
  name: 'shelf',
  route: 'home',
  detect: '.shelf',
  regions: ['content'],
  landing: 'play',
  reach: [],
  stops: { play: { up: 'stay', down: 'posters[same]', left: 'rail', right: 'stay' } },
  groups: {
    posters: { keys: '^poster-', each: { up: 'play', down: 'tiles[same]', left: '-1', right: '+1' }, start: { left: 'rail' }, end: { right: 'stay' } },
    tiles: { keys: '^tile-', each: { up: '-row', down: '+row', left: '-1', right: '+1' }, top: { up: 'posters[same]' }, bottom: { down: 'stay' }, start: { left: 'rail' }, end: { right: 'stay' } },
  },
};

// Three posters in one row; a 2+2+1 grid of tiles.
const screen = [el('play', 1, 0), el('poster-a', 3, 0), el('poster-b', 3, 1), el('poster-c', 3, 2),
  el('tile-1', 10, 0), el('tile-2', 10, 1), el('tile-3', 11, 0), el('tile-4', 11, 1), el('tile-5', 12, 0), el('menu-home', 0, 0, 'sidebar')];

describe('declared D-pad maps', () => {
  it('names literal stops by key and list members by position, ignoring other regions', () => {
    const layout = classify(shelf, screen);
    expect(layout.stops.map(stop => stop.id)).toEqual(['play', 'posters[0]', 'posters[1]', 'posters[2]', 'tiles[0]', 'tiles[1]', 'tiles[2]', 'tiles[3]', 'tiles[4]']);
    expect(layout.groups.tiles.lines.map(line => line.length)).toEqual([2, 2, 1]);
    expect(layout.unmapped).toEqual([]);
  });

  it('reports a stop no rule names', () => {
    const layout = classify(shelf, [...screen, el('promo', 95, 0)]);
    expect(layout.unmapped.map(item => item.key)).toEqual(['promo']);
  });

  it('merges a member’s rules by its place in the list', () => {
    const layout = classify(shelf, screen);
    const at = (id: string) => layout.stops.find(stop => stop.id === id)!;
    expect(movesOf(shelf, layout, at('posters[0]'))).toEqual({ up: 'play', down: 'tiles[same]', left: 'rail', right: '+1' });
    expect(movesOf(shelf, layout, at('posters[2]'))).toEqual({ up: 'play', down: 'tiles[same]', left: '-1', right: 'stay' });
    // tile-5 is alone on the last line: it is both the start and the end of it.
    expect(movesOf(shelf, layout, at('tiles[4]'))).toEqual({ up: '-row', down: 'stay', left: 'rail', right: 'stay' });
  });

  it('resolves relative, same-position and cross-screen targets to stops', () => {
    const layout = classify(shelf, screen);
    const at = (id: string) => layout.stops.find(stop => stop.id === id)!;
    expect(resolveTarget(shelf, layout, at('posters[1]'), '+1', 'right')).toEqual({ screen: 'shelf', stop: 'posters[2]' });
    // Down from the third poster: the tile grid's first line has two, so the second tile.
    expect(resolveTarget(shelf, layout, at('posters[2]'), 'tiles[same]', 'down')).toEqual({ screen: 'shelf', stop: 'tiles[1]' });
    // Up from the grid's top line keeps the column.
    expect(resolveTarget(shelf, layout, at('tiles[1]'), 'posters[same]', 'up')).toEqual({ screen: 'shelf', stop: 'posters[1]' });
    // Down from the second column of line two clamps into the one-tile last line.
    expect(resolveTarget(shelf, layout, at('tiles[3]'), '+row', 'down')).toEqual({ screen: 'shelf', stop: 'tiles[4]' });
    expect(resolveTarget(shelf, layout, at('play'), 'stay', 'up')).toEqual({ screen: 'shelf', stop: 'play' });
    expect(resolveTarget(shelf, layout, at('play'), 'rail', 'left')).toEqual({ screen: 'rail', token: 'menu-home' });
    // A tab of a hub opens the rail on the hub's item, not on a rail item named like the route.
    expect(resolveTarget({ ...shelf, route: 'watched', hub: 'library' }, layout, at('play'), 'rail', 'left')).toEqual({ screen: 'rail', token: 'menu-library' });
    expect(resolveTarget(shelf, layout, at('play'), 'title:detail-back', 'ok')).toEqual({ screen: 'title', token: 'detail-back' });
  });

  it('keeps the data-focus-col on vertical moves, so Delete goes to the Delete below it', () => {
    const list: DpadMap = { name: 'list', detect: '.list', regions: ['content'], landing: 'actions[first]', reach: [],
      groups: { actions: { keys: '^dl-', each: { up: '-row', down: '+row', left: '-1', right: '+1' } } } };
    // The first download can pause (col 1); the second cannot, so its Delete sits second on screen.
    const layout = classify(list, [el('dl-1-play', 2, 0), el('dl-1-pause', 2, 1), el('dl-1-delete', 2, 2), el('dl-2-play', 22, 0), el('dl-2-delete', 22, 2)]);
    const at = (key: string) => layout.stops.find(stop => stop.element.key === key)!;
    const below = (key: string) => layout.stops.find(stop => stop.id === resolveTarget(list, layout, at(key), '+row', 'down').stop)!.element.key;
    expect(below('dl-1-delete')).toBe('dl-2-delete');
    // Pause has no counterpart: the nearer column wins, the earlier one on a tie.
    expect(below('dl-1-pause')).toBe('dl-2-play');
  });

  it('passes through a list that is not on screen, and names list members by their focus key', () => {
    const search: DpadMap = { name: 'search', route: 'search', detect: '.search', regions: ['content'], landing: 'field[first]', reach: [],
      groups: {
        field: { keys: '^search-', each: { up: 'stay', down: 'recent[same]', left: '-1', right: '+1' } },
        recent: { keys: '^recent-', optional: true, each: { up: 'field[same]', down: 'results[same]', left: '-1', right: '+1' } },
        results: { keys: '^title-', each: { up: 'recent[same]', down: 'stay', left: '-1', right: '+1' } },
      } };
    const layout = classify(search, [el('search-input', 1, 0), el('title-a', 10, 0), el('title-b', 10, 1)]);
    const field = layout.stops.find(stop => stop.id === 'field[0]')!;
    expect(resolveTarget(search, layout, field, 'recent[same]', 'down')).toEqual({ screen: 'search', stop: 'results[0]' });
    expect(resolveTarget(search, layout, layout.stops.find(stop => stop.id === 'results[1]')!, 'recent[same]', 'up')).toEqual({ screen: 'search', stop: 'field[0]' });
    expect(resolveOn(search, layout, 'title-b')).toBe('results[1]');
  });

  it('finds the member drawn as current', () => {
    const tabs: DpadMap = { name: 'tabs', detect: '.tabs', regions: ['content'], landing: 'seasons[selected]', reach: [], groups: { seasons: { keys: '^season-', each: { up: 'stay', down: 'stay', left: '-1', right: '+1' } } } };
    const layout = classify(tabs, [el('season-1', 2, 0), { ...el('season-2', 2, 1), selected: true }]);
    expect(resolveOn(tabs, layout, 'seasons[selected]')).toBe('seasons[1]');
  });

  it('presses keys on both ends and the middle of every list, and on each line end of a grid', () => {
    const layout = classify(shelf, screen);
    expect(sampleStops(shelf, layout).map(stop => stop.id)).toEqual(['play', 'posters[0]', 'posters[1]', 'posters[2]', 'tiles[0]', 'tiles[1]', 'tiles[2]', 'tiles[3]', 'tiles[4]']);
  });

  it('finds mistakes in the maps themselves', () => {
    const broken: DpadMap = { ...shelf, stops: { play: { up: 'stay', down: 'nowhere', left: 'rail' } } };
    expect(checkMaps([broken])).toEqual([
      'map shelf: stop play does not say where right goes',
      'map shelf: stop play down -> nowhere: no such stop or group',
    ]);
    expect(checkMaps([{ ...shelf, route: undefined }])).toContain('map shelf: stop play left -> rail: needs map.route');
    expect(checkMaps([shelf])).toEqual([]);
  });

  it('prints a readable table', () => {
    expect(formatTable([['stop', 'key'], ['play', 'down']])).toBe('stop  key\n----  ----\nplay  down');
  });
});
