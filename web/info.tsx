// The Info dialog: the extended description of a title (story, date, runtime, rating, genres, then
// credits and cast, fine print last). Content decisions come from the shared infoView so the TV and
// the browser order facts identically. Focus trapping and Escape belong to the App's overlay focus
// machinery; this component only renders an accessible dialog surface and loads its data.
import { useEffect, useId, useState } from 'preact/hooks';
import { castInitials, infoView, type CatalogTitle, type TitleInfo } from '@torrent-tv/shared';
import { sharedApi } from './shared-api';

export function TitleInfoDialog({ title, onClose }: { title: CatalogTitle; onClose: () => void }) {
  const headingId = useId();
  const [info, setInfo] = useState<TitleInfo | undefined>(undefined);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => {
    let live = true;
    sharedApi().titleInfo(title.id).then(value => { if (live) { setInfo(value); setPhase('ready') } }, () => { if (live) setPhase('failed') });
    return () => { live = false };
  }, [title.id]);
  const view = infoView(info);
  // The catalog card already knows a description; keep showing it when the provider has nothing more.
  const overview = view.overview || (!view.hasDetails ? title.overview || '' : '');
  const empty = phase !== 'loading' && !view.hasDetails;
  return <div class="overlay info-overlay" role="dialog" aria-modal="true" aria-labelledby={headingId}>
    <section class="info-dialog">
      <button class="close" onClick={onClose}>Close</button>
      <h2 id={headingId}>{title.title}</h2>
      {phase === 'loading' && <div role="status" class="info-loading"><p>Loading details…</p><span class="info-skeleton" /><span class="info-skeleton short" /><span class="info-skeleton" /></div>}
      {empty && <p class="info-empty" role="status">No extra details available</p>}
      {view.meta.length > 0 && <p class="info-meta">{view.meta.join(' · ')}</p>}
      {view.tagline && <p class="info-tagline">{view.tagline}</p>}
      {overview && <p class="info-overview">{overview}</p>}
      {view.genres.length > 0 && <p class="info-genres">{view.genres.join(' · ')}</p>}
      {view.credits.length > 0 && <dl class="info-credits">{view.credits.map(credit => <div><dt>{credit.label}</dt><dd>{credit.names}</dd></div>)}</dl>}
      {view.cast.length > 0 && <section aria-label="Cast"><h3>Cast</h3><ul class="info-cast">{view.cast.map(member => <li>
        <span class="info-avatar" aria-hidden="true">{castInitials(member.name)}{member.imageUrl && <img src={sharedApi().streamURL(member.imageUrl)} alt="" loading="lazy" onError={event => { (event.currentTarget as HTMLElement).style.display = 'none' }} />}</span>
        <span class="info-cast-copy"><strong>{member.name}</strong>{member.character && <small>{member.character}</small>}</span>
      </li>)}</ul></section>}
      {view.fine.length > 0 && <dl class="info-fine">{view.fine.map(entry => <div><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl>}
    </section>
  </div>;
}
