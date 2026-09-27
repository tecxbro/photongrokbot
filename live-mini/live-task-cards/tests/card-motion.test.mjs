import test from 'node:test';
import assert from 'node:assert/strict';
import { dotDelay } from '../public/dot-progress.mjs';
import { renderCard } from '../public/card-template.mjs';
import { payload } from './helpers.mjs';

test('small and large batches always settle within 620ms',()=>{
  for(const n of [1,2,10,50,1000000]) {
    assert.equal(dotDelay(0,n),0);
    assert.ok(dotDelay(n-1,n)+360<=620);
    assert.ok(dotDelay(Math.floor(n/2),n)<=260);
  }
});
test('initial snapshot renders the confirmed meter immediately, including fractional batches',async()=>{
  const c=(await payload()).content;
  c.progress={completed:275,total:1000,unit:'files'};
  const html=renderCard({content:c,updatedAt:new Date().toISOString()});
  assert.match(html,/275 \/ 1000/);
  assert.equal((html.match(/data-fill="full"/g)||[]).length,13);
  const value=Number(html.match(/data-fill="partial"[^>]*><i data-target="([^"]+)"/)[1]);
  assert.ok(Math.abs(value-.75)<1e-9);
});
