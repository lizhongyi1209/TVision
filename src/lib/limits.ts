// Shared constant between client and server for the multi-reference-image
// feature (PLAN-MULTI-REF). Kept in its own zero-dependency module — same
// reasoning as visionModels.ts — because o1key.ts is server-only (imports
// fetch/Buffer semantics tied to the Node runtime) and must never be pulled
// into a client component like RefSlot.tsx/Stage.tsx.

/** Free-form mode (no preset action selected) allows up to this many reference
 *  images, in addition to the canvas/base image — i.e. 9 images total per
 *  request. Preset actions that need a reference (换上衣/换裤子/换背景) still
 *  cap at 1, enforced by their own needsRef flow, not this constant. */
export const MAX_REF_IMAGES = 8;

// ── Batch workshop (PLAN-BATCH) ─────────────────────────────────────────────
// Three independent ceilings for the batch/all-pairs workshop. All three are
// UI/UX limits (readable no-scroll grids, a bounded submit/poll fan-out per
// run), not upstream API limits — see PLAN-BATCH.md §6 for the still-unproven
// "does the upstream choke on N rapid submissions" risk this doesn't cover.

/** Garment wall cap. The wall's grid auto-shrinks tiles to fit every garment
 *  on screen with no scrolling (BatchWorkshop.tsx) — past this count tiles
 *  would shrink below a usable size. */
export const MAX_BATCH_GARMENTS = 50;

/** Model rail cap. 1 model renders the batch grid view; 2+ switches to the
 *  all-pairs matrix, whose column count is this number — past it the matrix
 *  stops being comfortably readable in one viewport width. */
export const MAX_BATCH_MODELS = 6;

/** Hard ceiling on models × garments for a single run (BatchBar's generate
 *  button disables and asks the user to split when exceeded). Bounds one
 *  run's submit/poll fan-out and in-memory result set regardless of how the
 *  two caps above combine (e.g. 6 models × 50 garments = 300, well over this). */
export const MAX_BATCH_TASKS = 100;
