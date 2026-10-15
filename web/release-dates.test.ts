import { describe, expect, it } from 'vitest';
import type { CatalogTitle } from '@torrent-tv/shared';
import { cardFacts, episodeFacts, titleFacts } from './presentation';

// Release dates on the web listing surfaces: cards keep one short line (month and year), the hero and
// the detail header carry the full date, series say 'Since <year>', and episode rows show the air date.
const title = (over: Partial<CatalogTitle> = {}): CatalogTitle => ({ id: 'a', title: 'Alpha', kind: 'movie', trackers: [], categories: [], resolutions: [], sourceCount: 1, bestSeeders: 0, largestSizeBytes: 0, ...over });

describe('web release lines', () => {
  it('shows a movie card as month and year, falling back to the year', () => {
    expect(cardFacts(title({ year: 2024, releaseDate: '2024-03-14', resolutions: ['1080p'] }))).toEqual(['Mar 2024', '1080p']);
    expect(cardFacts(title({ year: 2024 }))).toEqual(['2024']);
  });
  it('shows a series card as Since <year>', () => {
    expect(cardFacts(title({ kind: 'series', year: 2019, releaseDate: '2019-01-02' }))).toEqual(['Since 2019']);
  });
  it('gives the hero and detail header the full date', () => {
    expect(titleFacts(title({ year: 2024, releaseDate: '2024-03-14' }))).toEqual(['Mar 14, 2024', 'Movie']);
    expect(titleFacts(title({ kind: 'series', seasonCount: 3, year: 2019 }))).toEqual(['Since 2019', '3 seasons']);
  });
});

describe('episodeFacts', () => {
  const now = new Date(2026, 5, 15);
  it('adds the air date after the version count', () => {
    expect(episodeFacts({ sourceCount: 2, airDate: '2017-05-06' }, now)).toBe('2 versions · May 6, 2017');
  });
  it('marks a future date Upcoming', () => {
    expect(episodeFacts({ sourceCount: 1, airDate: '2026-07-01' }, now)).toBe('1 version · Upcoming · Jul 1, 2026');
  });
  it('omits an unknown date', () => {
    expect(episodeFacts({ sourceCount: 1 }, now)).toBe('1 version');
  });
});
