// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLanding, pickLanding } from './landing';

// Landing focus: where the D-pad cursor goes when a screen opens. The target
// is the screen's first card (or primary control), never the header chrome,
// and a landing that is still waiting for cards must never yank focus after
// the viewer has pressed a key.

const wait = (ms = 30) => new Promise(r => setTimeout(r, ms));

function control(row: number, col: number, landing?: string, region = 'content'): HTMLButtonElement {
  const button = document.createElement('button');
  button.dataset.focusRegion = region;
  button.dataset.focusRow = String(row);
  button.dataset.focusCol = String(col);
  button.dataset.focusKey = `k-${region}-${row}-${col}`;
  if (landing) button.dataset.landing = landing;
  document.body.appendChild(button);
  return button;
}
const chrome = () => control(0, 0, 'chrome');
const all = () => Array.from(document.querySelectorAll<HTMLElement>('button'));
const key = (name = 'ArrowDown', keyCode = 40, extra: KeyboardEventInit = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: name, keyCode, bubbles: true, ...extra }));

describe('pickLanding', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
  });
  afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('picks the card with the lowest row, then the lowest column, not the first in DOM order', () => {
    chrome();
    control(1, 0);
    const late = control(11, 0, 'card');
    const second = control(10, 1, 'card');
    const first = control(10, 0, 'card');
    void late; void second;
    expect(pickLanding(all()).target).toBe(first);
  });

  it('treats a primary control (hero, search field) as ranked with the cards by row', () => {
    const hero = control(1, 0, 'control');
    control(3, 0, 'card');
    expect(pickLanding(all()).target).toBe(hero);
  });

  it('falls back to the first untagged content control, skipping the header chrome', () => {
    chrome();
    control(3, 0);
    const firstSetting = control(1, 0);
    expect(pickLanding(all())).toEqual({ target: firstSetting, rank: 'fallback' });
  });

  it('offers the chrome only when nothing else exists and only when asked', () => {
    const refresh = chrome();
    const elements = all();
    expect(pickLanding(elements).target).toBeNull();
    expect(pickLanding(elements, { allowChrome: true })).toEqual({ target: refresh, rank: 'chrome' });
  });

  it('settles an empty hub tab on its selected tab, not on the first tab of the strip', () => {
    control(0, 0, 'chrome').setAttribute('aria-selected', 'false');
    const selected = control(0, 2, 'chrome');
    selected.setAttribute('aria-selected', 'true');
    expect(pickLanding(all(), { allowChrome: true }).target).toBe(selected);
  });

  it('ignores the sidebar and other regions', () => {
    control(0, 0, 'card', 'sidebar');
    const card = control(10, 0, 'card');
    expect(pickLanding(all()).target).toBe(card);
  });

  it('with cardsOnly ignores controls and fallbacks', () => {
    control(1, 0, 'control');
    control(2, 0);
    expect(pickLanding(all(), { cardsOnly: true }).target).toBeNull();
    const card = control(10, 0, 'card');
    expect(pickLanding(all(), { cardsOnly: true }).target).toBe(card);
  });
});

