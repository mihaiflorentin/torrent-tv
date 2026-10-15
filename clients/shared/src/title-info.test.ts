import { afterEach, describe, expect, it, vi } from 'vitest';
import { API, castInitials, episodeAirLabel, formatRuntime, formatShortDate, infoView, releaseLine } from '@torrent-tv/shared';
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
    expect(view.fine).toContainEqual({ label: 'Seasons', value: '4 seasons, 40 episodes' });
    expect(view.fine).toContainEqual({ label: 'Status', value: 'Ended' });
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
