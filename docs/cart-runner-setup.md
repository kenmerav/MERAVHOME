# Run carts directly from Studio

Studio's **Build Carts** button prepares the selected products and hands the short-lived run to a helper on Ken's computer. The helper uses the installed Codex app-server over stdio and the existing Merav and Chrome tools. The Studio server never attempts to control a browser on Vercel.

## Start this computer

Requirements: Node.js, the installed Codex CLI signed into Ken's account, Merav Cart Builder and Chrome/computer-use tools enabled, and Chrome open with its ChatGPT browser connection available.

On this Mac, double-click `scripts/cart-runner/Start MERAV Cart Runner.command` and leave its window open while using carts. It uses the installed Codex app. Alternatively, from the MERAVHOME checkout run `npm run cart:runner`. If Codex is not on PATH, set `MERAV_CODEX_BIN` to its installed executable. On this Mac that is `/Applications/ChatGPT.app/Contents/Resources/codex`.

Open the Spec Book's cart builder. Wait for **Local runner connected**, select products or a category, and click **Build Carts**. Respond to supported browser requests and questions inside Studio. Review the existing Cart Runs section for authoritative per-item results. Stop never removes items already placed in a retailer cart.

**Build Carts includes permission to visit the selected retailers for that run.** The helper derives allowed HTTPS origins from the frozen online product URLs, including bare/www redirects, and answers only matching browser site-access prompts. It also permits the run's completion record in Studio. It does not grant unrelated sites, other browser permissions, local files, checkout, or payment access. This consent expires with the run.

An already-open retailer tab is reused. A failed page-opening or inspection call before any cart addition can be recovered using the current Chrome tabs. If an extension popup or login requires help, the runner pauses with **I've resolved it — Continue** inside Studio. Clicking Continue resumes the waiting call without preparing another run. A stopped or expired run cannot be resumed this way. Uncertain Add to Cart outcomes still require review to avoid duplicate items.

After an exact item is verified in the cart, the runner updates the linked product's **client retail price** from the current public selling price and **Studio cost** from the actual cart unit price after item discounts. Tax and shipping remain separate. Box and square-foot prices are converted to the Spec Book's saved unit using verified carton coverage. Both prices must be verified; otherwise existing prices remain and the cart result requests pricing review. A price-save failure never causes another cart addition. Cart results show both saved prices and refresh the Spec Book's pricing.

Pricing sync requires publishing the updated Studio MCP endpoint as well as the UI, then restarting the local helper to load its updated workflow. An older endpoint can still record cart additions, but cannot save the new pair of verified prices; the runner must report that limitation.

The helper listens only on `127.0.0.1:43189`, accepts the exact production Studio origin, and requires a valid one-hour Studio run authorization for all run operations. Chrome may ask to let Studio reach the local network. Allow that request only for Studio. Do not expose this port on a public interface.

For local development, explicitly set `MERAV_CART_PREVIEW_ORIGINS=http://127.0.0.1:3016`. Only localhost preview origins are accepted. Production run validation continues to use the production Studio MCP endpoint. Automated tests use an injected fake connection and sample run data.

## Recovery and limits

- The helper records consumed run IDs and token hashes under `~/.merav-cart-runner/runs.json` before dispatch. It never stores the raw run credential there. Do not delete the history to force a retry.
- Studio keeps the short-lived credential in the current tab's session storage so a reload can reconnect. This is connection recovery, not shared project data. Credentials are removed from tab storage when the local run reaches a terminal state.
- Double-clicking or reconnecting the same run cannot start a second turn. After an interruption or helper restart, inspect the retailer cart and prepare a new, explicitly reviewed selection. A refreshed token cannot silently take over an old run.
- One run may execute at a time. The helper stops the turn at expiry. Studio cancellation revokes the MCP token; stop the local runner as well if a browser action is underway.
- Only simple text/choice questions and string/boolean MCP permission forms are supported inline. Unsupported setup requests, shell commands, file edits, and expanded filesystem permissions are declined. Finish first-time browser setup in Codex if needed.
- The runner requires the desktop browser tools to be callable in its own Codex process. Merely having an installed Chrome extension is insufficient. Health checks verify tool discovery; each run must also confirm an actual Chrome connection before retailer actions.
- Codex app-server is documented as experimental. Keep the manual handoff as a fallback and test the installed version before rollout.
- The model still verifies exact SKU, finish, size, quantity, and carton calculations. A mismatch is a result requiring review, not permission to substitute.
- Checkout, payment, ordering, and sending email remain outside the runner's authorized workflow.

No database migration or new API keys are required. Deployment of the Studio UI and starting the local helper are separate steps. No automatic login-start service is installed by this change.
