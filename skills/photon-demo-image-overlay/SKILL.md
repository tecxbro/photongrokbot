---
name: Photon Demo Image Overlay
description: >-
  Use when creating or specifying consistent editorial image overlays for Photon
  demos — hotel, event, product, and experience cards — including
  image-generation prompts, background generation, or overlays on existing
  imagery. Keep artwork variable and typography, gradient, spacing, and branding
  locked across each set. When asked only for a prompt or guideline, do not
  generate images.
---
# Photon Demo Image Overlay

## 1. Purpose and governing rule

Create standalone, full-bleed editorial images with a consistent information overlay. This skill controls the composition and overlay of the image asset, not an entire app interface, a Messages screenshot, or a video frame.

**The artwork changes. The overlay does not. Compose the image around the overlay; do not move the overlay around the image.**

A hotel card and a matcha-event card may have completely different photography and mood while sharing the same information hierarchy, typography, margins, gradient, and logo placement. Do not make every subject look like a hotel advertisement or every image look like a matcha campaign.

This proposed v1 is derived from the existing Villa Amara / matcha campaign brief. It converts that brief's approximate sizes into fixed working tokens. The intermediate gradient stops, optional price-qualifier row, and general-purpose handling rules are new specifications, not measurements of previously generated images.

Explicit task-specific instructions take precedence. Establish any required override once before producing the set; never reinterpret the template independently for each image.

## 2. Inputs and operating mode

Read the current demo brief and supplied assets before composing. Resolve these fields from the supplied material:

| Field | Meaning |
|---|---|
| `brand_logo_asset` | Exact approved logo asset for the brand being demonstrated. |
| `title` | Exact hotel, event, product, or experience name. |
| `metadata` | Short context line, such as location and dates. |
| `features` | Concise, approved distinguishing details. |
| `price` | Exact displayed amount, when applicable. |
| `price_qualifier` | Supplied pricing unit or qualifier, when required to preserve meaning. |
| `background_direction` | Subject, setting, medium, lighting, palette, and composition. |
| `background_asset` | Existing image to use, when supplied. |
| `output_mode` | Prompt only, finished image, or overlay on an existing image. |

Use the demonstrated brand's logo. Do not automatically insert Photon or Pomo branding into unrelated company demos. Pomo belongs to the original matcha example, not the universal template.

Do not invent missing prices, dates, ratings, amenities, availability, company marks, or commercial claims. Use approved demo fixtures as fixtures, not as current real-world offers. Missing optional copy means an empty slot, not a placeholder or a fabricated value.

When asked for a prompt, guideline, or skill, return instructions without generating imagery. When explicitly asked to produce assets, generate or composite the requested individual images. Do not turn a request for four assets into a single four-panel image.

## 3. Canvas and locked geometry

Default canvas: **1200 × 1600 px, portrait 3:4**. Artwork fills the canvas edge to edge. No baked-in border, rounded corners, device frame, chat bubble, or outer padding. The host interface may apply its own clipping outside this asset.

Coordinates below use a top-left origin. A baseline is a text baseline, not the top of a text box. The title's top refers to its line box. Keep the same font metrics and anchoring convention throughout the set.

| Element | Locked placement at 1200 × 1600 |
|---|---|
| Left content edge | x = 72 px |
| Right content edge | x = 1128 px |
| Compact logo | x = 72 px; y = 64 px; width = 80 px; original aspect ratio |
| Metadata | x = 72 px; baseline y = 1120 px; maximum width 700 px |
| Title | x = 72 px; line-box top y = 1165 px; maximum width 1056 px; one line |
| Accent rule | x = 72 px; y = 1360 px; width 72 px; height 3 px |
| Features | x = 72 px; baseline y = 1455 px; maximum width 720 px; one line |
| Price | right edge x = 1128 px; baseline y = 1460 px; maximum width 320 px; one line |
| Optional price qualifier | right edge x = 1128 px; baseline y = 1510 px; maximum width 320 px; one line |

The feature box ends at x = 792; the reserved price box begins at x = 808. Neither may overflow into the other. Measure actual text before rendering.

