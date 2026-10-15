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

// While the stream opens or buffers, poll the download every 2 s for its progress. Render-only: it takes no focus,
// and a failed poll keeps the panel as it was. The interval ends with the panel.
export function PlayerReady({ api, download, title }: { api: Pick<API, 'downloads'>; download: Download; title: string }) {
  const [current, setCurrent] = useState(download);
  useEffect(() => {
    let stopped = false;
    let running = false;
    const refresh = async () => {
      if (stopped || running) return;
      running = true;
      try {
        const found = (await api.downloads()).items.find(item => item.id === download.id);
        if (!stopped && found) setCurrent(found);
      } catch { } finally { running = false }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { stopped = true; window.clearInterval(timer) };
  }, [download.id]);
  const percent = readyPercent(current);
  const facts = readyLine(current);
  return <div class="player-ready" aria-live="polite">
    <strong class="player-ready-title">{title}</strong>
    <div class="player-ready-bar" role="progressbar" aria-label="Download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span class="player-ready-fill" style={{ width: `${percent}%` }} /></div>
    <div class="player-ready-facts" aria-live="off"><b>{percent}%</b>{facts && <span>{facts}</span>}</div>
  </div>;
}
