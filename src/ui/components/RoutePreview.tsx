import type { LatLng } from '../../core/types';

export function RoutePreview({ points, current }: { points: LatLng[]; current?: LatLng }) {
  if (points.length < 2) return null;
  const start = points[0]!;
  const end = points[points.length - 1]!;
  const minLat = Math.min(...points.map((p) => p.lat));
  const maxLat = Math.max(...points.map((p) => p.lat));
  const minLng = Math.min(...points.map((p) => p.lng));
  const maxLng = Math.max(...points.map((p) => p.lng));
  const dx = Math.max(maxLng - minLng, 0.00001);
  const dy = Math.max(maxLat - minLat, 0.00001);
  const project = (p: LatLng) => `${10 + ((p.lng - minLng) / dx) * 180},${10 + (1 - (p.lat - minLat) / dy) * 130}`;
  return (
    <div className="route-preview" aria-label="Route map" role="img">
      <svg viewBox="0 0 200 150" preserveAspectRatio="none">
        <path d={`M ${points.map(project).join(' L ')}`} className="route-line" />
        <circle cx={project(start).split(',')[0]} cy={project(start).split(',')[1]} r="5" className="route-start" />
        <circle cx={project(end).split(',')[0]} cy={project(end).split(',')[1]} r="6" className="route-end" />
        {current && <circle cx={project(current).split(',')[0]} cy={project(current).split(',')[1]} r="6" className="route-current" />}
      </svg>
      <span className="map-credit">© OpenStreetMap contributors</span>
    </div>
  );
}
