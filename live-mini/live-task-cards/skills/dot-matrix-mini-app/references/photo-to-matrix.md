# Convert a still photo or illustration

Use for portraits, animals, objects, logos, illustrations, or scenes. The input can be any supported image, but recognizability at a tiny matrix is not guaranteed. A busy scene may need a tighter crop or more dots than a simple character. Do not claim that every photo works at 14×14.

## Choose what to preserve

Inspect the actual image first, accounting for orientation and transparency. Follow the user's crop or subject selection. Otherwise retain the whole image when it is the intended composition; isolate the obvious main subject when the request is to turn that subject into a character. Ask only when multiple subjects make this a meaningful unresolved choice.

Choose the representation based on the image:

- **Character, logo, or isolated object:** estimate silhouette coverage and retain identifying negative spaces. For faces/animals, measure eyes and other essential landmarks independently of the outline. Avoid turning every subject into Grokbot's round body and two eye holes.
- **Photograph or scene:** preserve structure with cell-average monochrome luminance and a few brightness levels. Keep important local contrast. A silhouette-only representation would discard the scene's contents.

If a subject mask is needed, derive and inspect it from the image; do not assume a background was removed merely by converting to grayscale. Preserve the user's color-polarity preference. Choose bright-subject/dark-background treatment only when it improves the intended recognition, and disclose material cropping or simplification.

## Compute actual dot states

Map the image/crop into the requested matrix without stretching its aspect ratio. Preserve clear margins when fitting a rectangular subject into a square. Keep matrix geometry independent from source-image dimensions.

For each logical cell, integrate several sub-cell samples of the chosen luminance or silhouette mask. Subtract measured dark features when using a lit silhouette. Quantize to approximately 3–5 visually distinct brightness levels and return row-major values in 0–1. Inspect small identifying features after quantization; global pixel similarity is insufficient for a face.

Use the bundled `assets/starter/dot-matrix.js` renderer in a minimal HTML/Canvas page. It draws one stationary circular dot per state value. Do not render the original photo under or over the dots, use an image as the visible fill, or add vector eyes. Keep inactive circles visible and dot diameter around 70% of pitch so the display stays visibly physical.

For a still output, a single intensity array is sufficient. Do not fabricate an animation duration or loop range simply to fit the video data format. If a progress/subject toggle is requested, hold the still target while reusing the reversible brightness-transition mechanism.

## Optimize and compare

Start with the user's requested grid. Without one, try a coarse candidate such as 16×16 for a square display, choosing a rectangular grid when that better matches the requested composition. This is a first experiment, not an acceptance result.

Render one candidate at the intended physical size, next to the chosen source crop. Check the features that make this specific image recognizable: silhouette, face/eye positions, expression, object contours, or major scene structures. Adjust crop, alignment, and tonal contrast where justified. Increase resolution in small increments only when identifying information is still lost; stop when it reads clearly while the circles remain distinct.

Do not claim a mathematically minimum resolution from a small search. Report attempted grids, important losses, and the first acceptable result. For difficult photos, explain the fidelity-versus-dot-size tradeoff rather than silently producing a dense raster or an unrelated simplified face.

## If animation is requested

A photo establishes appearance, not observed behavior. Label any added blinking, gaze, bobbing, or tilt as authored motion; do not claim it was extracted from the still. Follow the user's requested action, or resolve an important motion preference before choosing one.

Animate subject/feature coordinates or masks and resample their coverage into the fixed grid so movements do not teleport across cells. Preserve intensity transitions, eye identity, and circular separated dots. Build a periodic trajectory with matching position and velocity at its wrap, then verify several cycles. Do not paste the bundled Grokbot animation onto an unrelated face.

If accurate existing behavior matters, use a supplied video and the [reference-motion workflow](reference-motion.md). A still does not establish unseen angles or expressions; do not describe synthesized ones as faithful source measurements.
