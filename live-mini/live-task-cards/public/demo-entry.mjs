// Static hosted examples use the same query-controlled playback as the local host.
import { renderCard } from '/card-template.mjs';
const params = new URLSearchParams(location.search);
const name = location.pathname.split('/').filter(Boolean).at(-1);
const research = name === 'research' && params.get('play') === '1';
const variant = ['checks', 'stages'].includes(name) && params.get('play') === '1';
if (research || variant) {
  const node = document.getElementById('card-data');
  const view = JSON.parse(node.textContent);
  view.content.eyebrow = 'DEMO';
  view.content.stages.forEach((stage, i) => { stage.state = i === 0 ? 'active' : 'pending'; });
  if (view.content.progress) view.content.progress.completed = 0;
  if (research) {
    view.content.detail = { title: 'Sourcing', subtitle: 'Collecting company leads' };
    document.body.classList.add('playback-page');
    const controls = document.createElement('div'); controls.className = 'playback-controls';
    controls.innerHTML = '<button id="play-from-start" type="button">Play from dot 1</button><p id="playback-note" role="status">Preview only · simulated Grokbot updates</p>';
    document.getElementById('card-root').before(controls);
  }
  node.textContent = JSON.stringify(view);
  document.getElementById('card-root').innerHTML = renderCard(view);
}
await import(name === 'matrix' ? '/matrix-demo-playback.mjs' : research ? '/demo-playback.mjs' : variant ? '/demo-variants-playback.mjs' : '/card-client.mjs');
