/**
 * Protocol-compatible subset of @vercel/blob (>=2.3) for private stores.
 * Implements get({access:'private', useCache:false}) and put({ifMatch, allowOverwrite})
 * over the same HTTP surfaces the official SDK uses, without pulling jose/OIDC into
 * the Build Output API function. Prefer the real SDK in scripts/tests when convenient.
 */

export class BlobPreconditionFailedError extends Error {
  constructor(message = 'Blob precondition failed') {
    super(message);
    this.name = 'BlobPreconditionFailedError';
    this.code = 'precondition_failed';
    this.status = 412;
  }
}

/** Blob private GET often returns weak validators (W/"..."); put ifMatch expects strong. */
function strongEtag(etag) {
  if (!etag) return '';
  const s = String(etag).trim();
  return s.startsWith('W/') ? s.slice(2) : s;
}


function storeIdFromToken(token) {
  const parts = String(token || '').split('_');
  // vercel_blob_rw_<storeId>_<secret>
  return parts.length >= 4 ? parts[3] : '';
}

function blobHost(storeId, access) {
  return `${storeId}.${access === 'public' ? 'public' : 'private'}.blob.vercel-storage.com`;
}

function apiHeaders(token, storeId, extra = {}) {
  return {
    authorization: `Bearer ${token}`,
    'x-api-version': '12',
    'x-vercel-blob-store-id': storeId,
    ...extra,
  };
}

async function readStream(stream) {
  if (stream == null) return null;
  if (typeof stream === 'string') return stream;
  if (Buffer.isBuffer(stream)) return stream.toString('utf8');
  const res = new Response(stream);
  return res.text();
}

/**
 * @param {string} urlOrPathname
 * @param {{ access:'private'|'public', useCache?: boolean, token: string, abortSignal?: AbortSignal }} options
 */
export async function get(urlOrPathname, options) {
  const { access, token, useCache = true, abortSignal } = options;
  if (access !== 'private' && access !== 'public') throw new Error('access must be private or public');
  const storeId = storeIdFromToken(token);
  if (!storeId) throw new Error('Invalid token: unable to extract store ID');
  const pathname = urlOrPathname.replace(/^\/+/, '');
  let fetchUrl = `https://${blobHost(storeId, access)}/${pathname}`;
  if (useCache === false && access === 'private') {
    const u = new URL(fetchUrl);
    u.searchParams.set('cache', '0');
    fetchUrl = u.toString();
  }
  let response;
  try {
    response = await fetch(fetchUrl, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      signal: abortSignal ?? AbortSignal.timeout(10_000),
      redirect: 'error',
    });
  } catch (e) {
    throw new Error(`Failed to fetch blob: ${e?.message || e}`);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Failed to fetch blob: ${response.status} ${response.statusText}`);
  const etag = strongEtag(response.headers.get('etag') || '');
  const downloadUrl = new URL(`https://${blobHost(storeId, access)}/${pathname}`);
  downloadUrl.searchParams.set('download', '1');
  const lastModified = response.headers.get('last-modified');
  return {
    statusCode: 200,
    stream: response.body,
    headers: response.headers,
    blob: {
      url: `https://${blobHost(storeId, access)}/${pathname}`,
      downloadUrl: downloadUrl.toString(),
      pathname,
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      contentDisposition: response.headers.get('content-disposition') || '',
      cacheControl: response.headers.get('cache-control') || '',
      size: Number(response.headers.get('content-length') || 0),
      uploadedAt: lastModified ? new Date(lastModified) : new Date(),
      etag,
    },
  };
}

/**
 * @param {string} pathname
 * @param {string|Buffer|Blob|ReadableStream} body
 * @param {object} options
 */
export async function put(pathname, body, options) {
  const {
    access, token, allowOverwrite = false, addRandomSuffix = false,
    contentType, cacheControlMaxAge, ifMatch, abortSignal,
  } = options;
  if (access !== 'private' && access !== 'public') throw new Error('access must be private or public');
  const storeId = storeIdFromToken(token);
  if (!storeId) throw new Error('Invalid token: unable to extract store ID');
  const clean = String(pathname).replace(/^\/+/, '');
  const raw = typeof body === 'string' || Buffer.isBuffer(body) ? body : await readStream(body);
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
  const params = new URLSearchParams({ pathname: clean });
  const headers = apiHeaders(token, storeId, {
    'x-vercel-blob-access': access,
    'x-content-type': contentType || 'application/octet-stream',
    'x-add-random-suffix': addRandomSuffix ? '1' : '0',
    'x-allow-overwrite': allowOverwrite ? '1' : '0',
    'x-content-length': String(bytes.byteLength),
  });
  if (cacheControlMaxAge != null) headers['x-cache-control-max-age'] = String(cacheControlMaxAge);
  if (ifMatch) headers['x-if-match'] = strongEtag(ifMatch);
  let response;
  try {
    response = await fetch(`https://vercel.com/api/blob?${params}`, {
      method: 'PUT',
      headers,
      body: bytes,
      signal: abortSignal ?? AbortSignal.timeout(15_000),
      redirect: 'error',
    });
  } catch (e) {
    throw new Error(`Failed to put blob: ${e?.message || e}`);
  }
  if (response.status === 412) throw new BlobPreconditionFailedError();
  if (!response.ok) {
    let code = '';
    let message = '';
    try {
      const j = await response.json();
      code = j?.error?.code || '';
      message = j?.error?.message || JSON.stringify(j);
    } catch { /* ignore */ }
    if (code === 'precondition_failed' || response.status === 412) throw new BlobPreconditionFailedError(message);
    throw new Error(`Failed to put blob: ${response.status} ${message || response.statusText}`);
  }
  const json = await response.json();
  return {
    pathname: json.pathname || clean,
    contentType: json.contentType || contentType,
    contentDisposition: json.contentDisposition || '',
    url: json.url,
    downloadUrl: json.downloadUrl,
    etag: json.etag,
  };
}
