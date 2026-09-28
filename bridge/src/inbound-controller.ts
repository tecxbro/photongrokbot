import { createHash } from 'node:crypto';
import type { AcceptResult, BridgeStore, Destination, MediaReference } from './contracts.ts';
import type { InboundRecord, UnreadBatch } from './types.ts';
import { shapeInboundContent, snapshotInboundContent, toInboundRecord, type ContentLike } from './inbound.ts';
import { onboardingAcceptance } from './onboarding.ts';

/** Exact fields consumed from spectrum-ts/imessage 12.8.0's exposed records. */
export type InboundSpace = { id: string; phone?: string; type?: string };
export type InboundMessage = { id: string; direction: string; platform: string; sender?: { id: string }; timestamp: Date; content: unknown; space?: { id: string; phone?: string } };
export type ReceiveResult = { status: 'ignored'; reason: 'stopped' | 'outbound' | 'platform' | 'unauthorized' | 'invalid-context' | 'unsupported' } | { status: 'accepted'; result: AcceptResult; record: InboundRecord; destination: Destination; mediaReference?: MediaReference; readableContent?: ContentLike };
type Store = Pick<BridgeStore, 'accept' | 'formBatches'>;
export type InboundControllerOptions = { store: Store; authorizedSenderId: string; clock?: () => number; debounceMs?: number; maxDebounceMs?: number; enrichInbound?: (record: InboundRecord, destination: Destination) => InboundRecord };

function plainContent(content: ContentLike): ContentLike | undefined {
  let current: ContentLike | undefined = content;
  for (let depth = 0; depth <= 8; depth++) { if (current?.type !== 'reply') return current; current = current.content; }
}
function targetScopeMatches(content: ContentLike | undefined, destination: Destination, depth = 0): boolean {
  if (!content || depth > 8) return false;
  if (content.target?.space && (content.target.space.id !== destination.spaceId || (content.target.space.phone !== undefined && content.target.space.phone !== destination.lineId))) return false;
  return content.type === 'reply' ? targetScopeMatches(content.content, destination, depth + 1) : true;
}
/** Poll identity is synthesized by locked provider buildPollOptionMessage, not a guessed SDK field. */
function pollIdentity(message: InboundMessage, selected: boolean | undefined): { pollMessageId?: string; pollOptionId?: string } {
  const ending = /:(selected|deselected):(\d+)$/.exec(message.id);
  if (!ending || Number(ending[2]) !== message.timestamp.getTime() || (ending[1] === 'selected') !== selected) return {};
  const body = message.id.slice(0, ending.index), marker = `:${message.sender!.id}:`, index = body.indexOf(marker);
  if (index <= 0 || body.indexOf(marker, index + marker.length) !== -1) return {};
  const option = body.slice(index + marker.length); if (!option) return {};
  return { pollMessageId: body.slice(0, index), pollOptionId: option };
}

