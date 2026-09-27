# Derive character motion, minimum resolution, and a natural loop

Use this when the user provides a new recording or the existing character loses identity, eye direction, or loop continuity. The starter's Grokbot motion does not need re-extraction merely to change task labels.

## Extract character facts first

Inspect video dimensions, duration, and presentation timestamps with FFprobe. Extract at native rate or a rate demonstrably sufficient to resolve the fastest eye movement. Use OpenCV or equivalent numerical tools for crops and masks; generate a contact sheet of actual representative poses before fitting dots.

Use a fixed crop containing the full motion extent. Per-frame recentering/scaling erases body translation and scale. Exclude surrounding interface, badges, captions, and activity indicators. Document obscured regions rather than claiming hidden source pixels are known.

Measure outer silhouette and each eye separately. Useful pose channels are body centroid/scale/contour, each eye centroid/width/height/orientation, and timestamps. Keep eye motion independent of body motion when the recording does. Include observed gaze extremes, slants, body extremes, fast turns, and quiet intervals. Do not invent a blink or named activity state absent from the source.

## Find the smallest convincing matrix

For an optimization request, start at the requested size; otherwise 16×12 is a useful initial experiment, not a predetermined answer. Render and assess one candidate before increasing resolution. A practical progression is 16×12, 18×14, 20×15, then small increments only when evidence warrants them.

Estimate sub-cell coverage of the silhouette and subtract eye coverage, then quantize to roughly 3–5 useful brightness levels. Sample densely enough for stable coverage (the Grokbot work used 12×12 samples per cell). Fractional edge intensities preserve curves and sub-cell movement; they must not erase dark eye cores. Adjust grid alignment and eye-edge quantization before concluding that more dots are necessary.

Compare normalized character-only masks and corresponding previews, not the full source UI. Weight eye accuracy strongly: centroid, slant/orientation, two distinct negative-space openings, and correct up/down/sideward gaze. Also assess silhouette overlap, body centroid/scale, movement direction, and pauses. Pixel similarity alone can reward a generic round face while losing the behavior.

Stop at the first candidate that retains recognizable silhouette, independent gaze, visible slants, relevant body motion, and source rhythm while the individual circles remain obvious. Record lower-resolution failures. If a square grid is required, retest a square candidate or prove that any discarded padding is inactive throughout; do not stretch a rectangular character to fit.

Keep full measured frame data for debugging; reduce to keyframes only when a bounded interpolation error and visual comparison support it. The renderer consumes intensities, not video frames or vector eye overlays.

## Find the actual repeat, not the video boundary

A screen recording can begin partway through a cycle and contain one whole repeat plus a partial repeat. Its first and last frames are usually arbitrary. Start with recurrence in measured pose channels, then validate candidate intervals against the rendered dots.

For candidates separated by a meaningful motion duration:

1. Compare body shape/location/scale and both eyes' centroid, dimensions, and angle. Reject an apparent match that loses one eye or depends on occlusion.
2. Compare local motion at the **same phase** using short windows around each endpoint. Matching pose with opposite velocity still jumps or reverses. Account for source sampling noise.
3. Check that the retained interval includes the needed gaze range, body movement, pauses, and personality; a tiny idle oscillation is not a substitute for the whole behavior.
4. Prefer endpoints with identical or perceptually equivalent dot states and consistent movement. Inspect surrounding frames, not only two stills.

Do not demand that long incoming/outgoing averages be perfectly parallel when the reference follows a curve. Compare the ending neighborhood with the corresponding source neighborhood at the start. Separately inspect the actual rendered speed across the wrap.

Store loop start/end independently of full source duration. Sample cyclic source time directly, excluding a duplicated closing frame or appended hold. Keep the character clock independent of task updates and tap-transition clocks.

Do not automatically append an eased fade between distant poses: it can remove the eyes briefly, decelerate to zero, and visibly restart. Do not automatically reverse playback either; that changes the reference behavior. If no suitable repeated interval exists, explain the limitation. A separately authored closing motion needs continuous feature trajectories and the user's scope to permit synthesis; a crossfade is not proof of a natural loop.

## Acceptance evidence

Render at intended card size, with the real circular-dot renderer. Keep a source/matrix comparison for newly extracted footage and capture normal-speed playback plus frames around the boundary.

Inspect at least four repeats. Check both eyes' darkness/area and centroids across the seam, movement direction/speed, and body continuity. A test that only checks bounded intensities or verifies modulo time misses a visible restart. Compare at 30/60/120fps and exercise a tap immediately before a wrap, interrupted transitions, task updates during character view, and reduced motion.

Grokbot example, for calibration only: 2.358333s and 10.325s yielded identical dot matrices; maximum eye-centroid difference was 0.028 source pixels; matching-phase eye-velocity cosine exceeded 0.9999; the retained gaze range was 100%. The resulting period was 7.966667s. Find these values again for another source—never copy them as a universal loop recipe.
