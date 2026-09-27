import { createHash } from 'node:crypto';
import { assert } from './errors.mjs';
import { identifier, integer, object, text, TERMINAL } from './model.mjs';

export const LOADER_BODY_LIMIT = 196_608;
export const LOADER_ASSET_LIMIT = 131_072;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Data only: generated source images, executable code and remote URLs are never stored. */
export function parseLoaderAsset(input) {
  const a = object(input, 'loader', ['name', 'kind', 'columns', 'rows', 'cells', 'duration', 'frames']);
  const name = text(a.name, 'loader.name', 40);
  const columns = integer(a.columns, 'loader.columns', 8, 32);
  const rows = integer(a.rows, 'loader.rows', 8, 32);
  const cells = value => {
    assert(typeof value === 'string' && value.length === columns * rows && /^[0-4]+$/.test(value),
      'INVALID_LOADER', 'Each frame needs one row-major intensity digit (0–4) per cell.');
    return value;
  };
  let result;
  if (a.kind === 'static') {
    assert(a.duration === undefined && a.frames === undefined, 'INVALID_LOADER', 'A still has cells, not animation timing.');
    result = { name, kind: 'static', columns, rows, cells: cells(a.cells) };
  } else {
    assert(a.kind === 'animation' && a.cells === undefined, 'INVALID_LOADER', 'Use static or animation loader data.');
    assert(Number.isFinite(a.duration) && a.duration >= 0.1 && a.duration <= 30,
      'INVALID_LOADER', 'Loop duration must be 0.1–30 seconds.');
    assert(Array.isArray(a.frames) && a.frames.length >= 3 && a.frames.length <= 240,
      'INVALID_LOADER', 'An animation needs 3–240 ordered frames.');
    let previous = -1;
    const frames = a.frames.map(frame => {
      assert(Array.isArray(frame) && frame.length === 2 && Number.isFinite(frame[0]) && frame[0] > previous && frame[0] <= a.duration,
        'INVALID_LOADER', 'Frame timestamps must increase within the loop.');
      previous = frame[0]; return [frame[0], cells(frame[1])];
    });
    assert(frames[0][0] === 0 && frames.at(-1)[0] === a.duration && frames[0][1] === frames.at(-1)[1],
      'INVALID_LOADER', 'Include matching boundary poses at zero and duration; also visually verify loop motion.');
    result = { name, kind: 'animation', columns, rows, duration: a.duration, frames };
  }
  assert(Buffer.byteLength(JSON.stringify(result)) <= LOADER_ASSET_LIMIT, 'BODY_TOO_LARGE', 'Loader asset exceeds 128 KiB.', 413);
  return result;
}

export function loaderFor(state, record) {
  const id = record.loaderAssetId;
  if (!id) return null; // Grokbot default, including pre-customization records.
  assert(Object.hasOwn(state.loaderAssets ?? {}, id), 'STORE_CORRUPT', 'Saved loader is missing; preserve storage for recovery.', 503);
  return { id, ...state.loaderAssets[id] };
}
export function pruneLoaders(state) {
  if (!state.loaderAssets) return;
  const used = new Set([...Object.values(state.loaderPreferences ?? {}).map(p => p.assetId),
    ...Object.values(state.cards).map(r => r.loaderAssetId)].filter(Boolean));
  for (const id of Object.keys(state.loaderAssets)) if (!used.has(id)) delete state.loaderAssets[id];
}
const ownerKey = ownerRef => hash(text(ownerRef, 'ownerRef', 256));
export function loaderPreference(state, ownerRef) {
  const p = state.loaderPreferences?.[ownerKey(ownerRef)];
  return { revision: p?.revision ?? 0, loader: p?.assetId ? loaderFor(state, { loaderAssetId: p.assetId }) : null };
}

/** Called only behind publisher authentication; the existing runtime verifies the user request. */
export function setLoaderPreference(state, input, now) {
  object(input, 'loader change', ['ownerRef', 'requestId', 'expectedRevision', 'action', 'asset']);
  const ownerRef = text(input.ownerRef, 'ownerRef', 256);
  const key = ownerKey(ownerRef), requestId = identifier(input.requestId, 'requestId');
  const expectedRevision = integer(input.expectedRevision, 'expectedRevision', 0, Number.MAX_SAFE_INTEGER);
  assert(['replace', 'reset'].includes(input.action), 'INVALID_LOADER', 'Use an explicit replace or reset action.');
  assert(input.action !== 'reset' || input.asset === undefined, 'INVALID_LOADER', 'Reset does not accept an asset.');
  const asset = input.action === 'replace' ? parseLoaderAsset(input.asset) : null;
  const digest = hash({ requestId, expectedRevision, action: input.action, asset });
  state.loaderPreferences ??= {}; state.loaderAssets ??= {};
  const previous = state.loaderPreferences[key];
  if (previous?.requestId === requestId) {
    assert(previous.hash === digest, 'IDEMPOTENCY_CONFLICT', 'Loader request was reused with different data.', 409);
    return loaderPreference(state, ownerRef);
  }
  assert((previous?.revision ?? 0) === expectedRevision, 'REVISION_CONFLICT', 'Read the current loader preference before replacing it.', 409);
  assert(previous || Object.keys(state.loaderPreferences).length < 100,
    'LOADER_CAPACITY', 'This small host supports at most 100 saved owner preferences.', 409);
  const assetId = asset ? hash(asset) : null;
  if (asset) state.loaderAssets[assetId] = asset;
  state.loaderPreferences[key] = { revision: expectedRevision + 1, assetId, requestId, hash: digest };
  for (const record of Object.values(state.cards)) {
    if (record.ownerRef !== ownerRef || record.archivedAt || TERMINAL.has(record.content.status)) continue;
    if ((record.loaderAssetId ?? null) === assetId) continue;
    record.loaderAssetId = assetId; record.revision++; record.updatedAt = now;
    // A previous milestone retry cannot be mistaken for a fresh write after customization.
    record.lastUpdate = null;
  }
  pruneLoaders(state);
  return loaderPreference(state, ownerRef);
}
