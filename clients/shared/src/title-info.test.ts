import { afterEach, describe, expect, it, vi } from 'vitest';
import { API, castInitials, episodeAirLabel, episodePageView, episodeRowLine, episodeRowView, episodeView, formatRuntime, formatShortDate, infoCrumbs, infoEpisodeCode, infoView, releaseLine, seasonCardView, seasonDetailView, seasonLabel } from '@torrent-tv/shared';
import type { TitleInfo } from '@torrent-tv/shared';

// Info panel and listing release-date decisions both clients share. Manual month names: Tizen 5 and webOS 4 ship limited Intl.

describe('formatShortDate', () => {
  it('writes a compact English date without Intl', () => {
    expect(formatShortDate('2024-03-14')).toBe('Mar 14, 2024');
    expect(formatShortDate('1999-12-01')).toBe('Dec 1, 1999');
  });
  it('accepts a datetime and refuses malformed input', () => {
    expect(formatShortDate('2013-04-07T00:00:00+00:00')).toBe('Apr 7, 2013');
    expect(formatShortDate('2013-13-07')).toBe('');
    expect(formatShortDate('soon')).toBe('');
    expect(formatShortDate(undefined)).toBe('');
  });
});

describe('releaseLine', () => {
  it('shows a movie full date when known, else the year', () => {
    expect(releaseLine({ kind: 'movie', year: 2024, releaseDate: '2024-03-14' })).toBe('Mar 14, 2024');
    expect(releaseLine({ kind: 'movie', year: 2024 })).toBe('2024');
  });
  it('shows a series as Since its first-air year', () => {
    expect(releaseLine({ kind: 'series', year: 2019, releaseDate: '2019-01-02' })).toBe('Since 2019');
    expect(releaseLine({ kind: 'series', year: 2019 })).toBe('Since 2019');
  });
  it('shortens a movie date to month and year for narrow poster cards', () => {
    expect(releaseLine({ kind: 'movie', year: 2024, releaseDate: '2024-03-14' }, { compact: true })).toBe('Mar 2024');
    expect(releaseLine({ kind: 'movie', year: 2024 }, { compact: true })).toBe('2024');
    expect(releaseLine({ kind: 'series', year: 2019, releaseDate: '2019-01-02' }, { compact: true })).toBe('Since 2019');
  });
  it('is empty when nothing is known', () => {
    expect(releaseLine({ kind: 'movie' })).toBe('');
  });
});

describe('episodeAirLabel', () => {
  const now = new Date(2026, 5, 15);
  it('shows an aired date compactly', () => expect(episodeAirLabel('2017-05-06', now)).toBe('May 6, 2017'));
  it('marks a future date Upcoming', () => expect(episodeAirLabel('2026-07-01', now)).toBe('Upcoming · Jul 1, 2026'));
  it('treats today as aired and an unknown date as empty', () => {
    expect(episodeAirLabel('2026-06-15', now)).toBe('Jun 15, 2026');
    expect(episodeAirLabel(undefined, now)).toBe('');
  });
});

describe('formatRuntime and castInitials', () => {
  it('formats minutes as hours and minutes', () => {
    expect(formatRuntime(136)).toBe('2 h 16 min');
    expect(formatRuntime(120)).toBe('2 h');
    expect(formatRuntime(45)).toBe('45 min');
    expect(formatRuntime(0)).toBe('');
  });
  it('takes at most two initials', () => {
    expect(castInitials('Keanu Reeves')).toBe('KR');
    expect(castInitials('Cher')).toBe('C');
    expect(castInitials('Jean-Claude Van Damme')).toBe('JD');
    expect(castInitials('')).toBe('?');
  });
});

