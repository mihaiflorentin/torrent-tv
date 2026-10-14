import { describe, expect, it } from 'vitest';
import { type SubtitleCandidate, autoSubtitleOrder, subtitleItemDetail, subtitleItemLabel, subtitlePreferenceLanguage } from '@torrent-tv/shared';

const c = (id: string, language: string, overrides: Partial<SubtitleCandidate> = {}): SubtitleCandidate => ({ id, provider: 'embedded', language, title: '', score: 0, cached: false, ...overrides });
const ids = (items: SubtitleCandidate[]) => items.map(item => item.id).join(',');

describe('autoSubtitleOrder', () => {
  it('prefers the preferred language, then the fallback, and never other languages', () => {
    const items = [c('fr', 'fr'), c('en', 'en'), c('ro', 'ro')];
    expect(ids(autoSubtitleOrder(items, { language: 'ro', fallback: 'en' }))).toBe('ro,en');
    expect(ids(autoSubtitleOrder(items, { language: 'en', fallback: 'ro' }))).toBe('en,ro');
  });
  it('lets a full track beat a forced-only track, even across languages', () => {
    const items = [c('roForced', 'ro', { forced: true }), c('en', 'en'), c('ro', 'ro')];
    expect(ids(autoSubtitleOrder(items, { language: 'ro', fallback: 'en' }))).toBe('ro,en,roForced');
  });
  it('keeps a forced track only as the last resort', () => {
    expect(ids(autoSubtitleOrder([c('roForced', 'ro', { forced: true }), c('fr', 'fr')], { language: 'ro', fallback: 'en' }))).toBe('roForced');
  });
  it('puts hearing-impaired tracks after plain ones of the same language', () => {
    const items = [c('sdh', 'ro', { hearingImpaired: true }), c('plain', 'ro')];
    expect(ids(autoSubtitleOrder(items, { language: 'ro' }))).toBe('plain,sdh');
  });
  it('uses an undetermined track only after every matching one', () => {
    expect(ids(autoSubtitleOrder([c('und', ''), c('fr', 'fr')], { language: 'ro', fallback: 'en' }))).toBe('und');
    expect(ids(autoSubtitleOrder([c('und', ''), c('en', 'en')], { language: 'ro', fallback: 'en' }))).toBe('en,und');
  });
  it('yields nothing when only other-language tracks exist', () => {
    expect(autoSubtitleOrder([c('fr', 'fr'), c('ar', 'ar')], { language: 'ro', fallback: 'en' })).toEqual([]);
  });
  it('keeps the server order inside a tier', () => {
    expect(ids(autoSubtitleOrder([c('a', 'ro'), c('b', 'ro'), c('d', 'ro', { default: true })], { language: 'ro' }))).toBe('d,a,b');
  });
});

describe('subtitlePreferenceLanguage', () => {
  it('keeps the previous language when the picked track has none', () => {
    expect(subtitlePreferenceLanguage('', 'ro')).toBe('ro');
    expect(subtitlePreferenceLanguage('und', 'ro')).toBe('ro');
    expect(subtitlePreferenceLanguage('eng', 'ro')).toBe('en');
    expect(subtitlePreferenceLanguage(undefined, '')).toBe('');
  });
});

describe('subtitle labels', () => {
  it('names Forced, SDH and Default tracks', () => {
    expect(subtitleItemLabel(c('1', 'ro', { forced: true }), 1)).toBe('Romanian · Forced');
    expect(subtitleItemLabel(c('1', 'ro', { hearingImpaired: true }), 1)).toBe('Romanian · SDH');
    expect(subtitleItemLabel(c('1', 'ro', { default: true }), 1)).toBe('Romanian · Default');
    expect(subtitleItemLabel(c('1', 'ro', { forced: true, default: true }), 1)).toBe('Romanian · Forced · Default');
  });
  it('shows codec and a distinct track title in the detail line', () => {
    expect(subtitleItemDetail(c('1', 'ro', { format: 'subrip', title: 'Full dialogue' }))).toBe('Full dialogue · SUBRIP');
    expect(subtitleItemDetail(c('1', 'ro', { format: 'ass', title: 'Romanian' }))).toBe('ASS');
    expect(subtitleItemDetail(c('1', 'ro', { provider: 'subdl', format: 'srt', title: 'Some.Release.Name' }))).toBe('SRT');
    expect(subtitleItemDetail(c('1', '', {}))).toBe('');
  });
});
