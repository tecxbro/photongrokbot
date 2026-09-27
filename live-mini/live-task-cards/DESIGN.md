# Design contract: Live Task Cards

## Reusable design, task-specific data

The four layouts are `dots`, `segments`, `stages`, and `matrix`. Names such as “Research market” are examples, not fixed card types. Grokbot provides titles, stage labels, detail text, counts and units through the schema in `docs/API.md`. Choose a layout using `SKILL.md`; keep it fixed for that task.

The preferred default is `matrix` for multi-step work, with estimated progress across the entire weighted workflow. Show the current step followed by up to two upcoming steps from the task plan. Use `stages` when an estimate is unsuitable; `dots` and `segments` remain available for explicit requests or clearer task-specific presentation.

The reference screenshots document the original visual direction only. The current contract below supersedes their photographs, navy backgrounds and colored indicators.

## Theme and artwork

Dark is the default: black `#000000` background, white primary text and neutral gray secondary elements. Light uses white `#ffffff`, dark primary text and neutral gray secondary elements. The authoritative final tokens are in `public/task-matrix.css`, loaded after the base structural stylesheet.

Grokbot sets `content.theme` to `light` only when the user asks; otherwise use `dark`. For an active card, change the saved content through the normal revision-checked update, preserving every other field and the exact URL. Do not append a theme query or make a Spectrum call. Terminal task snapshots remain immutable; select the requested theme before completion. Demo routes accept a theme query solely for comparing the two designs.

There is no multi-tap theme gesture and no theme button. A single tap (or Enter/Space) switches between task details and Grokbot; it never changes the task itself.

All task cards are image-free. Use `header: "none"`. The renderer ignores legacy header selections; retained artwork and reference screenshots are not rendered task headers. No generated art, company logos, rainbow icon, decorative gradients, colored status accents, glow, or decorative speech-bubble tail. The current working label may use the subtle monochrome thinking mask specified below.

## Layout and sizing

Use the system font stack with no external font download. Titles and activity headings use weight 600; metadata and stage labels use 500. Keep stage labels in their supplied case with restrained tracking. Use tabular numerals and reserved label space to prevent count changes from shifting the layout. Task details follow this order: task category/status, title/subtitle, stages, current activity and measured progress, then last saved update time. Keep wording short; do not invent facts to fill the layout.

Review all four layouts at 300 × 240 and 300 × 300. These are design targets, not a universal Photon size guarantee. The task shell is responsive up to 420px. The character composition is 300 × 240 with a fixed 168 × 168, 14 × 14 dot lattice. The embed supplies its actual viewport.

The only interactive card control switches the local view. There are no task-action buttons, approvals, payments, forms, callbacks or worker commands. User decisions stay in the existing conversation.

## Stages and measurements

Use 2–10 task-specific stages for matrix workflows, or 2–4 for other layouts. Stage states are `pending`, `active`, `done`, and `blocked`. Running tasks have exactly one active stage. A blocked marker is permitted for waiting, failed or cancelled work. Status remains monochrome and is communicated through words and shapes.

- `dots`: a countable batch. Up to 50 items get one dot per item. Larger totals use a bounded proportional meter with the exact count shown in text.
- `segments`: measured checks within a stage. Ten segments and the percentage derive from the supplied count, not a guessed duration.
- `stages`: meaningful milestones when no reliable total exists. Set `progress: null`. “Step 3 / 4” does not mean 75 percent complete.
- `matrix`: weighted estimated whole-workflow progress plus the current and up to two upcoming planned steps, with the current step bright at the bottom and upcoming steps faded above. No visible Now/Next/Later prefixes. Completed steps slide out downward; the next stable row moves down into the current position. A task-specific plan is required; future steps are intentions, not completed achievements.

Completed, waiting and unknown-total examples are states of the shared system, not additional templates. Mark completion only when the promised outcome and all displayed stages/measurements are complete. If delivery is a stage, “ready to send” is not delivered.

## Motion and accessibility

Live snapshots and demos share `public/card-motion.mjs`. Keep the card mounted and reconcile changed content. New revisions take precedence immediately; interrupt current transitions instead of queuing old states. Measured numeric labels show confirmed values. Workflow labels use `~n / 100` for the animated estimate, with accessible text and a tooltip identifying overall workflow progress. Only confirmed overall completion shows 100 without the estimate marker.

- Dot fills use 360ms transform transitions with a bounded 0–260ms stagger: the entire batch settles within 620ms, even for a large jump.
- Segment fills use 420ms transform transitions. Stage rings/fills use 380ms and connecting lines 400ms, with a short checkmark entrance.
- Changed text fades with a 3px lift over 200ms; summary state changes use 300ms. Outgoing layers expire after 180ms and are replaced on interruption.
- On measured dot cards, only the next unconfirmed dot breathes, on a gentle 1.8s cycle. Waiting/terminal states stop that working indicator.
- Pause playback and canvas scheduling when hidden. On return, show the latest saved snapshot without replaying a backlog.

Workflow dots ease through each active stage budget over its configured pacing duration, then hold below that stage endpoint. They cannot advance a stage or reach 100 without a confirmed saved milestone. The host records elapsed stage time so reopening and theme changes do not restart the estimate; waiting and terminal states freeze it.

Matrix planned rows move and scale over 560ms with an ease-out, while opacity settles over 420ms. Keep the current label at the bottom and avoid animated font-size changes. Only its active text receives a subtle 2.8s monochrome thinking sheen; this is an activity cue, never a progress signal. Stop the sheen for waiting, queued and terminal states, character view, hidden pages and reduced motion. Upcoming labels and confirmed counts stay steady.

Playback demos simulate updates and never write real task state. The Grokbot character artwork and choreography are unchanged.

Single-tap view transitions use an interruptible damped spring, a small fade/lift of task details and a center-out reveal on stationary Grokbot dots. Preserve current values and velocity on reversal. Pause character phase during the reveal, then resume it. Keep task title, current activity, status and count visible in character view.

Respect reduced-motion preferences with immediate transitions and a static character. Use accessible view-toggle labels, counts and progress descriptions. Hidden character content must not duplicate the task's announcements. Failed refreshes say “Updates delayed”, not “Task failed”. Freshness is the last actual saved update time.

## Runtime and hosting boundaries

Ordinary updates change validated JSON only. Keep the same card ID, URL, layout and original bubble. No source rewrites, image generation, new deployment, URL query changes or Spectrum edits for progress updates. An explicit design change updates the existing host and route once.

Persistent hosting uses the authorized Vercel project and durable storage. Stop task-owned local preview servers after the work and requested review finish, following `INSTALL.md`. Do not stop the hosted card or shared messaging runtime.

## Explicit character customization

A user-requested personal loader may replace only that owner's character with validated dot states. The shared 168 × 168 display fits an 8–32-column/row grid without stretching. Progress and character use the same chosen lattice; ordinary updates preserve selected view and playback phase. Explicit asset replacement may change grid resolution and starts the new character phase at zero, preserving the selected view. Dark/light palette, task plan and layout stay shared. The bundled conversion skill is for deriving artwork, not replacing this design with its starter.