The 80 px logo token is for a compact mark. For an elongated wordmark, establish an appropriately readable, understated size once for that brand, anchored at the same upper-left origin. Keep that asset and size identical across the entire set. Respect its supplied clear-space requirements.

For another 3:4 resolution, multiply every coordinate, font size, line height, and rule dimension by the same factor: `output_width / 1200`. Never stretch horizontally and vertically by different amounts. A different aspect ratio requires a separately specified layout; do not crop the completed poster and hope its text survives.

## 4. Overlay stack and gradient

Build bottom to top:

1. Background photograph or artwork.
2. Transparent-to-black lower gradient.
3. Exact supplied logo asset.
4. Metadata, title, accent rule, features, price, and any required qualifier.

Keep any texture or photographic grain inside the artwork layer. Do not degrade the text and logo with a final distressed filter.

Use a full-width vertical black gradient. Its proposed fixed stops are:

| Canvas position | Black opacity |
|---|---:|
| Top through y = 880 px / 55% | 0% |
| y = 1040 px / 65% | 35% |
| y = 1120 px / 70% | 60% |
| y = 1280 px / 80% | 78% |
| y = 1440 px / 90% | 84% |
| Bottom / 100% | 86% |

Interpolate smoothly between stops. Keep the artwork faintly visible through the bottom. The upper image should retain its light and color; do not darken the entire canvas.

No opaque information panel, horizontal dividing edge, frosted-glass box, gradient banding, or blurred lower half. Do not substitute heavy text shadows for the gradient. Do not apply a second gradient to an image that already contains the finished overlay.

Use the same gradient on every image in a set. When one background is too busy or bright, fix that background's composition or underlying lighting rather than moving the text or inventing a different overlay treatment for that card.

## 5. Typography and colors

| Element | Typeface | Size | Line height | Color |
|---|---|---:|---:|---|
| Title | Canela Light | 94 px | 110 px | `#F7F5EF` |
| Price | Canela Light | 88 px | 100 px | `#F7F5EF` |
| Metadata | SF Pro Display Light | 30 px | 38 px | `#F7F5EF` |
| Features | SF Pro Display Light | 28 px | 36 px | `#F7F5EF` |
| Optional price qualifier | SF Pro Display Light | 28 px | 36 px | `#F7F5EF` |
| Accent rule | Not applicable | 72 × 3 px | Not applicable | `#D1A34A` |

Use only fonts available with appropriate usage rights. The original brief's alternatives are Cormorant Garamond Light for the serif and Helvetica Neue Light for the sans serif. Select one available serif and one available sans serif before rendering the set. Never alternate between them from image to image. Recheck text fit after a font substitution.

Use normal kerning and zero added letter spacing as the v1 default. No bold headings, handwritten lettering, all-caps metadata, outlines, shadows, glows, or horizontally compressed type. Maintain a refined, light editorial hierarchy.

Preserve supplied proper names, spelling, and brand casing. When drafting permitted copy, use title case for names, centered dots between short details, and an en dash between dates. Never silently reformat supplied facts into different meanings.

Price formatting is content, not decoration. Preserve the supplied currency, precision, amount, and pricing basis. The original matcha fixture used whole-dollar amounts without qualifiers; do not add qualifiers to those cards. For another demo, retain an explicitly supplied `/night`, `per person`, `from`, or equivalent where omitting it would change the offer. Use the qualifier row when needed. Never invent a price for a card that has none, or replace a missing amount with `$0`.

## 6. Background and logo treatment

Give each image one clear visual idea. Keep the principal subject and defining details predominantly in the upper artwork area, approximately 25–63% of canvas height. Keep the upper-left logo area uncluttered and the bottom 35% comparatively calm. Do not hide the important face, product, architectural feature, or event detail behind the title or price.

The background's medium, subject, lighting, palette, and mood can vary with the demo. Restrained hotel photography and playful editorial matcha imagery can use the same overlay. For matcha assets, do not import pools, villas, bedrooms, or resort scenery merely because the layout originated with a hotel card.

For an existing image, preserve its identity and relevant content. Reframe only when authorized and appropriate. Do not replace a real hotel's room or a real product with invented details and present the result as an authentic photograph.

