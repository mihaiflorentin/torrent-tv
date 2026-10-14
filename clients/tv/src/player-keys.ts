import { clampSeek, type PlayerAction } from './player';

/** Where TV focus is: the timeline, a toolbar control, a Player panel item, or nowhere in the active control list. */
export interface PlayerFocus {
  where: 'timeline' | 'toolbar' | 'menu' | 'none';
  /** `data-player-control` of the focused timeline or toolbar control. */
  key: string | null;
  /** `data-focus-row` of the focused control. */
  row: string | null;
}

/** Everything the key router touches outside itself; the player wires DOM, AVPlay and ControlsVisibility behind these. */
export interface PlayerKeyPorts {
  controlsVisible(): boolean;
  menuOpen(): boolean;
  focused(): PlayerFocus;
  /** Control focus: the control a Wake returns to. */
  remembered(): string;
  remember(key: string): void;
  /** A key arrived: reveal and re-arm the hide timer, or with `hold` keep the controls up. */
  reveal(hold: boolean): void;
  duration(): number;
  /** Current time: the position the player reports and saves. */
  position(): number;
  /** Set the current time and the shown position together. */
  setPosition(ms: number): void;
  /** Position feedback on the OSD while the controls are hidden. */
  announce(ms: number): void;
  /** AVPlay `seekTo`; may throw. `onError` receives the error text. */
  avSeekTo(ms: number, onSuccess: () => void, onError: (error: string) => void): void;
  /** A seek failed: show the message and take the existing recovery path. */
  seekFailed(error: string): void;
  focusControl(key: string): void;
  activateControl(key: string): void;
  activateFocused(): void;
  focusFirstMenuItem(): void;
  /** Spatial move from the focused control in the active list. */
  navigate(direction: 'left' | 'right' | 'up' | 'down'): void;
  togglePlayback(force?: boolean): void;
  /** Close the open Player panel, else save and leave the player. */
  back(): void;
}

/** Seek step: the fixed amount one seek input moves the playback position (GLOSSARY.md). */
export const SEEK_STEP_MS = 10_000;

/** Idle time after the last Seek step before the accumulated target is committed to AVPlay. */
export const SEEK_COMMIT_MS = 550;

/** A reported time this close to the pending target means AVPlay has caught up. */
export const SEEK_PROXIMITY_MS = 1000;

/** Safety release: stale playtime is ignored for at most this long after a seek is committed. */
export const SEEK_RELEASE_MS = 2000;

/** Shared TV player key router: the interaction table in DESIGN.md as code, behind ports so it runs on synthetic keys. */
export class PlayerKeyController {
  #ports: PlayerKeyPorts;
  /** Pending seek target: the single source of truth for position and current time until it resolves. */
  #target: number | null = null;
  #commitTimer: ReturnType<typeof setTimeout> | undefined;
  #releaseTimer: ReturnType<typeof setTimeout> | undefined;
  /** True once the target has been handed to AVPlay and awaits its resolution. */
  #committed = false;
  /** Identifies the committed seek, so a superseded seek's callbacks cannot resolve a newer one. */
  #seekId = 0;

  constructor(ports: PlayerKeyPorts) {
    this.#ports = ports;
  }

