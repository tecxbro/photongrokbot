import { afterEach, describe, expect, test } from 'bun:test';
import { fixture } from './tests/storage/fixture.ts';
import { openStore } from './storage.ts';
import { InboundController, type InboundMessage, type InboundSpace } from './inbound-controller.ts';
import { readOnboarding } from './onboarding.ts';
import { isGreetingOnlyBatch } from './greeting.ts';
const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); });
function setup() { const f = fixture(); cleanup.push(f.cleanup); return f; }
const owner = '+15555550199';
function space(id = 'space-one', phone = 'shared'): InboundSpace { return { id, phone, type: 'dm' }; }
function message(id: string, text: string, origin = space()): InboundMessage { return { id, direction: 'inbound', platform: 'imessage', sender: { id: owner }, timestamp: new Date(1700000000000), space: { id: origin.id, phone: origin.phone }, content: { type: 'text', text } }; }

describe('durable authorized reception', () => {
  test('U01 first hi produces one greeting-confetti operation, repeated hi routes to Front Door', () => {
    const { store } = setup(); const receiver = new InboundController({ store, authorizedSenderId: owner });
    const first = receiver.receive(space(), message('first', 'hi')); expect(first.status).toBe('accepted');
    expect(receiver.flushAll()).toHaveLength(0); const out = store.listOutbound(); expect(out).toHaveLength(1); expect(out[0]!.kind).toBe('text'); expect((out[0] as any).effect).toBe('confetti');
    receiver.receive(space(), message('second', 'hi')); const batch = receiver.flushAll(); expect(batch).toHaveLength(1); expect(batch[0]!.messages[0]!.text).toBe('hi'); expect(store.listOutbound()).toHaveLength(1);
  });
  test('U02 first substantive question gets onboarding and durable Front Door work', () => {
    const { store } = setup(), receiver = new InboundController({ store, authorizedSenderId: owner });
    receiver.receive(space(), message('question', 'find three hotels')); expect(store.listOutbound()).toHaveLength(1); expect(receiver.flushAll()[0]!.messages[0]!.text).toBe('find three hotels');
  });
  test('U03 voice accepts and celebrates before any bytes; failed STT remains correlated and text continues', () => {
    const { store } = setup(), receiver = new InboundController({ store, authorizedSenderId: owner }); let reads = 0;
    const voice = message('voice', ''); voice.content = { type: 'voice', id: 'attachment-original', name: 'sample.m4a', read: async () => { reads++; throw new Error('synthetic failed media'); } };
    const accepted = receiver.receive(space(), voice); expect(accepted.status).toBe('accepted'); expect(reads).toBe(0); expect(store.listOutbound()).toHaveLength(1);
    receiver.receive(space(), message('later-text', 'also make it under $100')); const batches = receiver.flushAll(); expect(batches).toHaveLength(1); expect(batches[0]!.messages).toHaveLength(2);
    const job = store.claimMedia()!; expect(job.reference.attachmentId).toBe('attachment-original'); store.settleMedia(job.id, { state: 'unavailable', code: 'SYNTHETIC_UNAVAILABLE' }, job.attempts);
    const enriched = store.readBatch(batches[0]!.batchId); expect(enriched.media?.[0]?.state).toBe('unavailable'); expect(enriched.messages[1]!.text).toBe('also make it under $100'); expect(receiver.flushAll()).toHaveLength(0);
  });
  test('U04 unauthorized input, echo and receipt persist nothing and never read attachment bytes', () => {
    const { store } = setup(), receiver = new InboundController({ store, authorizedSenderId: owner }); let reads = 0;
    const incoming = message('private', ''); incoming.content = { type: 'attachment', read: async () => { reads++; return new Uint8Array(); } }; incoming.sender = { id: '+15555550200' };
    expect(receiver.receive(space(), incoming).status).toBe('ignored'); incoming.sender = { id: owner }; incoming.direction = 'outbound'; expect(receiver.receive(space(), incoming).status).toBe('ignored'); incoming.direction = 'inbound'; incoming.content = { type: 'read' }; expect(receiver.receive(space(), incoming).status).toBe('ignored');
    expect(reads).toBe(0); expect(store.recentInbound()).toHaveLength(0); expect(readOnboarding(store).reserved).toBe(false);
  });
  test('U05 duplicate/restart/unknown retain original onboarding identity without another send', () => {
    const { store, paths } = setup(), receiver = new InboundController({ store, authorizedSenderId: owner }), input = message('same-event', 'hi');
    receiver.receive(space(), input); const identity = readOnboarding(store).outboundIds;
    const attempt = store.claimOutbound()!; store.settleOutbound(attempt.item.id, attempt.attemptId, { state: 'unknown', code: 'SYNTHETIC_TIMEOUT' });
    const restartedStore = openStore({ paths }); try { const restarted = new InboundController({ store: restartedStore, authorizedSenderId: owner }); const replay = restarted.receive(space(), input); expect(replay.status === 'accepted' && replay.result.duplicate).toBe(true); expect(readOnboarding(restartedStore).outboundIds).toEqual(identity); expect(restartedStore.listOutbound()).toHaveLength(1); expect(restarted.flushAll()).toHaveLength(0); } finally { restartedStore.close(); }
  });
  test('U06/U07 contextual okay, thanks, yeah and mixed reactions always reach Front Door', () => {
    const { store } = setup(), receiver = new InboundController({ store, authorizedSenderId: owner }); receiver.receive(space(), message('question', 'find a hotel'));
    for (const text of ['okay', 'yeah', 'thanks']) receiver.receive(space(), message(text, text));
    const reaction = message('reaction-sequence', ''); reaction.content = { type: 'reaction', emoji: '👎', target: { id: 'prior-card', space: { id: space().id } } }; receiver.receive(space(), reaction);
    const batch = receiver.flushAll()[0]!; expect(batch.messages).toHaveLength(5); expect(isGreetingOnlyBatch(batch.messages)).toBe(false); expect(batch.messages.at(-1)?.emoji).toBe('👎');
  });
  test('U08 exact older reply target, known poll identity and two destination/line pairs remain isolated', () => {
    const { store } = setup(), receiver = new InboundController({ store, authorizedSenderId: owner });
    const older = message('reply-new', ''); older.content = { type: 'reply', target: { id: 'older-message', space: { id: 'space-one', phone: 'shared' } }, content: { type: 'text', text: 'choose that one' } }; receiver.receive(space(), older);
    const second = space('space-two', '+15555550001'); const poll = message(`poll-guid:${owner}:option-guid:selected:1700000000000`, '', second); poll.content = { type: 'poll_option', title: 'Pizza', option: { title: 'Pizza' }, poll: { type: 'poll', title: 'Lunch' }, selected: true }; receiver.receive(second, poll);
    const batches = receiver.flushAll(); expect(batches).toHaveLength(2); const reply = batches.find(b => b.destination?.spaceId === 'space-one')!.messages[0]!; expect(reply.replyToMessageId).toBe('older-message'); const vote = batches.find(b => b.destination?.spaceId === 'space-two')!.messages[0]!; expect(vote.pollMessageId).toBe('poll-guid'); expect(vote.pollOptionId).toBe('option-guid'); expect(vote.id).toBe(poll.id); expect(vote.lineId).toBe(second.phone!);
  });
  test('U08 rejects mismatched provider space/target but preserves existing authorized group scope', () => {
    const { store } = setup(), receiver = new InboundController({ store, authorizedSenderId: owner }); const wrong = message('wrong', 'hi', space('different'));
    expect(receiver.receive(space(), wrong).status).toBe('ignored'); const cross = message('cross', ''); cross.content = { type: 'reply', target: { id: 'foreign', space: { id: 'foreign-space' } }, content: { type: 'text', text: 'hello' } }; expect(receiver.receive(space(), cross).status).toBe('ignored');
    const group = { ...space('existing-group'), type: 'group' }; expect(receiver.receive(group, message('group-input', 'hi there', group)).status).toBe('accepted');
  });
  test('D02 commit failure occurs before any receive side effect and leaves no false accepted result', () => {
    const { store } = setup(); let touched = 0;
    const receiver = new InboundController({ store: { accept: () => { throw new Error('SYNTHETIC_COMMIT_FAILURE'); }, formBatches: store.formBatches.bind(store) }, authorizedSenderId: owner });
    const media = message('crash', ''); media.content = { type: 'attachment', read: async () => { touched++; return new Uint8Array(); } };
    expect(() => receiver.receive(space(), media)).toThrow('SYNTHETIC_COMMIT_FAILURE'); expect(touched).toBe(0); expect(store.recentInbound()).toHaveLength(0);
  });
  test('W02 independently due conversations, boot recovery and stop never lose pending acceptance', () => {
    const { store } = setup(); let clock = 10000; const receiver = new InboundController({ store, authorizedSenderId: owner, clock: () => clock, debounceMs: 1000 });
    receiver.receive(space(), message('a', 'question a')); clock = 10500; const second = space('second'); receiver.receive(second, message('b', 'question b', second));
    expect(receiver.flushDue(11000).map(b => b.destination?.spaceId)).toEqual(['space-one']); expect(receiver.flushDue(11499)).toHaveLength(0); expect(receiver.flushDue(11500).map(b => b.destination?.spaceId)).toEqual(['second']);
    receiver.receive(space(), message('c', 'durable before reboot')); const restarted = new InboundController({ store, authorizedSenderId: owner }); expect(restarted.flushAll()).toHaveLength(1);
    receiver.receive(space(), message('d', 'durable before stop')); expect(receiver.stop()).toHaveLength(1); expect(receiver.receive(space(), message('e', 'after stop')).status).toBe('ignored');
  });
});


test('D03 batches above storage page size retain a due continuation across recovery flush', () => {
  const { store } = setup(), receiver = new InboundController({ store, authorizedSenderId: owner, debounceMs: 0 });
  for (let i = 0; i < 251; i++) receiver.receive(space(), message(`page-${i}`, `question ${i}`));
  const first = receiver.flushAll(); expect(first[0]!.messages).toHaveLength(250);
  const second = receiver.flushDue(); expect(second[0]!.messages).toHaveLength(1); expect(receiver.flushDue()).toHaveLength(0);
});
