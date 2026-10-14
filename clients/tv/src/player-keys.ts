import type { PlayerAction } from './player';

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
  /** Move the playback position by one Seek step; `hidden` asks for position feedback because the controls are not showing. */
  seek(delta: number, hidden: boolean): void;
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

/** Shared TV player key router: the interaction table in DESIGN.md as code, behind ports so it runs on synthetic keys. */
export class PlayerKeyController {
  #ports: PlayerKeyPorts;

  constructor(ports: PlayerKeyPorts) {
    this.#ports = ports;
  }

  handle(action: PlayerAction): void {
    const p = this.#ports;
    if (!action) return;
    if (action === 'back' || action === 'stop') return p.back();
    if (action === 'play') return p.togglePlayback(true);
    if (action === 'pause') return p.togglePlayback(false);
    if (action === 'play-pause') return p.togglePlayback();

    const menu = p.menuOpen();
    const hidden = !p.controlsVisible() && !menu;

    if (action === 'rewind' || action === 'previous' || action === 'fast-forward' || action === 'next') {
      p.seek(action === 'rewind' || action === 'previous' ? -SEEK_STEP_MS : SEEK_STEP_MS, hidden);
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
      if (action === 'left' || action === 'right') return p.seek(action === 'left' ? -SEEK_STEP_MS : SEEK_STEP_MS, false);
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

  /** Remembered control, never the timeline and never the first one in the list. */
  #restoreKey(): string {
    const key = this.#ports.remembered();
    return !key || key === 'timeline' ? 'play' : key;
  }
}
