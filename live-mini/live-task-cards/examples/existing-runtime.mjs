// Import this factory into your EXISTING shared Spectrum process, not into the Vercel host.
// The caller supplies the already installed spectrum-ts builders; this package installs no SDK.
import { PublisherClient } from '../src/client.mjs';
import { createSpectrumPresenter, createTaskCardRuntime, MemoryTargets } from '../src/spectrum-presenter.mjs';

export function attachLiveTaskCards({ app, originalTargets, baseUrl, publisherToken, resolveOwner, authorizeLoaderChange }) {
  const client = new PublisherClient({ baseUrl, token: publisherToken });
  const presenter = createSpectrumPresenter({ app, targets: originalTargets });
  return createTaskCardRuntime({ client, presenter, resolveOwner, authorizeLoaderChange });
}

/*
Inside the existing runtime, once:

import { app } from 'spectrum-ts';
import { attachLiveTaskCards } from './live-task-cards/examples/existing-runtime.mjs';
import { MemoryTargets } from './live-task-cards/src/spectrum-presenter.mjs';

const liveCards = attachLiveTaskCards({
  app,
  originalTargets: new MemoryTargets(), // Optional send audit; progress needs no message session.
  baseUrl: process.env.LIVE_CARDS_BASE_URL,
  publisherToken: process.env.LIVE_CARDS_PUBLISHER_TOKEN,
});

// Within your existing authorized queue/executor handler, with the original Space:
const started = await liveCards.start(createPayload, originalSpace);
const changed = await liveCards.update(started.record.id, updatePayload, originalSpace); // JSON write only.

// Register these exported functions through your existing validated invocation mechanism.
// Do not invent enqueue flags, instantiate another Spectrum, or route to the first configured line.
*/
