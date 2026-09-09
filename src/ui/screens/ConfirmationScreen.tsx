import type { Journey, Lang } from '../../core/types';
import { ms, zh } from '../../phrases';
import { RoutePreview } from '../components/RoutePreview';
import { Trail } from '../components/Trail';

export function ConfirmationScreen({ journey, lang, onStart, onChange }: { journey: Journey; lang: Lang; onStart: () => void; onChange: () => void }) {
  const book = lang === 'ms' ? ms : zh;
  const minutes = Math.max(1, Math.round(journey.route.candidate.totalTimeS / 60));
  const metres = Math.round(journey.route.candidate.totalDistanceM);
  return (
    <main className="screen confirmation-screen">
      <Trail count={3} current={1} />
      <p className="eyebrow">{lang === 'ms' ? 'Destinasi anda' : '您的目的地'}</p>
      <h1>{journey.destination.name}</h1>
      <RoutePreview points={journey.route.candidate.polyline} />
      <p className="route-meta">{minutes} min · {metres} m</p>
      <p className="comfort-note">{journey.route.rationale}</p>
      <div className="screen-actions">
        <button type="button" className="btn-primary" onClick={onStart}>{lang === 'ms' ? 'Mulakan perjalanan' : '开始行程'}</button>
        <button type="button" className="btn-link" onClick={onChange}>{lang === 'ms' ? 'Tukar destinasi' : '更改目的地'}</button>
      </div>
    </main>
  );
}