export class InboundController {
  private readonly due = new Map<string, { destination: Destination; first: number; due: number }>();
  private readonly clock: () => number;
  private readonly debounce: number;
  private readonly maximum: number;
  private stopped = false;
  constructor(private readonly options: InboundControllerOptions) {
    if (!options.authorizedSenderId) throw new Error('INBOUND_AUTHORIZATION_REQUIRED');
    this.clock = options.clock ?? Date.now; this.debounce = options.debounceMs ?? 2000; this.maximum = options.maxDebounceMs ?? 10000;
    if (!Number.isFinite(this.debounce) || this.debounce < 0 || this.maximum < this.debounce || this.maximum > 60000) throw new Error('INBOUND_DEBOUNCE_INVALID');
  }
  /** Synchronous acceptance precedes all runtime reads/receipts/media notifications. */
  receive(space: InboundSpace, message: InboundMessage): ReceiveResult {
    if (this.stopped) return { status: 'ignored', reason: 'stopped' };
    if (message.direction !== 'inbound') return { status: 'ignored', reason: 'outbound' };
    if (message.platform !== 'imessage') return { status: 'ignored', reason: 'platform' };
    if (message.sender?.id !== this.options.authorizedSenderId) return { status: 'ignored', reason: 'unauthorized' };
    if (!space.id || !space.phone || !message.id || (message.space && (message.space.id !== space.id || (message.space.phone !== undefined && message.space.phone !== space.phone)))) return { status: 'ignored', reason: 'invalid-context' };
    const destination = { spaceId: space.id, lineId: space.phone };
    const content = snapshotInboundContent(message.content);
    if (!content) return { status: 'ignored', reason: 'unsupported' };
    if (!targetScopeMatches(content, destination)) return { status: 'ignored', reason: 'invalid-context' };
    const shaped = shapeInboundContent(content); if (!shaped) return { status: 'ignored', reason: 'unsupported' };
    if (shaped.kind === 'text' && !shaped.text.trim()) return { status: 'ignored', reason: 'unsupported' };
    const now = this.clock();
    let record = toInboundRecord(shaped, { id: message.id, spaceId: space.id, lineId: space.phone, senderId: message.sender.id, timestamp: message.timestamp.toISOString(), receivedAt: new Date(now).toISOString(), ...(shaped.kind === 'poll_vote' ? pollIdentity(message, shaped.pollSelected) : {}) });
    if (this.options.enrichInbound) record = this.options.enrichInbound(record, destination);
    if (record.spaceId !== space.id || record.lineId !== space.phone || record.id !== message.id || record.senderId !== message.sender.id) throw new Error('INBOUND_ENRICHMENT_BINDING_CONFLICT');
    const mediaReference: MediaReference | undefined = shaped.kind === 'attachment' || shaped.kind === 'voice' ? { messageId: message.id, spaceId: space.id, lineId: space.phone, kind: shaped.kind, ...(shaped.attachmentId ? { attachmentId: shaped.attachmentId } : {}), ...(shaped.attachmentName ? { name: shaped.attachmentName } : {}), ...(shaped.attachmentMimeType ? { mimeType: shaped.attachmentMimeType } : {}), ...(shaped.attachmentBytes !== undefined ? { size: shaped.attachmentBytes } : {}), ...(shaped.attachmentDuration !== undefined ? { duration: shaped.attachmentDuration } : {}) } : undefined;
    if (mediaReference) record.mediaState = 'pending';
    const eventKey = `imessage:${createHash('sha256').update(JSON.stringify([message.id, shaped.kind])).digest('hex')}`;
    const result = this.options.store.accept({ eventKey, record, destination, ...(mediaReference ? { media: mediaReference } : {}), ...onboardingAcceptance(record) });
    if (!result.duplicate) {
      const key = JSON.stringify([destination.spaceId, destination.lineId]), previous = this.due.get(key), first = previous?.first ?? now;
      this.due.set(key, { destination, first, due: Math.min(now + this.debounce, first + this.maximum) });
    }
    return { status: 'accepted', result, record, destination, ...(mediaReference ? { mediaReference, readableContent: plainContent(content) } : {}) };
  }
  flushDue(now = this.clock()): UnreadBatch[] {
    const due = [...this.due.entries()].filter(([, value]) => value.due <= now);
    if (!due.length) return [];
    const batches = this.options.store.formBatches(now, due.map(([, value]) => value.destination));
    for (const [key] of due) this.due.delete(key);
    this.retainFullGroups(batches, now);
    return batches;
  }
  /** Boot recovery and orderly shutdown flush durable pending work, independent of RAM timers. */
  flushAll(now = this.clock()): UnreadBatch[] {
    const batches = this.options.store.formBatches(now); this.due.clear(); this.retainFullGroups(batches, now); return batches;
  }
  private retainFullGroups(batches: UnreadBatch[], now: number) {
    // Store caps each group at 250. Keep a due continuation until that group drains.
    for (const batch of batches) if (batch.messages.length >= 250 && batch.destination) {
      const destination = batch.destination, key = JSON.stringify([destination.spaceId, destination.lineId]);
      this.due.set(key, { destination, first: now, due: now });
    }
  }
  stop(): UnreadBatch[] { this.stopped = true; return this.flushAll(); }
}
