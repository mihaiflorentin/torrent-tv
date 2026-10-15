// The focus-following backdrop: one blurred artwork layer behind the whole
// screen. Cards publish the artwork of the title the pointer or keyboard is on
// through setBackdropArt; the layer crossfades to it by opacity only and never
// animates the blur (DESIGN.md "Backdrop art"). With nothing focused it rests
// on the featured title passed as `fallback`; with no artwork at all it shows
// the designed tinted state from the stylesheet. The layer is decorative:
// every title keeps its own sharp poster and text alternative.
import { useEffect, useRef, useState } from 'preact/hooks';

let focusedArt = '';
const listeners = new Set<(url: string) => void>();

export function setBackdropArt(url?: string): void {
  const next = url || '';
  if (next === focusedArt) return;
  focusedArt = next;
  listeners.forEach(listener => listener(next));
}

function useFocusedArt(): string {
  const [url, setUrl] = useState(focusedArt);
  useEffect(() => {
    listeners.add(setUrl);
    setUrl(focusedArt);
    return () => { listeners.delete(setUrl) };
  }, []);
  return url;
}

// Wide artwork suits the backdrop; the poster is the fallback.
export const backdropArtFor = (title?: { posterUrl?: string; backdropUrl?: string } | null): string => title?.backdropUrl || title?.posterUrl || '';

type Slots = { urls: [string, string]; active: 0 | 1 };

// Two image slots crossfade: the new artwork loads in the idle slot and takes
// over when it can be painted, so the old one never fades into a blank frame.
export function BackdropLayer({ fallback = '' }: { fallback?: string }) {
  const art = useFocusedArt() || fallback;
  const [slots, setSlots] = useState<Slots>({ urls: [art, ''], active: 0 });
  const wanted = useRef(art);
  wanted.current = art;
  useEffect(() => {
    setSlots(current => {
      if (current.urls[current.active] === art) return current;
      const idle = current.active === 0 ? 1 : 0;
      const urls: [string, string] = [current.urls[0], current.urls[1]];
      // No artwork: empty the idle slot and switch to it at once.
      if (!art) { urls[idle] = ''; return { urls, active: idle } }
      // Already loaded in the idle slot: switch without waiting for a load event.
      if (urls[idle] === art) return { urls, active: idle };
      // Otherwise load in the idle slot; the img's load event reveals it.
      urls[idle] = art;
      return { urls, active: current.active };
    });
  }, [art]);
  const shown = slots.urls[slots.active];
  const reveal = (slot: 0 | 1) => setSlots(current => current.urls[slot] === wanted.current && current.active !== slot ? { ...current, active: slot } : current);
  // A dead URL is never shown: empty its slot so the other slot (or the designed tinted state) stays on screen.
  const fail = (slot: 0 | 1) => setSlots(current => {
    if (!current.urls[slot]) return current;
    const urls: [string, string] = [current.urls[0], current.urls[1]];
    urls[slot] = '';
    return { urls, active: current.active === slot ? (slot === 0 ? 1 : 0) : current.active };
  });
  return <div class="backdrop" aria-hidden="true" data-art={shown ? 'true' : 'false'}>
    {slots.urls.map((url, slot) => url ? <img key={slot} class="backdrop-art" data-active={slots.active === slot ? 'true' : 'false'} src={url} alt="" decoding="async" onLoad={() => reveal(slot as 0 | 1)} onError={() => fail(slot as 0 | 1)} /> : null)}
    <div class="backdrop-scrim" />
  </div>;
}
