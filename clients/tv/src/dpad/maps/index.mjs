// Every declared D-pad map of the TV client: the source of truth for where each remote key moves
// focus on each screen and overlay (DESIGN.md, "TV interaction"). Read by the happy-dom tests and
// by the real-Chromium audit (`make dpad-tv`, tools/tv_perf/dpad.mjs).
//
// Order matters only for telling screens apart when several are drawn at once: overlays and
// sub-views come before the screen they sit on.
import { rail, home } from './shell.mjs';
import { CATALOG_MAPS } from './catalog.mjs';
import { LIBRARY_MAPS } from './library.mjs';
import { SYSTEM_MAPS } from './system.mjs';
import { TITLE_MAPS } from './title.mjs';
import { PLAYER_MAPS } from './player.mjs';

export const MAPS = [rail, home, ...CATALOG_MAPS, ...LIBRARY_MAPS, ...SYSTEM_MAPS, ...TITLE_MAPS, ...PLAYER_MAPS];
