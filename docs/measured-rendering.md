# Drawing + Spec Book — live Studio

Studio team members with project access can open a project's Renderings page and choose
**Drawing + Spec Book**. Choose the room and upload a dimensioned elevation image, with up to
three supporting plan/elevation images. Original images upload directly to the existing private
`rendering-studio-files` bucket using scoped signed upload tokens.

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

`OPENAI_MEASURED_RENDERING_MODEL` defaults to `gpt-6-astra` with high reasoning.
`OPENAI_MEASURED_PHOTOREAL_MODEL` defaults to `gpt-image-2.5-sunburst`, maximum quality.
Existing `OPENAI_API_KEY` is server-only. These optional overrides are not changed by deployment.
API billing credits are separate from this feature and must be available for new generation.

## Spec K reference

The primary-bathroom reference scene comes from ID2.8 elevation 1 of Spec-K_MI_260902.pdf.
It demonstrates the 24x36 drawn mirror becoming the specified 20x30x1.5 mirror while keeping its
centre fixed. Its source reconstruction was manual because drawing interpretation encountered
exhausted API credits. Its photorealistic quality sample was generated here in chat with the
built-in image tool. Both are clearly labelled reference tests, not proof of successful live API
generation. Tile courses, niche height, floor material and small product details still need review.
Private Spec K assets are saved in scoped Studio storage; no test snapshots, credentials or generated
image binaries are committed to Git.

Validation covers dimensional precedence, fractional parsing, ambiguous envelopes, fit checks,
private access, cross-project asset rejection, stale Spec Book rejection, durable shared records,
original product-reference inputs, duplicate-operation protection and quota failures. Full production
build and browser checks verify the actual route. Baseline repository type errors remain separate.