describe('landing controller', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
  });
  afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it('lands on the first card, not the header Refresh, when the cards are already there', async () => {
    chrome();
    const card = control(10, 0, 'card');
    control(10, 1, 'card');
    const landing = createLanding();
    landing.arm();
    await wait();
    expect(document.activeElement).toBe(card);
    landing.dispose();
  });

  it('waits for cards that arrive after the screen opened and then moves to the first one', async () => {
    const refresh = chrome();
    const sort = control(2, 0);
    const landing = createLanding({ chromeAfterMs: 500 });
    landing.arm();
    await wait();
    // No cards yet: the cursor may rest on a real control but never on the chrome.
    expect(document.activeElement).not.toBe(refresh);
    expect(document.activeElement).toBe(sort);
    const card = control(10, 0, 'card');
    await wait();
    expect(document.activeElement).toBe(card);
    landing.dispose();
  });

  it('does not yank focus after the viewer pressed a key', async () => {
    chrome();
    const sort = control(2, 0);
    const landing = createLanding();
    landing.arm();
    await wait();
    expect(document.activeElement).toBe(sort);
    key();
    control(10, 0, 'card');
    await wait();
    expect(document.activeElement).toBe(sort);
    landing.dispose();
  });

  it('ignores key repeats of the press that opened the screen and non-navigation keys', async () => {
    chrome();
    const landing = createLanding();
    landing.arm();
    key('Enter', 13, { repeat: true });
    key('VolumeUp', 447);
    const card = control(10, 0, 'card');
    await wait();
    expect(document.activeElement).toBe(card);
    landing.dispose();
  });

  it('does not move focus the viewer or another handler placed elsewhere', async () => {
    chrome();
    const sort = control(2, 0);
    const landing = createLanding();
    landing.arm();
    await wait();
    const other = control(4, 0);
    other.focus();
    control(10, 0, 'card');
    await wait();
    expect(document.activeElement).toBe(other);
    expect(document.activeElement).not.toBe(sort);
    landing.dispose();
  });

  it('upgrades a fallback landing to a better fallback that renders later, such as the first setting', async () => {
    chrome();
    control(15, 0);
    const landing = createLanding();
    landing.arm();
    await wait();
    const firstSetting = control(1, 0);
    await wait();
    expect(document.activeElement).toBe(firstSetting);
    landing.dispose();
  });

  it('settles on the chrome only after the grace period when the screen has nothing else', async () => {
    const refresh = chrome();
    const landing = createLanding({ chromeAfterMs: 60 });
    landing.arm();
    await wait(20);
    expect(document.activeElement).not.toBe(refresh);
    await wait(80);
    expect(document.activeElement).toBe(refresh);
    landing.dispose();
  });

  it('re-lands on the first card when the landed card is replaced and focus was lost', async () => {
    chrome();
    const old = control(10, 0, 'card');
    const landing = createLanding();
    landing.arm();
    await wait();
    expect(document.activeElement).toBe(old);
    old.remove();
    const replacement = control(10, 0, 'card');
    await wait();
    expect(document.activeElement).toBe(replacement);
    landing.dispose();
  });

  it('cardsOnly lands only on a card, for search results arriving after a submit', async () => {
    chrome();
    const input = control(1, 0, 'control');
    input.focus();
    const landing = createLanding();
    landing.arm({ cardsOnly: true });
    await wait();
    expect(document.activeElement).toBe(input);
    const card = control(10, 0, 'card');
    await wait();
    expect(document.activeElement).toBe(card);
    landing.dispose();
  });

  it('an intent armed after an async wait gives way to a key pressed since its mark', async () => {
    chrome();
    const sort = control(2, 0);
    sort.focus();
    const landing = createLanding();
    const mark = landing.mark();
    key();
    const card = control(10, 0, 'card');
    landing.arm({ cardsOnly: true, since: mark });
    await wait();
    expect(document.activeElement).toBe(sort);
    expect(document.activeElement).not.toBe(card);
    landing.dispose();
  });

  it('a new arm replaces the previous intent and cancel stops it', async () => {
    chrome();
    const landing = createLanding();
    landing.arm();
    landing.cancel();
    const card = control(10, 0, 'card');
    await wait();
    expect(document.activeElement).not.toBe(card);
    landing.arm();
    await wait();
    expect(document.activeElement).toBe(card);
    landing.dispose();
  });

  it('stops watching once its window has passed', async () => {
    chrome();
    const sort = control(2, 0);
    const landing = createLanding({ windowMs: 40, chromeAfterMs: 10 });
    landing.arm();
    await wait(80);
    control(10, 0, 'card');
    await wait();
    expect(document.activeElement).toBe(sort);
    landing.dispose();
  });
});
