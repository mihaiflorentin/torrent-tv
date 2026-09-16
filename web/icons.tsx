// Per-icon transforms: glyphs drawn on a smaller footprint than the 24x24
// box scale up about their center so stroke weight reads like the rest.
const transforms: Record<string, string | undefined> = {
  bug: 'translate(12 12) scale(1.15) translate(-12 -12)',
};

export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    home: 'M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3z',
    search: 'M10.5 4a6.5 6.5 0 1 0 4.1 11.55L20 21l1-1-5.45-5.4A6.5 6.5 0 0 0 10.5 4z',
    library: 'M4 5h16v14H4zM8 5v14',
    play: 'M8 5v14l11-7z',
    heart: 'M12 21S4 16 4 9.5C4 5 9.5 3 12 7c2.5-4 8-2 8 2.5C20 16 12 21 12 21z',
    check: 'm5 12 4 4L19 6',
    download: 'M12 3v12m-5-5 5 5 5-5M4 21h16',
    user: 'M12 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4.4 0-7 2.4-7 5.5V21h14v-2.5c0-3.1-2.6-5.5-7-5.5z',
    tracker: 'M12 3a9 9 0 1 0 9 9M12 7a5 5 0 1 0 5 5M12 11a1 1 0 1 0 1 1',
    grid: 'M4 4h6v6H4zm10 0h6v6h-6zM4 14h6v6H4zm10 0h6v6h-6z',
    clock: 'M12 3a9 9 0 1 0 9 9h-9V6',
    folder: 'M3 6h7l2 2h9v11H3z',
    bug: 'm8 2 1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3 3 0 1 1 6 0v1M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6zM12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M17.47 9c1.93-.2 3.53-1.9 3.53-4M22 13h-4M21 21c0-2.1-1.7-3.9-3.8-4',
    refresh: 'M17.65 6.35A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.76-4.24L13 11h7V4z',
    link: 'M3.9 7.8a5.1 5.1 0 0 1 7.2 0l2.5 2.5-1.8 1.8-2.5-2.5a2.6 2.6 0 0 0-3.6 3.6l2.5 2.5-1.8 1.8-2.5-2.5a5.1 5.1 0 0 1 0-7.2zm16.2 8.4a5.1 5.1 0 0 1-7.2 0l-2.5-2.5 1.8-1.8 2.5 2.5a2.6 2.6 0 0 0 3.6-3.6l-2.5-2.5 1.8-1.8 2.5 2.5a5.1 5.1 0 0 1 0 7.2z',
    activity: 'M3 12h4l2-6 4 12 2-6h6',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4',
    'chevron-left': 'm14 6-6 6 6 6',
    'chevron-right': 'm10 6 6 6-6 6',
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name] || paths.grid} transform={transforms[name]} /></svg>;
}
