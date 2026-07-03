# MERAVHOME Studio Codex Instructions

## Project Overview

This repository is **MERAVHOME Studio**, the production Studio app at `studio.meravinteriors.com`. It is not `merav-portal`.

The app manages MERAV Interiors projects, rooms, materials, product catalog items, design boards, AI renderings, presentation boards, spec books, procurement, financials/invoices, construction docs, hours, users, approvals, client/GC access, reminders, Stripe, QuickBooks, and the Chrome extension import flow.

Future Codex threads must preserve the existing Studio/design-board/rendering workflows unless the user explicitly asks to change them.

## Tech Stack

- TanStack Start / TanStack Router
- React 19
- TypeScript
- Vite
- Tailwind CSS 4
- Radix UI components
- React Query
- Supabase Postgres/Auth/Storage/Realtime
- OpenAI image APIs for AI renderings and optional AI background removal
- IMG.LY background removal for local/free background removal
- Firecrawl/scraping for material/product data fill-in
- Stripe for client payment links/webhooks
- QuickBooks OAuth/invoice sync
- Chrome extension under `chrome-extension/send-to-merav-studio`

Important package scripts:

- `npm run dev`
- `npm run build`
- `npm run build:dev`
- `npm run preview`
- `npm run lint`
- `npm run validate:design-board-collab`
- `npm run validate:design-board-recovery`

## Important Routes

Main app routes live in `src/routes`.

- `/` dashboard: `src/routes/index.tsx`
- `/projects`: `src/routes/projects.index.tsx`
- `/projects/$id`: `src/routes/projects.$id.index.tsx`
- `/projects/$id/materials`: `src/routes/projects.$id.materials.tsx`
- `/projects/$id/design-boards`: `src/routes/projects.$id.design-boards.tsx`
- `/projects/$id/renderings`: `src/routes/projects.$id.renderings.tsx`
- `/projects/$id/rooms/$roomId`: `src/routes/projects.$id.rooms.$roomId.tsx`
- `/projects/$id/financials`: `src/routes/projects.$id.financials.tsx`
- `/projects/$id/approvals`: `src/routes/projects.$id.approvals.tsx`
- `/projects/$id/construction-docs`: `src/routes/projects.$id.construction-docs.tsx`
- `/presentations/$id`: `src/routes/presentations.$id.tsx`
- `/specbooks/$id`: `src/routes/specbooks.$id.tsx`
- `/specbooks/public/$id`: `src/routes/specbooks.public.$id.tsx`
- `/client/approvals/$projectId`: `src/routes/client.approvals.$projectId.tsx`
- `/client/financials`: `src/routes/client.financials.tsx`
- `/catalog`: `src/routes/catalog.tsx`
- `/catalog/$productId`: `src/routes/catalog_.$productId.tsx`
- `/procurement`: `src/routes/procurement.tsx`
- `/financials`: `src/routes/financials.tsx`
- `/hours`: `src/routes/hours.index.tsx`
- `/users`: `src/routes/users.index.tsx`
- `/extension/connect`: `src/routes/extension.connect.tsx`

Key API routes:

- AI renderings: `src/routes/api/generate-rendering.ts`
- Upload room image: `src/routes/api/upload-room-image.ts`
- Upload design board image: `src/routes/api/upload-design-board-image.ts`
- Design board background removal: `src/routes/api/remove-design-board-background.ts`
- PDF material import: `src/routes/api/import-materials-pdf.ts`
- Product/material scraping: `src/routes/api/scrape-materials.ts`, `src/routes/api/scrape-url.ts`
- Extension product import: `src/routes/api/extension/import-product.ts`
- Stripe: `src/routes/api/create-stripe-payment-link.ts`, `src/routes/api/stripe/webhook.ts`
- QuickBooks: `src/routes/api/quickbooks/*`
- To-dos/reminders/comments: `src/routes/api/my-todos.ts`, `src/routes/api/project-todos.ts`, `src/routes/api/studio-reminders.ts`, `src/routes/api/design-board-comment-todos.ts`

## AI Rendering Flow

The AI rendering page is `src/routes/projects.$id.renderings.tsx`.

The room-level rendering panel also exists in `src/routes/projects.$id.rooms.$roomId.tsx`.

Both call `/api/generate-rendering`, implemented in `src/routes/api/generate-rendering.ts`.

Current behavior:

- The SketchUp image is the primary reference image.
- Revisions can include the previous AI rendering and an extra reference image.
- The API calls OpenAI `https://api.openai.com/v1/images/edits`.
- Model is `process.env.OPENAI_IMAGE_MODEL || "gpt-image-2"`.
- It sends `quality: "high"` and `size: process.env.OPENAI_RENDERING_IMAGE_SIZE || "auto"`.
- Render jobs are queued by inserting a placeholder `room_images` row and continuing with `waitUntil`.
- Completed renderings upload to Supabase Storage through `uploadRoomImageFromDataUrl`.
- Rendering status/history lives in `room_images` fields such as `status`, `linked_sketchup_id`, `revision_parent_id`, `revision_number`, `revision_notes`, `team_notes`, `review_status`, and `is_approved`.

Do not break queued rendering, cancellation, revision history, side-by-side SketchUp/rendering review, rendering notes, or presentation/spec integration.

For AI rendering quality, preserve reference image fidelity. Do not aggressively compress SketchUp/reference images for high-fidelity rendering modes. Architecture/perspective preservation should take priority over speed when High Fidelity is selected.

