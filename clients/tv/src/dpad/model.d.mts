// Types for model.mjs and the maps (plain JavaScript so Node tools read them without a build).

export type Key = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back';
export type Moves = Partial<Record<Key, string>> & { optional?: boolean };

export interface StopGroup {
  /** RegExp source matched against data-focus-key. */
  keys: string;
  /** Only stops on these data-focus-row values. */
  rows?: number | number[];
  region?: string;
  sample?: 'all';
  optional?: boolean;
  each: Moves;
  top?: Moves;
  bottom?: Moves;
  start?: Moves;
  end?: Moves;
  first?: Moves;
  last?: Moves;
}

export interface Burst { from: string; key: 'up' | 'down' | 'left' | 'right'; expect?: string; presses?: number }

export interface DpadMap {
  name: string;
  route?: string;
  /** The rail item (menu-<hub>) when it is not named like the route. */
  hub?: string;
  detect: string | string[];
  regions: string[];
  landing: string;
  reach: Record<string, unknown>[];
  opener?: string;
  settleMs?: number;
  notes?: string;
  noExit?: string;
  stops?: Record<string, Moves>;
  groups?: Record<string, StopGroup>;
  bursts?: Burst[];
}

export interface ElementInfo { key: string; region: string; row: number | null; col: number | null; top?: number; left?: number; selected?: boolean; [extra: string]: unknown }
export interface Stop { id: string; element: ElementInfo; group?: string; index?: number; line?: number; pos?: number }
export interface Layout { stops: Stop[]; unmapped: ElementInfo[]; groups: Record<string, { members: Stop[]; lines: Stop[][] }> }
export interface Target { screen: string; stop?: string | null; token?: string }

export const DIRECTIONS: ('up' | 'down' | 'left' | 'right')[];
export const KEYS: Key[];
export function classify(map: DpadMap, elements: ElementInfo[]): Layout;
export function sampleStops(map: DpadMap, layout: Layout): Stop[];
export function movesOf(map: DpadMap, layout: Layout, stop: Stop): Moves;
export function resolveTarget(map: DpadMap, layout: Layout, stop: Stop, token: string, direction: Key): Target;
export function resolveOn(map: DpadMap, layout: Layout, token: string, from?: Stop, direction?: Key): string | null;
export function checkMaps(maps: DpadMap[]): string[];
export function formatTable(rows: string[][]): string;
