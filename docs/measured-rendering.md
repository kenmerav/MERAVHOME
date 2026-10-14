# Drawing + Spec Book — live Studio

Studio team members with project access open **Rendering Studio** from their project. The
drawing-to-image workspace is the primary workflow at `/projects/<id>/rendering-studio`, with
adjustments, saving and presentation approval on the same page. The former Renderings and
Measured Rendering URLs redirect here and preserve room selection. The project's duplicate
Renderings shortcut and the former manual pack/export Studio setup page have been replaced.
**Saved & imported renderings** below the creator preserves existing images, queues, revisions,
package imports and presentation-sheet controls. Gallery contents mount only when opened;
**View room renderings** opens that section and jumps to the saved image's room. External roles
continue to use the gallery without gaining drawing interpretation or generation access.
Choose the room and upload a dimensioned elevation image, with up to
three supporting plan/elevation images. Original images upload directly to the existing private
`rendering-studio-files` bucket using scoped signed upload tokens.

The construction-view picker reads existing project Construction Docs. **Find room views** runs
one shared, budget-guarded PDF index for all current project rooms. It lists individual elevations,
plans and details by room, printed view title, sheet and one-based physical PDF page. Multiple views
on a sheet stay separate. Unclear room associations are excluded from automatic room matching.
Select **Work on this view**, or add up to three other crops as supporting views. Crop edges are
suggestions: review and adjust them to retain dimensions and exclude unrelated elevations.
Manual PDF page/crop selection remains available without AI indexing.

Indices live privately under `<project-id>/measured/drawings/<source-key>.json` in the same bucket.
Their key includes document identity, source path, revision metadata and current rooms; changed
documents invalidate the index. Cropped source images are immutable room-scoped assets. Source
document, sheet/page/view and reviewed crop bounds persist with camera versions and jobs. Index
jobs use Vercel Workflow and poll a single background response, with no automatic paid retries.
The PDF scan uses the existing Spec review token-cost guard ($5 ceiling) and GPT-6.1 Sol high
reasoning. It has no new tables, grants, public storage or environment settings.

Drawing reading matches only that room's Spec Book products (and shared sinks/paint). Explicit
overall product dimensions override drawn product sizes while maintaining installation centres.
Fractional dimensions remain unrounded. Tile/slab stock sizes never resize architectural surfaces.
Unlabelled dimensions, unresolved selections and representative geometry remain review issues.

The browser builds a measured 3D camera view using shared physical geometry. Elevation and
perspective views can be adjusted before saving the camera. Verified self-contained GLBs can
replace representative shapes. Each save produces a separate scene version and captures the
actual camera image; it never changes the project's product selections or previous scenes.

The photorealistic action uses that saved camera, the drawing, optional quality photo and mapped
original product photos. It preserves the measured scene separately for comparison. The result
is a presentation draft requiring design review: image generation can alter precise geometry.

Completed images expose **Save to room renderings** with a name and a separate, unchecked
approval option. Saving copies the original PNG into the existing `room-images` bucket and
creates a normal `room_images` record; it does not call AI. Drafts remain drafts until reviewed.
Explicitly approved saves enter the existing presentation flow. Each generated job has one
stable gallery ID and asset path, so repeated saves recover interruptions without duplicating
records or overwriting later gallery edits. Private source drawings and camera files stay private.

**Make adjustments** accepts up to 4,000 characters and creates a new paid image version using
the selected finished image first, then its pinned camera, drawing and product references.
It does not read the full PDF again. The server derives the camera from the selected parent job;
unrelated selected scenes cannot be substituted. A changed Spec Book requires a fresh camera.
Version numbers, parent IDs and requested notes persist with jobs, and notes are shown in history.
Original images and approvals are preserved. Each adjusted version can be saved separately;
gallery revision links are retained when its parent has also been saved. Visual adjustments do
not mutate measurements or product selections. Uncertain start results must be checked before
another adjustment can be sent; paid generation still has no automatic retries.

## Shared persistence and jobs

Scenes and job manifests are JSON objects in the existing private bucket under
`<project-id>/measured/<room-id>/scenes|jobs/<uuid>.json`; image/model assets use scoped random
paths in its `assets/` folder. Supabase remains authoritative. There are no new tables, grants,
public buckets, environment secrets or migrations. Existing bucket policies deny direct anonymous
and authenticated access; authorized server requests supply short-lived signed asset URLs.

Every route verifies an active Studio staff account, project membership and room ownership.
Asset paths and scene/job IDs cannot refer across room/project boundaries. Client and contractor
accounts do not gain editing or generation rights. Worker execution rechecks the requesting account.

The existing Vercel Workflow installation runs drawing interpretation and image generation in
durable steps. Only project/room/job IDs enter workflow arguments; drawings, product snapshots,
results and prompts stay in private storage. Reopening the page resumes saved jobs. Duplicate
operation IDs do not dispatch another worker. Paid steps have zero automatic retries; quota errors
are saved as failed jobs, without fallback to another model. Interrupted jobs remain visible for
manual inspection before another attempt. Each job pins its sources and Spec Book snapshot.

`OPENAI_MEASURED_RENDERING_MODEL` defaults to `gpt-6.1-sol` with high reasoning and the existing
Spec-review token cost guard. A custom override is honored separately. Its scene contract lists
all supported kinds/fronts/inference axes and requires unknown element depths to remain flagged.
`OPENAI_MEASURED_PHOTOREAL_MODEL` defaults to `gpt-image-2.5-sunburst`, maximum quality.
Existing `OPENAI_API_KEY` is server-only. These optional overrides are not changed by deployment.
API billing credits are separate from this feature and must be available for new generation.
Detailed drawing-to-3D interpretation also runs as a saved background response. Collection steps
poll the same response for up to 30 minutes; they never send another paid interpretation. This
avoids the former four-minute request timeout observed while testing Spec K's source crop.

## Spec K reference

The primary-bathroom reference scene comes from ID2.8 elevation 1 of Spec-K_MI_260902.pdf.
It demonstrates the 24x36 drawn mirror becoming the specified 20x30x1.5 mirror while keeping its
centre fixed. Its source reconstruction was manual because drawing interpretation encountered
exhausted API credits. Its photorealistic quality sample was generated here in chat with the
built-in image tool. Both are clearly labelled reference tests, not proof of successful live API
generation. Tile courses, niche height, floor material and small product details still need review.
Private Spec K assets are saved in scoped Studio storage; no test snapshots, credentials or generated
image binaries are committed to Git.
The initial production release also successfully generated a new Spec K image through the live
API from a saved browser camera and reopened its persisted job. This verifies photoreal generation;
it does not certify the source reconstruction or image geometry as exact.

Validation covers dimensional precedence, fractional parsing, ambiguous envelopes, fit checks,
private access, cross-project asset rejection, stale Spec Book rejection, durable shared records,
original product-reference inputs, duplicate-operation protection and quota failures. Full production
build and browser checks verify the actual route. Baseline repository type errors remain separate.
