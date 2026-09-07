// OWNER: A (Pipeline spine) — do not edit unless you are the owner.
// Run with: npm run etl
//
// data.gov.sg serves DATASETS AS FILES (CSV/GeoJSON), not as a queryable geo
// API — its dataset search endpoint ignores the `query` parameter entirely.
// So we download once, slice to the demo corridor, and commit the slice.
// Nothing in the request path ever touches data.gov.sg.
//
// Metadata endpoint that does work:
//   GET https://api-production.data.gov.sg/v2/public/api/datasets/{id}/metadata
//
// Dataset IDs must be found BY HAND on data.gov.sg and pasted below — this is
// a Phase 0 task. See DEVPLAN.md.
//
// 🔴 THIS FILE IS ON THE CRITICAL PATH. I enumerated all 165 OneMap theme layers
// with the live token: there is NO shelter, bench, toilet, lift or bus-stop
// layer. (The brief claimed Themes had "barrier-free facilities, lifts" — only
// eldercare is real.) So EVERY comfort-scoring input comes from here. Without
// this ETL, core/comfort.ts has nothing to score and the differentiator is gone.

export interface DatasetSpec {
  key: string;
  /** data.gov.sg id, e.g. "d_f73d13943f7a3cc1aca76b18fea75013" — FILL THESE IN. */
  datasetId: string;
  kind: 'shelter' | 'bench' | 'toilet' | 'lift' | 'bus_stop';
  /** Set false once confirmed to exist. */
  unconfirmed?: boolean;
}

export const DATASETS: DatasetSpec[] = [
  { key: 'covered_linkway', datasetId: '', kind: 'shelter' },
  { key: 'public_toilets', datasetId: '', kind: 'toilet' },
  // ⚠️ Benches may not exist as a national open dataset. If Phase 0 confirms
  // it doesn't, DROP the rest term from comfort scoring AND from the pitch —
  // do not claim a layer we don't have.
  { key: 'rest_points', datasetId: '', kind: 'bench', unconfirmed: true },
];

/** Demo corridor bounding box — keeps the committed slice small. */
export const DEMO_BBOX = {
  minLat: 1.36,
  minLng: 103.84,
  maxLat: 1.38,
  maxLng: 103.86,
};

export async function fetchDatasetMetadata(_datasetId: string): Promise<unknown> {
  throw new Error('NOT_IMPLEMENTED: etl.fetchDatasetMetadata');
}

/** Download, parse, clip to DEMO_BBOX, normalise to Poi[], write data/*.json. */
export async function buildAmenityIndex(): Promise<void> {
  throw new Error('NOT_IMPLEMENTED: etl.buildAmenityIndex');
}