Place the supplied logo as an asset, not as generated typography. Preserve its original proportions, artwork, colors, spacing, and transparency. No redrawing, stretching, cropping, rotation, fading, glow, outline, badge, or background plate. A supplied alternate logo variant may be selected once for the set; do not invent a recolor. When the mark is hard to see, compose a cleaner background behind it.

If no usable logo was supplied or retrieved, do not fabricate one. Leave its slot empty in a draft and report the missing asset; do not claim a branded final is complete.

## 7. Copy fitting and generation workflow

Preflight the whole set before rendering. Test the longest title, metadata string, feature line, amount, and qualifier using the actual selected fonts.

Do not shrink a single card's type, squeeze letter spacing, wrap its title, move its price, or shift its baselines to rescue overflowing copy. Use an approved shorter display name or shorten editable descriptive copy without changing its meaning. Do not silently abbreviate a proper name, omit a required pricing qualifier, or alter an amount. If immutable copy cannot fit, identify the blocked field and request or propose an explicit template revision rather than producing a broken final. Apply any approved revision consistently across the set.

For asset production, prefer this workflow:

1. Resolve exact copy and assets, select fonts, and lock the overlay tokens.
2. Generate or prepare the background without added typography, logos, UI, or a pre-baked lower gradient.
3. Composite the reusable gradient, supplied logo, exact text, and accent rule as separate layers.
4. Inspect the finished asset, correct problems, and export each image separately.

Use deterministic text and asset compositing when the available tools support it. Do not ask an image model to invent a lookalike logo or independently redraw the template for every card. If only single-pass image generation is available, specify the complete overlay and inspect the output, but do not claim exact fonts, coordinates, or logo fidelity without verification.

For a prompt-only deliverable, provide one self-contained prompt per requested image. Each prompt must include the exact copy, background direction, canvas, layout, gradient, typography, logo instructions, and negative requirements. Never rely on an image agent having access to this conversation, an unseen reference, or an earlier prompt.

Do not add promotional slogans, sponsor marks, watermarks, QR codes, websites, social handles, discount stickers, ratings, fake buttons, or decorative readable words unless the current brief expressly requires them. Keep interactive controls in the actual demo interface, not painted into a noninteractive image.

## 8. Review and delivery

Inspect the final pixels, not just the generation prompt. Check spelling, exact amounts and dates, logo fidelity, typography, baseline alignment, clipping, and collisions. Confirm that the gradient is smooth and that the main subject remains visible. Reject duplicated subjects, malformed anatomy, generated gibberish, or visibly distorted architecture.

Preview at full resolution and at the image's intended size in the demo. The title and price should remain quickly identifiable; assess supporting copy at its actual viewing size instead of assuming that a large export guarantees readability. When comparing multiple cards, check that shared coordinates, colors, type sizes, gradient stops, and logo size are identical.

Deliver only what was requested. For finished assets, export one full-bleed image per card, preferably PNG in sRGB. Preserve editable layers or the reusable overlay source when the workflow supports them. A contact sheet may be an internal QA aid, never a replacement for individual images. Report missing assets, font substitutions, generation-only approximations, or unverified checks accurately.

**Final test: different images, one unmistakably consistent overlay system.**


## 9. iMessage delivery (grouped batches)

Image **generation** follows sections 1–8. Image **delivery** is separate:

1. Finish every file in the batch first. Do not enqueue mid-batch.
2. Enqueue **one** `attachment_group` containing all N cards (N ≥ 4), with all absolute paths (or multiple `--attachment` flags on one `bun run enqueue`).
3. Runtime sends `space.send(group(attachment(p1), …))` once. Spectrum’s iMessage provider uploads each file, collects attachment GUIDs, and calls **one** `messages.sendMultipart`.
4. Only if Spectrum rejects a large group, split it into chunks of **at least 4** each — never create a 4+1 split or any single-card leftover. Never a collage.

Reference and source of truth: `{{BRIDGE_ROOT}}/orchestrator-memory/ATTACHMENTS.md` (Grouped outbound images).

Enqueue success is not the same as observing an iMessage stack — confirm the stack in Messages when verifying.
