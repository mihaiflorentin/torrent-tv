import { useEffect, useRef, useState } from 'preact/hooks';
import { detectLeanGraphics } from './capability';

// Focus-following backdrop (DESIGN.md "Backdrop art"). One blurred layer pair behind the rows:
// the front layer shows the art, the back layer takes the next one, and a change is a crossfade
// of opacity only. The blur is static and the layers are half-resolution, scaled up by the
// stylesheet, so the cost on an old TV is one decode and one fade per change. Nothing loops.
// A card opts in with data-art="<url>"; an empty value means "no artwork" and brings the
// designed fallback back. On an old TV engine (capability.ts) the blur is dropped, since the half-resolution
// layer scaled up is already soft, and the settle is longer. Controls without data-art leave the current art alone.

/** Settle time before the art follows focus, so a held D-pad key loads only where it stops. */
export const BACKDROP_FOLLOW_MS = 180;
/** The same settle on an old TV engine: its decode and fade are slower, so wait for the key repeat to really stop. */
export const BACKDROP_FOLLOW_LEAN_MS = 450;
/** A slow image must not stall the crossfade forever. */
const PRELOAD_GUARD_MS = 1500;

export interface BackdropState { layers: [string, string]; front: 0 | 1 }

/** CSS url() token for the art, quoted and escaped; `none` without art. */
export function cssURL(url: string): string {
  return url ? `url("${url.replace(/"/g, '%22').replace(/\(/g, '%28').replace(/\)/g, '%29')}")` : 'none';
}

/** The next layer state: new art goes to the hidden layer, which then comes to the front. */
export function nextBackdrop(state: BackdropState, url: string): BackdropState {
  if (state.layers[state.front] === url) return state;
  const back = (1 - state.front) as 0 | 1;
  const layers: [string, string] = [state.layers[0], state.layers[1]];
  layers[back] = url;
  return { layers, front: back };
}

export function Backdrop({ initial = '', follow = true, lean = detectLeanGraphics() }: { initial?: string; follow?: boolean; lean?: boolean }) {
  const [state, setState] = useState<BackdropState>({ layers: [initial, ''], front: 0 });
  const wanted = useRef(initial);

  useEffect(() => {
    if (!follow) return;
    let settle = 0;
    let guard = 0;
    let generation = 0;
    const apply = (url: string, token: number) => {
      if (token !== generation) return;
      window.clearTimeout(guard);
      setState(current => nextBackdrop(current, url));
    };
    const show = (url: string) => {
      const token = ++generation;
      if (!url) { apply(url, token); return; }
      let done = false;
      const finish = () => { if (!done) { done = true; apply(url, token); } };
      const image = new Image();
      image.onload = finish;
      // A dead URL is never shown: keep the art already on screen until focus reaches something that loads.
      image.onerror = () => { if (!done) { done = true; if (token === generation) window.clearTimeout(guard); } };
      guard = window.setTimeout(finish, PRELOAD_GUARD_MS);
      image.src = url;
    };
    const onFocus = (event: Event) => {
      const art = (event.target as HTMLElement | null)?.dataset?.art;
      if (art === undefined || art === wanted.current) return;
      wanted.current = art;
      window.clearTimeout(settle);
      window.clearTimeout(guard);
      settle = window.setTimeout(() => show(art), lean ? BACKDROP_FOLLOW_LEAN_MS : BACKDROP_FOLLOW_MS);
    };
    document.addEventListener('focusin', onFocus);
    return () => { generation++; window.clearTimeout(settle); window.clearTimeout(guard); document.removeEventListener('focusin', onFocus); };
  }, [follow, lean]);

  return <div class={`tv-backdrop${lean ? ' lean' : ''}`} aria-hidden="true">
    {state.layers.map((url, index) => <div key={index} class={`tv-backdrop-art${state.front === index ? ' on' : ''}`} style={url ? { backgroundImage: cssURL(url) } : undefined} />)}
    <div class="tv-backdrop-scrim" />
  </div>;
}
