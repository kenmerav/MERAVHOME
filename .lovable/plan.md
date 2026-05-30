# New Workflow Refactor

Refocus the app on: **Project → Rooms → Materials (guided checklist) → Scrape → Catalog → One Full-Project Presentation**. Spec books are paused (kept in code, hidden from nav).

---

## 1. Project creation

Update **New Project** dialog (`projects.index.tsx`):
- Fields: Project Name, Client Name, Project Notes
- Room checklist with presets:
  Kitchen, Primary Bedroom, Bedroom 1, Bedroom 2, Primary Bathroom, Bathroom 1, Bathroom 2, Dining Room, Living Room, Office
- "+ Add Other Room" → free-text rows (repeatable)
- On submit: create project + insert all selected rooms + auto-seed required `material_items` rows per room type

Remove the old project_type dropdown from the create flow (keep column nullable / default for back-compat).

---

## 2. New data model

New table **`material_items`** = the guided checklist rows on the Materials page.

```
material_items (
  id uuid pk,
  room_id uuid not null,         -- FK rooms
  project_id uuid not null,      -- denormalized for fast project-wide queries
  item_label text not null,      -- "Pendant", "Faucet", "Shower Tile"…
  category text,                 -- "Lighting" | "Plumbing" | "Tile" | … (for presentation grouping)
  is_required boolean default true,   -- false = user-added custom item
  sort_order int default 0,

  -- user inputs
  cad_label text,
  product_url text,
  quantity int,
  color text,
  notes text,
  not_needed boolean default false,

  -- link to catalog after scraping
  product_id uuid,               -- FK products (nullable)
  scrape_status text default 'pending',  -- pending|scraped|failed|manual
  scrape_error text,

  created_at, updated_at
)
```

Extend **`products`** catalog with: `dimensions text`, `price text`, `description text` (keep existing fields).

Required-items templates (hard-coded in `src/lib/roomTemplates.ts`):
- **Kitchen**: Pendant, Sconce, Tile, Countertop, Flooring, Faucet, Pot Filler, Lighting, Sink, Paint, Cabinet Hardware, Cabinet Finish
- **Bedroom / Office** (Primary Bedroom, Bedroom 1, Bedroom 2, Office): Lighting, Sconce, Flooring, Paint
- **Living Room**: Lighting, Flooring, Paint, Tile
- **Dining Room**: Lighting, Flooring, Paint (inferred)
- **Bathroom** (Primary Bathroom, Bathroom 1, Bathroom 2): Tile, Shower Tile, Sink, Faucet, Shower System, Paint, Cabinetry Finish, Countertops, Sconce, Pendant, Accent Mirrors, Lighting, Cabinet Hardware, Shower Drain, Sink Drain, Flooring, Towel Hook, Toilet Paper Holder
- **Other**: no required items (custom only)

Each template item carries a `category` for presentation grouping (Lighting / Plumbing / Tile / Countertop / Cabinetry / Hardware / Flooring / Paint / Accessories).

---

## 3. Materials page (`/projects/$id/materials`)

New route — the project hub. Replace the per-room rabbit-hole as the primary surface.

Layout:
- Header: project name + global **Scrape Product Info** button + overall progress bar
- One collapsible card per room with progress chip ("Kitchen — 9 of 12 completed")
- Inside each card: table of items with columns
  Item Needed · CAD Label · Product Link · QTY · Color · Not Needed · Notes (popover) · status dot
- Row marked complete when `not_needed=true` OR `product_url` non-empty
- "+ Add custom item" row at bottom of each room (asks label + category)
- Inline edits autosave on blur via `material_items` upsert

Soft-luxury styling: large whitespace, serif headings, muted borders, no zebra stripes.

---

## 4. Scrape flow

**Scrape Product Info** button → server route `POST /api/scrape-materials` with `project_id`:
1. Fetch all `material_items` for project where `product_url` non-empty AND `not_needed=false` AND (`product_id` null OR url changed)
2. For each URL: check catalog for existing `product_url` → reuse; else call existing Firecrawl scrape (extend schema to include `dimensions`, `price`, `description`)
3. Return array of `{ material_item_id, scraped: {...}, existing_product_id? }`

Show a **Review modal** (client-side): editable grid of scraped rows; user confirms → second call `POST /api/scrape-materials/commit` which:
- Creates/reuses `products` rows
- Links `material_items.product_id`
- Sets `scrape_status='scraped'`

Failures stay editable in the modal with a "Save manually" path that creates a product from the user's typed values.

---

## 5. Presentation generator

Replace per-room presentations with **one project-level presentation**.

New route `/projects/$id/presentation` (and replace the existing presentations index entry point for a project).

Renders fully from live data — no snapshot. Edits to material rows / catalog products reflect immediately on next view.

Structure:
- **Cover**: Project name, client, today's date, "MERAV Studio"
- **Overview**: selected rooms list, project notes, optional design concept
- **Room pages** (one per selected room, in sort_order):
  - Room name as section title
  - Items grouped by `category` per the spec (Kitchen → Lighting / Plumbing / Countertops + Tile / Cabinetry + Hardware / Flooring + Paint, etc.)
  - Each item card: product image (large), CAD label badge, product name, vendor, finish/color, qty, notes
  - Skip items with `not_needed=true` or no product

Layout: clean white bg, serif display + sans body, generous gutters, editorial grid (image-led). Print-friendly CSS so user can export via browser print → PDF.

Add **Export PDF** later (out of scope this pass — print-to-PDF works now).

---

## 6. Nav / cleanup

- Sidebar: Projects, Materials (per project context), Presentations, Catalog, Procurement, Settings
- Hide Spec Book nav entry (keep files for later)
- Project page (`projects.$id.index.tsx`) becomes a summary + links to Materials / Presentation / Procurement
- Existing per-room page (`projects.$id.rooms.$roomId.tsx`) kept for advanced editing but deprioritized; primary entry is Materials page
- Catalog page: surface new fields (dimensions, price, description)

---

## 7. Out of scope (explicitly)

- Spec book regeneration
- AI rendering (kept as-is)
- Image tagging feature from previous plan
- PDF export (use browser print for now)
- Auth (project remains single-user open-RLS as today)

---

## Technical notes

- Migration adds `material_items` table + 3 new columns on `products`, all open-RLS to match existing tables.
- New TanStack server route `src/routes/api/scrape-materials.ts` (uses existing Firecrawl env + extended schema).
- New lib: `src/lib/roomTemplates.ts` (room → required items + categories).
- New components: `MaterialsPage`, `MaterialRow`, `ScrapeReviewDialog`, `ProjectPresentation`.
- Reuse existing `db` helper pattern in `src/lib/db.ts`; add `materialItems` CRUD.
- All new public-schema tables get GRANTs in the same migration.

---

## Build order

1. Migration: `material_items` + extend `products`
2. `roomTemplates.ts` + `db.materialItems.*`
3. Update New Project dialog (rooms checklist) + auto-seed items
4. Materials page UI
5. Scrape API route + Review dialog
6. Project presentation route
7. Nav cleanup + hide spec book

Ready to start with the migration on your approval.
