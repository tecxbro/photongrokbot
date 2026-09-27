import { CardError, assert } from './errors.mjs';

/** Trusted server-side publisher client. Never import this into the browser. */
export class PublisherClient {
  constructor({ baseUrl, token, fetchImpl = fetch }) {
    const url = new URL(baseUrl);
    assert(!url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
      'CONFIG_ERROR', 'Publisher base URL must be a bare origin.');
    assert(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)),
      'CONFIG_ERROR', 'Publisher requests require HTTPS except on loopback.');
    assert(typeof token === 'string' && token.length >= 32, 'CONFIG_ERROR', 'Publisher token is missing.');
    this.baseUrl = url.origin; this.token = token; this.fetch = fetchImpl;
  }
  async call(path, method = 'GET', body) {
    let response;
    try {
      response = await this.fetch(new URL(path, this.baseUrl), {
        method, headers: { Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20_000), redirect: 'error',
      });
    } catch { throw new CardError('HOST_UNAVAILABLE', 'Publisher response unavailable. Reconcile using the same request/card identity; do not blindly send again.', 503); }
    let value;
    try { value = await response.json(); } catch { throw new CardError('HOST_RESPONSE', 'Card host did not return JSON.', 502); }
    if (!response.ok) throw new CardError(value.error?.code || 'HOST_ERROR', value.error?.message || 'Card request failed.', response.status);
    return value;
  }
  getLoader(ownerRef) { return this.call(`/api/loader-preference?ownerRef=${encodeURIComponent(ownerRef)}`); }
  setLoader(body) { return this.call('/api/loader-preference', 'PUT', body); }
  create(body) { return this.call('/api/cards', 'POST', body); }
  get(id) { return this.call(`/api/cards/${encodeURIComponent(id)}`); }
  update(id, body) { return this.call(`/api/cards/${encodeURIComponent(id)}`, 'PUT', body); }
  slots() { return this.call('/api/slots'); }
  doctor() { return this.call('/api/doctor'); }
  beginPresentation(id, revision) { return this.call(`/api/cards/${encodeURIComponent(id)}/presentation/begin`, 'POST', { revision }); }
  settlePresentation(id, settlement) { return this.call(`/api/cards/${encodeURIComponent(id)}/presentation/settle`, 'POST', settlement); }
  release(id, expectedRevision) { return this.call(`/api/cards/${encodeURIComponent(id)}/release`, 'POST', { expectedRevision }); }
  discard(id) { return this.call(`/api/cards/${encodeURIComponent(id)}/discard`, 'POST', {}); }
}