describe('infoView', () => {
  const full: TitleInfo = {
    titleId: 't', available: true, kind: 'movie', tagline: 'Real.', overview: 'Story.', releaseDate: '1999-03-30', runtimeMinutes: 136,
    rating: 8.24, ratingVotes: 25000, certification: 'R', genres: ['Action', 'Sci-Fi'], directors: ['Lana Wachowski'],
    cast: [{ name: 'Keanu Reeves', character: 'Neo' }], countries: ['United States of America'], originalLanguage: 'en',
  };
  it('orders primary facts first, credits second and fine print last', () => {
    const view = infoView(full);
    expect(view.hasDetails).toBe(true);
    expect(view.tagline).toBe('Real.');
    expect(view.overview).toBe('Story.');
    expect(view.meta).toEqual(['Mar 30, 1999', '2 h 16 min', '8.2 / 10', 'R']);
    expect(view.genres).toEqual(['Action', 'Sci-Fi']);
    expect(view.credits).toEqual([{ label: 'Directed by', names: 'Lana Wachowski' }]);
    expect(view.fine.map(entry => entry.label)).toEqual(['Country', 'Original language']);
  });
  it('labels series creators and counts seasons and status', () => {
    const view = infoView({ titleId: 't', available: true, kind: 'series', releaseDate: '2019-01-02', lastAirDate: '2022-05-06', status: 'Ended', creators: ['Jane Roe'], seasons: 4, episodes: 40 });
    expect(view.credits).toEqual([{ label: 'Created by', names: 'Jane Roe' }]);
    expect(view.meta[0]).toBe('Since 2019');
    expect(view.seasons).toEqual({ label: 'Seasons', value: '4 seasons, 40 episodes' });
    expect(view.fine.map(entry => entry.label)).not.toContain('Seasons');
    expect(view.fine).toContainEqual({ label: 'Status', value: 'Ended' });
  });
  it('offers the Seasons card to series only and counts episodes when seasons are unknown', () => {
    expect(infoView({ titleId: 't', available: true, kind: 'series', episodes: 25 }).seasons).toEqual({ label: 'Episodes', value: '25 episodes' });
    expect(infoView({ titleId: 't', available: true, kind: 'series', seasons: 1 }).seasons).toEqual({ label: 'Seasons', value: '1 season' });
    expect(infoView({ titleId: 't', available: true, kind: 'series', status: 'Ended' }).seasons).toBeNull();
    expect(infoView({ titleId: 't', available: true, kind: 'movie', episodes: 3, overview: 'x' }).seasons).toBeNull();
  });
  it('reports no details for an empty answer so clients show the calm empty state', () => {
    expect(infoView({ titleId: 't', available: false }).hasDetails).toBe(false);
    expect(infoView(undefined).hasDetails).toBe(false);
    expect(infoView({ titleId: 't', available: true }).hasDetails).toBe(false);
  });
});

describe('API.titleInfo', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('reads the info endpoint of the title', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ titleId: 'a/b', available: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const info = await new API('http://tv.local:8080/').titleInfo('a/b');
    expect(info.available).toBe(true);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('http://tv.local:8080/api/v1/catalog/titles/a%2Fb/info');
  });
});

describe('season and episode views', () => {
  const now = new Date(2026, 5, 15);
  it('names seasons and episodes the way the breadcrumb and rows show them', () => {
    expect(seasonLabel(2)).toBe('Season 2');
    expect(seasonLabel(0)).toBe('Specials');
    expect(infoEpisodeCode(2, 5)).toBe('S02E05');
    expect(infoEpisodeCode(12, 105)).toBe('S12E105');
  });
  it('builds the breadcrumb for each level of the stack', () => {
    expect(infoCrumbs('Show', [])).toEqual(['Show']);
    expect(infoCrumbs('Show', [{ kind: 'seasons' }])).toEqual(['Show', 'Seasons']);
    expect(infoCrumbs('Show', [{ kind: 'seasons' }, { kind: 'season', season: 2 }])).toEqual(['Show', 'Seasons', 'Season 2']);
    expect(infoCrumbs('Show', [{ kind: 'season', season: 2 }, { kind: 'episode', season: 2, episode: 5 }])).toEqual(['Show', 'Season 2', 'E05']);
  });
  it('writes a season card as its name over year and episode count', () => {
    expect(seasonCardView({ number: 2, name: 'Season 2', airDate: '2012-04-01', episodeCount: 10 })).toMatchObject({ name: 'Season 2', meta: '2012 · 10 episodes', initial: '2' });
    expect(seasonCardView({ number: 1, name: '', episodeCount: 1 })).toMatchObject({ name: 'Season 1', meta: '1 episode' });
    expect(seasonCardView({ number: 0, name: 'Specials' })).toMatchObject({ meta: '', initial: 'S' });
  });
  it('projects a season onto overview, cast and episode rows, or reports nothing', () => {
    const view = seasonDetailView({ titleId: 't', available: true, number: 2, overview: 'Story.', airDate: '2012-04-01', cast: [{ name: 'A' }], episodes: [{ number: 1, name: 'Pilot', airDate: '2012-04-01', runtimeMinutes: 62, rating: 8.14 }, { number: 2 }] }, now);
    expect(view.hasDetails).toBe(true);
    expect(view.meta).toEqual(['Apr 1, 2012', '2 episodes']);
    expect(view.episodes[0]).toEqual({ number: 1, code: 'S02E01', short: 'E01', title: 'Pilot', meta: 'Apr 1, 2012 · 1 h 2 min · 8.1 / 10' });
    expect(view.episodes[1]).toMatchObject({ title: 'Episode 2', meta: '' });
    expect(seasonDetailView({ titleId: 't', available: false, number: 2, episodes: [] }).hasDetails).toBe(false);
    expect(seasonDetailView(undefined).hasDetails).toBe(false);
  });
  it('marks upcoming episodes in the row', () => {
    expect(episodeRowView(1, { number: 3, airDate: '2026-07-01' }, now).meta).toBe('Upcoming · Jul 1, 2026');
  });
  it('projects an episode onto facts, story, credits and guests', () => {
    const view = episodeView(2, { number: 5, name: 'The Wall', airDate: '2012-05-06', runtimeMinutes: 55, rating: 9, overview: 'A wall.', stillUrl: '/s.jpg', directors: ['D'], writers: ['W1', 'W2'], guestStars: [{ name: 'G', character: 'C' }], filler: true }, now);
    expect(view).toMatchObject({ hasDetails: true, code: 'S02E05', title: 'The Wall', overview: 'A wall.', badges: ['Filler'] });
    expect(view.meta).toEqual(['May 6, 2012', '55 min', '9.0 / 10']);
    expect(view.credits).toEqual([{ label: 'Director', names: 'D' }, { label: 'Writers', names: 'W1, W2' }]);
    expect(view.guests).toHaveLength(1);
    expect(episodeView(2, { number: 5, name: 'Bare' }, now).hasDetails).toBe(false);
    expect(episodeView(2, undefined).hasDetails).toBe(false);
  });
});

