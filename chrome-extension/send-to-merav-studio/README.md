# Send to MERAV Studio Chrome Extension

This unpacked Chrome extension adds two destinations and three product-capture methods.

For a project enrolled in the **Room Design V2** pilot:

1. Open a product page and click the extension.
2. Choose the project, **Room Design Selections _NEW_**, room and product type.
3. Click **Read Product Details**. Check the captured image, link, SKU, color/finish, and dimensions
   against the exact vendor variant. Enter the quantity, selling unit, pricing basis and lead time.
4. For tile, confirm the installation area, pattern and direction, grout, edges and manufacturer
   suitability. Enter waste and coverage when ordering by the box, carton or sheet.
5. Check the verification box once confirmed and click **Save Room Selection**. Studio flags
   unresolved details for review. Trade and quote amounts live on the room selection.

If a room needs another selection, click **+ Add room item** below the Product Type menu. The item
is saved to that room in the current project and becomes the selected destination for the product.

The extension remembers the last room and advances to the next unfilled product type after a
successful import. Room selection review requires the matching Studio API release.

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

Right-click on a product or image opens the review popup when the last destination is Room Design.
For Design Board Direct, right-click continues to send to the selected board page.

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

- Version 0.4.2 checks Studio's returned destination, room, and product type before reporting a successful send. Reload the installed extension after updating its files so its background worker uses the same version as the popup.

- The extension never stores Supabase service-role keys.
- Studio stores the original image and tries free background removal.
- For Room Design projects, both import options update the room checklist and its board together.
  Room Design Selections places the reviewed item on its room board. Design Board Direct uses the
  selected page’s assigned room and fills an available matching checklist item or adds a new one.
  Send the board to Materials when ready.
- If background removal fails, Studio imports the original image and returns a review warning.
- Product extraction priority is JSON-LD, Open Graph metadata, page HTML, then visible text.
