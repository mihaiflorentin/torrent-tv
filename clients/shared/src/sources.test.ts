import { describe, expect, it } from 'vitest';
import { bestSourceForDetail, playActionLabel, rankSources, type CatalogDetail, type CatalogSource, type MediaState } from './index';

let counter = 0;
function source(over: { name?: string; seeders?: number; size?: number; resolution?: string; quality?: string; hdr?: string; state?: MediaState['downloadState']; season?: number; episode?: number; noParsed?: boolean } = {}): CatalogSource {
 counter++;
 const parsed = { title: 'Show', sortTitle: 'show', kind: 'movie' as const, resolution: over.resolution, quality: over.quality, hdr: over.hdr, seasonStart: over.season, episodeStart: over.episode };
 return {
  release: { id: `r${counter}`, trackerId: 't', trackerName: 'T', providerId: 'p', categoryId: 'c', browseClass: 'b', name: over.name ?? `Show ${counter}`, category: 'Movies', sizeBytes: over.size ?? 2e9, seeders: over.seeders ?? 10, leechers: 0, freeleech: false },
  parsed: over.noParsed ? (undefined as never) : parsed,
  libraryState: over.state ? { downloadState: over.state, watchState: 'unwatched' } : undefined
 };
}
const ids = (items: CatalogSource[]) => items.map(item => item.release.id);

describe('rankSources', () => {
 it('is total on empty input and does not mutate its input', () => {
  expect(rankSources([])).toEqual([]);
  const input = [source({ seeders: 1 }), source({ seeders: 50 })];
  const copy = input.slice();
  rankSources(input);
  expect(input).toEqual(copy);
 });
 it('does not throw on missing parsed fields', () => {
  expect(() => rankSources([source({ noParsed: true }), source()])).not.toThrow();
 });
 it('puts an already downloaded version ahead of a better swarm', () => {
  const downloaded = source({ resolution: '720p', seeders: 0, state: 'downloaded' });
  const swarm = source({ resolution: '1080p', seeders: 500, quality: 'WEB-DL' });
  expect(rankSources([swarm, downloaded])[0]).toBe(downloaded);
 });
 it('prefers downloaded over managed over unmanaged', () => {
  const none = source({ resolution: '1080p', seeders: 100 });
  const managed = source({ resolution: '720p', state: 'downloading' });
  const done = source({ resolution: '480p', state: 'downloaded' });
  expect(rankSources([none, managed, done])).toEqual([done, managed, none]);
 });
 it('ranks CAM junk last even with the best swarm, detected from the release name', () => {
  const cam = source({ name: 'Show.2024.1080p.HDCAM.x264', resolution: '1080p', seeders: 900 });
  const hd = source({ resolution: '720p', seeders: 5 });
  expect(rankSources([cam, hd])[0]).toBe(hd);
  expect(ids(rankSources([cam, hd]))).toEqual([hd.release.id, cam.release.id]);
  expect(rankSources([cam])[0]).toBe(cam);
 });
 it('detects junk from the parsed quality too', () => {
  const ts = source({ quality: 'TS', resolution: '1080p' });
  const hd = source({ resolution: '480p' });
  expect(rankSources([ts, hd])[0]).toBe(hd);
 });
 it('does not treat words that merely contain junk letters as junk', () => {
  const a = source({ name: 'Scars.of.Time.1080p.WEB-DL', resolution: '1080p', quality: 'WEB-DL' });
  const b = source({ resolution: '720p' });
  expect(rankSources([b, a])[0]).toBe(a);
 });
 it('never leads with a 0-seeder source unless it is alone', () => {
  const dead = source({ resolution: '1080p', seeders: 0 });
  const alive = source({ resolution: '720p', seeders: 4 });
  expect(rankSources([dead, alive])[0]).toBe(alive);
  expect(rankSources([dead])[0]).toBe(dead);
 });
 it('uses the highest seeders when no source has a healthy swarm', () => {
  const a = source({ resolution: '1080p', seeders: 1 });
  const b = source({ resolution: '720p', seeders: 2 });
  expect(rankSources([a, b])[0]).toBe(b);
 });
 it('prefers 1080p over a 4K without HDR or a big swarm', () => {
  const uhd = source({ resolution: '2160p', seeders: 10 });
  const fhd = source({ resolution: '1080p', seeders: 10 });
  expect(rankSources([uhd, fhd])[0]).toBe(fhd);
 });
 it('lets 4K with HDR or a large swarm beat 720p but not 1080p', () => {
  const uhdHdr = source({ resolution: '2160p', hdr: 'HDR10', seeders: 5 });
  const uhdSwarm = source({ resolution: '2160p', seeders: 40 });
  const hd = source({ resolution: '720p', seeders: 50 });
  const fhd = source({ resolution: '1080p', seeders: 5 });
  expect(ids(rankSources([hd, uhdHdr, fhd, uhdSwarm]))).toEqual([fhd.release.id, uhdSwarm.release.id, uhdHdr.release.id, hd.release.id]);
 });
 it('prefers disc and web-dl quality over webrip over hdtv over unknown at equal resolution', () => {
  const unknown = source({ resolution: '1080p' });
  const hdtv = source({ resolution: '1080p', quality: 'HDTV' });
  const rip = source({ resolution: '1080p', quality: 'WEBRIP' });
  const web = source({ resolution: '1080p', quality: 'WEB-DL' });
  expect(rankSources([unknown, hdtv, rip, web])).toEqual([web, rip, hdtv, unknown]);
 });
 it('then prefers more seeders, then the smaller file', () => {
  const few = source({ resolution: '1080p', seeders: 5, size: 1e9 });
  const many = source({ resolution: '1080p', seeders: 30, size: 9e9 });
  expect(rankSources([few, many])[0]).toBe(many);
  const big = source({ resolution: '1080p', seeders: 30, size: 8e9 });
  const small = source({ resolution: '1080p', seeders: 30, size: 3e9 });
  expect(rankSources([big, small])[0]).toBe(small);
 });
 it('prefers the file size of the matched file over the release size', () => {
  const pack = source({ resolution: '1080p', seeders: 30, size: 50e9 });
  pack.fileSizeBytes = 1e9;
  const other = source({ resolution: '1080p', seeders: 30, size: 4e9 });
  expect(rankSources([other, pack])[0]).toBe(pack);
 });
 it('is stable for full ties', () => {
  const a = source({ resolution: '1080p' });
  const b = source({ resolution: '1080p' });
  const c = source({ resolution: '1080p' });
  expect(rankSources([a, b, c])).toEqual([a, b, c]);
 });
 it('honours the selected season and episode when sources carry them', () => {
  const wrong = source({ resolution: '1080p', seeders: 99, season: 1, episode: 2 });
  const right = source({ resolution: '720p', seeders: 3, season: 1, episode: 3 });
  expect(ids(rankSources([wrong, right], { season: 1, episode: 3 }))).toEqual([right.release.id, wrong.release.id]);
 });
});