describe('API season endpoints', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('reads the seasons, season and episode endpoints of the title', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new API('http://tv.local:8080/');
    await api.titleSeasons('a/b');
    await api.seasonInfo('a/b', 2);
    await api.episodeInfo('a/b', 2, 5);
    const urls = (fetchMock.mock.calls as unknown as [string][]).map(call => String(call[0]));
    expect(urls).toEqual([
      'http://tv.local:8080/api/v1/catalog/titles/a%2Fb/info/seasons',
      'http://tv.local:8080/api/v1/catalog/titles/a%2Fb/info/seasons/2',
      'http://tv.local:8080/api/v1/catalog/titles/a%2Fb/info/seasons/2/episodes/5',
    ]);
  });
});

describe('episodePageView', () => {
  const now = new Date('2026-10-17T12:00:00Z');
  const listed = { number: 4, title: 'Among the Lotus Eaters', season: 2, airDate: '2012-04-22', sourceCount: 2 };

  it('without provider info falls back to the title detail: code, air date, the episode name and the series overview', () => {
    const view = episodePageView(2, listed, undefined, 'A series overview.', now);
    expect(view.code).toBe('S02E04');
    expect(view.title).toBe('Among the Lotus Eaters');
    expect(view.meta).toEqual([episodeAirLabel('2012-04-22', now)]);
    expect(view.overview).toBe('A series overview.');
    expect(view.stillUrl).toBeUndefined();
    expect(view.credits).toEqual([]);
  });

  it('with provider info adds runtime, rating, the synopsis, the still and the credits', () => {
    const view = episodePageView(2, listed, { number: 4, name: 'Lotus', runtimeMinutes: 55, rating: 8.5, overview: 'They land.', stillUrl: '/still.jpg', directors: ['D'] }, 'Series.', now);
    expect(view.meta.slice(1)).toEqual(['55 min', '8.5 / 10']);
    expect(view.overview).toBe('They land.');
    expect(view.stillUrl).toBe('/still.jpg');
    expect(view.credits).toEqual([{ label: 'Director', names: 'D' }]);
    expect(view.title).toBe('Among the Lotus Eaters');
  });

  it('an episode with no air date and no info still has a code and a title, and no empty facts', () => {
    const view = episodePageView(2, { number: 4, title: 'Four' }, undefined, '', now);
    expect(view.meta).toEqual([]);
    expect(view.overview).toBe('');
  });
});

describe('episodeRowLine', () => {
  const now = new Date(2026, 5, 15);
  const page = (airDate: string | undefined, info?: Parameters<typeof episodePageView>[2]) => episodePageView(1, { number: 2, title: 'Two', airDate }, info, '', now);
  it('puts the version count before the air date', () => {
    expect(episodeRowLine({ sourceCount: 2 }, page('2017-05-06'))).toBe('2 versions · May 6, 2017');
  });
  it('marks a future date Upcoming and says 1 version in the singular', () => {
    expect(episodeRowLine({ sourceCount: 1 }, page('2026-07-01'))).toBe('1 version · Upcoming · Jul 1, 2026');
  });
  it('adds the runtime and rating that cached info supplies', () => {
    expect(episodeRowLine({ sourceCount: 3 }, page('2017-05-06', { number: 2, runtimeMinutes: 55, rating: 8.5 }))).toBe('3 versions · May 6, 2017 · 55 min · 8.5 / 10');
  });
  it('omits an unknown date', () => {
    expect(episodeRowLine({ sourceCount: 1 }, page(undefined))).toBe('1 version');
  });
});
