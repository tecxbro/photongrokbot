# Starter contract and adaptation points

The bundled `assets/starter/` is the final Grokbot implementation, not an illustrative mock. `scripts/scaffold.py` copies it without depending on the original project. It refuses to overwrite an existing destination.

## Runtime and entrypoints

- `index.html`: clean single card, A by default. `?transition=dissolve` selects B; `?debug` or D reveals development inputs.
- `compare.html`: same task data and clock in two independent cards. Shared controls update both; clicking a card toggles that card alone.
- `dot-matrix.js`: character-independent Canvas circles; accepts one 0–1 intensity per cell and scales for device pixel ratio.
- `mini-core.js`: progress mapping, source-frame interpolation, measured-cycle sampling, and analytic damped springs.
- `mini-card.js`: task data, view toggles, activity history, accessibility, and character timing.
- `mini-demo.js`: explicit fixture data, manual development controls, requestAnimationFrame driver, and hidden-page suspension.
- `square-animation.js`: complete reference-derived Grokbot frame data plus loop metadata.

These names are implementation details of this starter. Do not require an existing application to adopt these globals or filenames merely to reuse its behavior.

## Data and control API

```js
GrokbotMini.setState({
  progress: { completed: 63, total: 100 },
  activity: { icon: 'verifying', label: 'Verifying company profiles' },
});
GrokbotMini.setState({
  activityHistory: [
    { icon: 'researching', label: 'Collected company sources' },
    { icon: 'verifying', label: 'Verifying company profiles' },
  ],
});
GrokbotMini.toggleView();
GrokbotMini.setTransitionStyle('morph'); // 'morph' or 'dissolve'
GrokbotMini.setState({ mode: 'grokbot' }); // 'grokbot' or 'progress'
```

History is chronological; its last item is current. A supplied history replaces the local list and displays its latest three entries. An activity-only update appends a changed action. Supported icons are `planning`, `verifying`, `researching`, `analyzing`, `report`, and `working`. Text and history describe supplied actions, not inferred completed stages.

A measured positive total is required by this starter. If the new product needs unknown totals, extend the presentation deliberately; do not fabricate a denominator or reuse 41/100 as real work. At 41/100, the 196-dot display uses 80 full dots and one at 36% intensity, plus the exact text count.

`GrokbotMini.state` exposes view, current count/activity/history, character time, intensities, and transition velocities for inspection. No mutation is sent to a backend.

## Geometry and transitions

The approved card has matrix origin (66,5), pitch 12px, radius 4.2px, and clear 3.6px gaps. The footer starts at y=181 with three 18px rows; current action and count share the bottom baseline. Long labels should be inspected with the real supplied content, not only the short fixture.

Changing resolution requires updating **both** renderer configuration and progress-array length. The current card and default radial-stagger helper assume 14×14/196 cells; do not replace only the animation data and leave those assumptions behind. Changing size requires recalculating matrix/footer geometry while keeping it identical across views.

The view spring uses angular frequency 16 with up to 120ms radial delay for A; B has zero delay. Reverse A's radial ordering on return. Both share an 820ms minimum transition window and wait for settled spring state before advancing the character. Confirmed progress uses a faster spring (36). These are tuned defaults; do not add a new delay on every animation loop.

For a cell with displacement x from its target, velocity v, frequency w, and elapsed dt:

```text
c = v + w*x
x_next = (x + c*dt) * exp(-w*dt)
v_next = (v - w*c*dt) * exp(-w*dt)
```

Retarget from the current value and velocity. Clamp physical intensity to 0–1; do not reset velocity just because the desired view changes. The spring belongs to the view transition, not the repeating character sequence.

## Reference frame encoding

```js
{
  columns: 14, rows: 14, duration: 11.175,
  loop: { start: 2.358333, end: 10.325 },
  frames: [ /* [sourceSeconds, rowMajorDigitString], ... */ ]
}
```

Each digit 0–4 stores a quarter-intensity step; decoded and interpolated output can use any intensity in 0–1. One frame string has `columns * rows` digits. Preserve increasing original timestamps. `sample()` addresses the full source; `sampleLoop()` addresses `loop.start + elapsed % (loop.end - loop.start)`.

The bundled period is 7.966667s, measured from this reference only. All 492 keyframes remain stored. The 14×14 display came from cropping four always-off side columns from the validated 18×14 reconstruction, with no loss of retained cells. Neither fact establishes the minimum resolution or period of another character.

## Deterministic preview checks

Loading either preview with `?capture` enables a monotonic development clock:

```js
MatrixPreview.setTime(1);
MatrixPreview.toggleBoth();
MatrixPreview.setTime(1.23);
MatrixPreview.toggleBoth(); // interruption from current brightness/velocity
MatrixPreview.setState({ progress: { completed: 63, total: 100 } });
```

`MatrixPreview.cards` exposes the component instances. Advance in actual frame-size increments when measuring playback; a large time jump can finish a transition but does not simulate every intervening rendered frame. Use actual click/key events in browser interaction tests rather than only invoking these helpers.