describe('bestSourceForDetail', () => {
 const title = (kind: 'movie' | 'series') => ({ id: 'x', title: 'X', kind, trackers: [], categories: [], resolutions: [], sourceCount: 0, bestSeeders: 0, largestSizeBytes: 0 });
 it('ranks movie sources', () => {
  const weak = source({ resolution: '720p' });
  const strong = source({ resolution: '1080p' });
  const detail: CatalogDetail = { title: title('movie'), seasons: [], sources: [weak, strong] };
  expect(bestSourceForDetail(detail, {})).toBe(strong);
  expect(bestSourceForDetail({ ...detail, sources: [] }, {})).toBeUndefined();
 });
 it('plays the first episode of the selected season for series', () => {
  const s1 = source({ resolution: '720p' });
  const s2a = source({ resolution: '720p' });
  const s2b = source({ resolution: '1080p' });
  const detail: CatalogDetail = { title: title('series'), sources: [], seasons: [
   { number: 1, title: 'S1', episodeCount: 1, episodes: [{ number: 1, title: 'e', season: 1, sourceCount: 1, sources: [s1] }] },
   { number: 2, title: 'S2', episodeCount: 1, episodes: [{ number: 1, title: 'e', season: 2, sourceCount: 2, sources: [s2a, s2b] }] }
  ] };
  expect(bestSourceForDetail(detail, { season: 2 })).toBe(s2b);
  expect(bestSourceForDetail(detail, {})).toBe(s1);
  expect(bestSourceForDetail(detail, { season: 2, episode: 9 })).toBeUndefined();
 });
});

describe('playActionLabel', () => {
 it('names the action, resolution, quality and size, omitting unknown parts', () => {
  expect(playActionLabel(source({ resolution: '1080p', quality: 'WEB-DL', size: 2.4e9 }))).toBe('Play and download · 1080p WEB-DL · 2.4 GB');
  expect(playActionLabel(source({ resolution: '720p', size: 700e6, state: 'downloaded' }))).toBe('Play · 720p · 700 MB');
  expect(playActionLabel(source({ noParsed: true, size: 0 }))).toBe('Play and download');
 });
});