  /** `repeat` is `KeyboardEvent.repeat`: Enter, Back and Play/Pause act on the first press only. */
  handle(action: PlayerAction, repeat = false): void {
    const p = this.#ports;
    if (!action) return;
    if (repeat && (action === 'enter' || action === 'back' || action === 'stop' || action === 'play-pause')) return;
    if (action === 'back' || action === 'stop') return p.back();
    if (action === 'play') return p.togglePlayback(true);
    if (action === 'pause') return p.togglePlayback(false);
    if (action === 'play-pause') return p.togglePlayback();

    const menu = p.menuOpen();
    const hidden = !p.controlsVisible() && !menu;

    if (action === 'rewind' || action === 'previous' || action === 'fast-forward' || action === 'next') {
      this.#step(action === 'rewind' || action === 'previous' ? -SEEK_STEP_MS : SEEK_STEP_MS, hidden);
      if (!hidden) p.reveal(menu);
      return;
    }

    // Wake: the first directional or OK press only brings the controls back to the last-used control.
    if (hidden) {
      p.reveal(false);
      const key = this.#restoreKey();
      p.focusControl(key);
      if (action === 'enter') p.activateControl(key);
      return;
    }

    p.reveal(menu);
    const focus = p.focused();

    if (menu) {
      if (action === 'enter') return focus.where === 'menu' ? p.activateFocused() : p.focusFirstMenuItem();
      if (action === 'left' || action === 'right') return;
      return focus.where === 'menu' ? p.navigate(action as 'up' | 'down') : p.focusFirstMenuItem();
    }

    if (focus.where !== 'timeline' && focus.where !== 'toolbar') return p.focusControl(this.#restoreKey());
    if (action === 'enter') return p.activateFocused();
    if (action !== 'left' && action !== 'right' && action !== 'up' && action !== 'down') return;

    if (focus.where === 'timeline') {
      if (action === 'left' || action === 'right') return this.#step(action === 'left' ? -SEEK_STEP_MS : SEEK_STEP_MS, false);
      if (action === 'down') return p.focusControl(this.#restoreKey());
      return p.navigate(action);
    }
    if (action === 'up' && focus.row === '1') return p.focusControl('timeline');
    p.navigate(action);
  }

  /** The hide timer fired: record the focused toolbar control so the next Wake restores it. */
  controlsHidden(): void {
    const focus = this.#ports.focused();
    if (focus.where === 'toolbar' && focus.key) this.#ports.remember(focus.key);
  }

  /** Accumulate one Seek step onto the pending target and commit it after the idle pause. */
  #step(delta: number, hidden: boolean): void {
    const p = this.#ports;
    const next = this.#aim(this.resumeTarget() + delta);
    if (hidden) p.announce(next);
    this.#commitTimer = setTimeout(() => this.#commit(), SEEK_COMMIT_MS);
  }

  /** Make `target` the pending target and the shown position; returns the clamped target. */
  #aim(target: number): number {
    const p = this.#ports;
    const next = clampSeek(target, p.duration());
    this.#target = next;
    this.#committed = false;
    clearTimeout(this.#releaseTimer);
    clearTimeout(this.#commitTimer);
    p.setPosition(next);
    return next;
  }

  /** Seek to an absolute position at once (Restart). Tracked like a committed Seek step. */
  seekTo(target: number): void {
    this.#aim(target);
    this.#commit();
  }

  /** Seek relative to the pending target at once (the toolbar -10s and +10s buttons). */
  seekBy(delta: number): void {
    this.seekTo(this.resumeTarget() + delta);
  }

  /** Where playback resumes after an audio-track switch: the pending target, else the current time. */
  resumeTarget(): number {
    return this.#target ?? this.#ports.position();
  }

  /** Drop the pending target and timers: the player closed, suspended or reopened. */
  dispose(): void {
    clearTimeout(this.#commitTimer);
    this.#release();
  }

  #commit(): void {
    const target = this.#target;
    if (target === null) return;
    const id = ++this.#seekId;
    this.#committed = true;
    this.#ports.setPosition(target);
    clearTimeout(this.#releaseTimer);
    this.#releaseTimer = setTimeout(() => this.#resolve(id), SEEK_RELEASE_MS);
    try {
      this.#ports.avSeekTo(target, () => this.#resolve(id), error => this.#fail(id, error));
    } catch (error) {
      this.#fail(id, (error as Error)?.message || String(error));
    }
  }

  /** The seek error callback fired (or `seekTo` threw): stop ignoring playtime and surface the error. */
  #fail(id: number, error: string): void {
    if (!this.#committed || id !== this.#seekId) return;
    this.#release();
    this.#ports.seekFailed(error);
  }

  /** A committed seek is over (success, timeout or error): playtime counts again. */
  #resolve(id: number): void {
    if (!this.#committed || id !== this.#seekId) return;
    this.#release();
  }

  #release(): void {
    clearTimeout(this.#releaseTimer);
    this.#target = null;
    this.#committed = false;
    this.#seekId++;
  }

  /**
   * AVPlay reported a playtime. Returns false while a pending seek makes it stale: the player must then leave
   * its position and current time alone. Released by the seek success callback, a report within 1 s of the
   * target, or the 2 s timeout.
   */
  playtime(value: number): boolean {
    if (this.#target === null) return true;
    if (!this.#committed) return false;
    if (Math.abs(value - this.#target) > SEEK_PROXIMITY_MS) return false;
    this.#release();
    return true;
  }

  /** Remembered control, never the timeline and never the first one in the list. */
  #restoreKey(): string {
    const key = this.#ports.remembered();
    return !key || key === 'timeline' ? 'play' : key;
  }
}
