# Send to MERAV Studio Chrome Extension

This unpacked Chrome extension adds two destinations and three product-capture methods.

For a project enrolled in the **Room Design V2** pilot:

1. Open a product page and click the extension.
2. Choose the project, **Room Design Selections _NEW_**, room, product type, quantity, and an optional
   color/finish override.
3. Click **Add to Room Selections**.
4. Studio reuses or creates the catalog product and fills that room selection. The existing design
   board is populated later from Room Design, after the selections are reviewed.

If a room needs another selection, click **+ Add product type** below the Product Type menu. The
new type is saved to that room immediately and becomes the selected destination for the product.

The extension gathers the current product page link, product name, price, dimensions, SKU, and
image. It remembers the last room and advances to the next unfilled product type after a successful
import.

The existing direct-to-board workflow remains available as **Design Board Direct**:

1. Right-click a product image.
2. Choose **Send to MERAV Studio**.
3. Studio creates or updates the catalog product and adds it to the active design-board page.

Or:

1. Open a product page.
2. Right-click anywhere on the page.
3. Choose **Send current product page to MERAV Studio**.

Or:

1. Open a product page.
2. Click the **Send to MERAV Studio** extension icon.
3. Choose a project and board page.
4. Click **Send Current Product**.

The extension remembers the last destination, project, room/product type, or board page, so
right-click sends can run without opening Studio or asking again.

## Setup

1. Add `MERAV_EXTENSION_TOKEN` to Vercel and local `.env`.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select `chrome-extension/send-to-merav-studio`.
6. Click the extension icon and choose **Connect to Studio**.
   - You must be signed into MERAV Studio in the same Chrome profile.
   - Employees do not need to copy or paste the extension token.
7. Choose and save:
   - Studio URL: `https://studio.meravinteriors.com`
   - Click **Load Projects**
   - Choose the project you are sourcing into

## Notes

- The extension never stores Supabase service-role keys.
- Studio stores the original image and tries free background removal.
- After saving or reusing the catalog product and image, Room Design imports update only the
  selected room workflow. They do not write to Materials or the design board until the designer
  uses the existing Studio handoff controls.
- If background removal fails, Studio imports the original image and returns a review warning.
- Product extraction priority is JSON-LD, Open Graph metadata, page HTML, then visible text.
