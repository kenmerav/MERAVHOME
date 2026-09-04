# Room Design V2 pilot release

This release adds the new Room Design workflow without converting or rewriting any existing
project. A project uses the pilot only when an administrator explicitly chooses **New Room Design
pilot** while creating it.

## Before activation

1. Run the existing `npm run backup:studio` production backup and retain the generated artifact.
2. Review `supabase/migrations/20260904090000_add_room_design_v2_pilot.sql`.
3. Confirm the production server has `FIRECRAWL_API_KEY` and the existing Supabase service-role
   configuration. No browser-exposed Firecrawl key is added.
4. Run `npm test`, `npm run build`, `npm run validate:design-board-collab`, and
   `npm run validate:design-board-recovery`.

## Activate

1. Apply the additive migration.
2. Deploy the application from the reviewed pilot commit.
3. Sign in as an administrator and create a brand-new test project with **New Room Design pilot**.
4. Complete one room through links, board population, Send Page to Materials, rendering,
   presentation, Spec Book, and Procurement.
5. Open an older project and verify its Design Boards, Materials, Presentation, Spec Book, and
   Procurement pages are unchanged.

## Stop the pilot without deleting data

Set `studio_feature_flags.enabled` to `false` for `room_design_v2`. This immediately hides and blocks
the pilot while leaving every project, design board, material, product, render, and workflow record
intact. If needed, redeploy the prior application version after disabling the flag. Do not drop the
new column or tables as part of an incident response.

## Data boundaries

- Existing projects are never modified. Only projects with an explicit row in the separate
  `room_design_projects` enrollment table can enter the new route.
- New pilot drafts live in `room_design_workflows`; they do not replace Materials or Design Boards.
- “Populate Studio Design Board” replaces only pages generated for the same pilot room. Manual
  pages and every other room page are preserved.
- The current Design Board remains the only board editor and its existing Send Page to Materials,
  Present Board, history, export, and editing tools remain in use.
- Uploaded inputs and renders use the existing `room-images` storage bucket under room-scoped
  paths. Files are uploaded with `upsert: false`.
