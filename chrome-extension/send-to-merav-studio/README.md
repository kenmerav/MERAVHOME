# Send to MERAV Studio Chrome Extension

This unpacked Chrome extension adds two product-sourcing flows:

1. Right-click a product image.
2. Choose **Send to MERAV Studio**.
3. Studio creates or updates the catalog product and adds it to the active design-board page.

Or:

1. Open a product page.
2. Click the **Send to MERAV Studio** extension icon.
3. Choose a project.
4. Click **Send Current Product**.

## Setup

1. Add `MERAV_EXTENSION_TOKEN` to Vercel and local `.env`.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select `chrome-extension/send-to-merav-studio`.
6. Open extension options and save:
   - Studio URL: `https://studio.meravinteriors.com`
   - Extension token matching `MERAV_EXTENSION_TOKEN`
   - Click **Load Projects**
   - Choose the project you are sourcing into

## Notes

- The extension never stores Supabase service-role keys.
- Studio stores the original image and tries free background removal.
- If background removal fails, Studio imports the original image and returns a review warning.
- Product extraction priority is JSON-LD, Open Graph metadata, page HTML, then visible text.
