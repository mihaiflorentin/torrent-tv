import { useEffect, useState } from 'preact/hooks';
import { prepareHint, readyLine, readyPercent, type API, type Download } from '@torrent-tv/shared';

// "Getting ready" feedback, the web twin of the TV panels. Calm by design: facts appear only when known, nothing
// pulses, and the space for every line is reserved so the dialog never jumps as text arrives.

// Prepare is one blocking request, so the only honest progress is time. The counter is plain text outside the live
// region (reading it every second would be noise); only the hint, which appears once, is announced.
export function PrepareElapsed({ seeders }: { seeders?: number }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <div class="prepare-wait"><span class="prepare-elapsed">{seconds} s</span><p class="supporting prepare-hint" aria-live="polite">{prepareHint(seconds, seeders)}</p></div>;
}

// While the stream opens or buffers, poll the download list every 2 s for its progress (there is no single-download
// endpoint). Render-only: it takes no focus. The state follows the download: a new id (episode skip) starts from that
// download, never the previous one. Polling pauses while the page is hidden; a failed poll keeps the last progress
// but flags it as not updating, and the next good poll clears the flag. The interval ends with the panel.
export function PlayerReady({ api, download, title }: { api: Pick<API, 'downloads'>; download: Download; title: string }) {
  const [fetched, setFetched] = useState<Download | null>(null);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    setFetched(null);
    setStale(false);
    let stopped = false;
    let running = false;
    const refresh = async () => {
      if (stopped || running || document.hidden) return;
      running = true;
      try {
        const found = (await api.downloads()).items.find(item => item.id === download.id);
        if (!stopped && found) { setFetched(found); setStale(false) }
      } catch { if (!stopped) setStale(true) } finally { running = false }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    const onVisibility = () => void refresh();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stopped = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility) };
  }, [download.id]);
  const current = fetched && fetched.id === download.id ? fetched : download;
  const percent = readyPercent(current);
  const facts = readyLine(current);
  return <div class="player-ready" aria-live="polite" data-stale={stale ? 'true' : undefined}>
    <strong class="player-ready-title">{title}</strong>
    <div class="player-ready-bar" role="progressbar" aria-label="Download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span class="player-ready-fill" style={{ width: `${percent}%` }} /></div>
    <div class="player-ready-facts" aria-live="off"><b>{percent}%</b>{facts && <span>{facts}</span>}</div>
    {stale && <div class="player-ready-stale supporting">Progress is not updating</div>}
  </div>;
}