## Supabase and Storage Rules

Supabase is the source of truth. Do not reintroduce localStorage as authoritative shared state.

Important environment names:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_IMAGE_MODEL`
- `FIRECRAWL_API_KEY`
- `MERAV_EXTENSION_TOKEN`
- `STRIPE_SECRET_KEY`
- `QUICKBOOKS_CLIENT_ID`
- `QUICKBOOKS_CLIENT_SECRET`
- `QUICKBOOKS_ENVIRONMENT`
- `QUICKBOOKS_REDIRECT_URI`

Important migrations include:

- `20260603141000_add_design_boards.sql`
- `20260603145500_enable_design_board_realtime.sql`
- `20260609143000_harden_design_board_versions.sql`
- `20260609190000_track_design_board_material_sources.sql`
- `20260617100000_optimize_design_board_versions.sql`
- `20260626163000_add_project_access_controls.sql`
- `20260702100000_add_room_image_team_notes.sql`
- `20260702121000_add_spec_ordering_visibility.sql`
- `20260702172000_add_contractor_spec_ordering_edit.sql`

Do not remove or rename existing Supabase tables, columns, buckets, storage paths, or migrations without explicit approval. Do not run destructive SQL unless the user explicitly approves it.

## Design Board Rules

The design board is the most sensitive workflow in this app. Preserve the Canva-style behavior.

Non-negotiables:

- Do not redesign the design board UI unless asked.
- Do not remove tools, drag/drop, paste, copy/paste, selection box, grouping behavior, labels, links, comments, page strip, jump-to, page reordering, export, or send-to-materials behavior unless asked.
- Only the active page should mount full editable objects. Inactive pages should use lightweight thumbnails/previews.
- Supabase is the shared source of truth for board pages/layers.
- Use patch-based/stable ID updates. Do not replace the whole board JSON for one layer update if a narrower update path exists.
- Every layer needs a stable ID.
- Do not allow stale saves to overwrite newer saves.
- Design board version history must remain recoverable through `design_board_versions`.
- Do not store large blobs/base64 images in live board state. Images belong in storage; board state should reference URLs/metadata.
- Board object references to product/material sources must be preserved when sending to materials.
- If a board item is sent to materials, the material image should match the board image currently used, including restored-original vs background-removed state.
- Same product link with different room/color/dimensions/image can be a distinct material/product variant.
- Sending to materials should not overwrite manually edited material categories, names, notes, links, or images unless the user explicitly requested that field to change.
- Items excluded from materials should stay excluded. Items included with missing link/label should still be reviewable and can be sent when approved.

## Image Optimization Rules

Keep Studio fast and keep Supabase egress/transformation usage under control.

- Use thumbnails for trays, page strips, catalog cards, and small previews.
- Use preview-size images for normal canvas display.
- Use originals only for full-size view, export, download, high-quality print/PDF, or AI operations that truly need source fidelity.
- Do not use Supabase image transformations casually in hot paths; transformed image counts are billable.
- Avoid loading every full-size image across all design board pages.
- Lazy-load images where possible.
- Preserve existing storage buckets and generated thumbnail/preview URL behavior.
- Background removal should preserve the original image separately and store cutouts separately.
- The free/local background remover is IMG.LY. AI background removal is paid and should remain clearly gated/fallback-oriented.

## Things Not To Change Without Approval

- Do not touch unrelated dirty files.
- Do not restore, delete, or commit existing untracked extension ZIPs/assets or dirty migrations unless the user approves.
- Do not change production Supabase schema without confirming the SQL and risk.
- Do not change Vercel/env secrets unless asked.
- Do not switch repos. This file is for `/Users/kenroberts/Documents/MERAVHOME`, not `/Users/kenroberts/Documents/New project 2`.
- Do not use the portal repo (`kenmerav/merav-portal`) for Studio/design-board/rendering work.
- Do not break existing Chrome extension import flow.
- Do not break public spec book links/QR access.
- Do not make client/GC/builder roles able to edit design boards unless explicitly asked.
- Do not expose service role keys, OpenAI keys, Stripe keys, QuickBooks secrets, or extension tokens to the browser.
- Do not assume dirty git changes are yours.

## Branch Workflow

- Confirm the repo path and remote before work:
  - `pwd`
  - `git remote -v`
  - `git branch --show-current`
  - `git status --short`
- Current production repo should be `kenmerav/MERAVHOME`.
- Use `codex/` branch names by default for new work unless the user asks otherwise.
- Keep commits focused and intentional.
- Do not commit or push unless the user explicitly asks.
- If user asks to push live, commit and push to the branch used by Vercel/GitHub deployment, then confirm deployment state if possible.

## Testing and Build Commands

Use available scripts from `package.json`:

- Install: `npm install`
- Dev server: `npm run dev`
- Production build: `npm run build`
- Development build: `npm run build:dev`
- Preview: `npm run preview`
- Lint: `npm run lint`
- Design board collaboration validation: `npm run validate:design-board-collab`
- Design board recovery validation: `npm run validate:design-board-recovery`

When working on UI, verify in browser when practical. For design board/rendering changes, test the exact route involved and avoid relying only on TypeScript/build output.

## How To Summarize Completed Work

Final responses should be concise and include:

- What changed
- Where it changed, with file references when helpful
- What was tested
- Whether anything was not tested
- Whether anything still needs user action, SQL, env vars, or deployment

If no changes were made, say so clearly.
