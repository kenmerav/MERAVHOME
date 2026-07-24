---
name: merav-cart-workflow
description: Process a prepared MERAVHOME Studio procurement/cart run by retrieving its frozen Spec Book products, using the separate @Chrome plugin to add exact verified variants and quantities to retailer carts, updating Studio after every item, and stopping before checkout. Use when the user provides a Merav cart-run authorization, asks to build carts from a Studio Spec Book, retries unresolved Merav procurement items, or requests an exception summary for a Merav cart run.
---

# Merav Cart Workflow

Build retailer carts from one prepared Studio run. The Merav MCP tools provide
structured product requirements and results storage. They do not control a
browser. Use the separately installed `@Chrome` plugin for retailer pages.

## Required workflow

1. Call `get_procurement_run` with the supplied run authorization.
2. Summarize the product count, retailer count, and any product whose current
   requirements remain ambiguous.
3. Confirm that `@Chrome` is available. Pause if it is unavailable; do not use a
   headless browser or another purchasing channel.
4. Process one retailer at a time and one product at a time.
5. Open the exact product URL returned by Studio.
6. Compare the retailer page product name and SKU/model number with Studio.
7. Select every requested option exactly: color, finish, size, dimensions, and
   other requirements.
8. Set the requested quantity.
9. Add the item only after the product and all required options match.
10. Verify the product, variation, and quantity in the retailer cart.
11. Immediately call `update_procurement_item` with the observed title,
    options, price, availability, cart URL when available, status, and a concise
    note.
12. Continue until every run item has a reported result.
13. Call `complete_procurement_run` and give the user a short exception summary.

## Matching rules

- Normalize harmless presentation differences such as `24 in`, `24-inch`, and
  `24"`; `x`, `×`, and `by` dimension separators; whitespace; punctuation; and
  capitalization.
- Treat a retailer label such as `Natural Oak` as an exact match only when it is
  clearly the same single option, not merely similar.
- Do not treat multiple plausible choices as an exact match.
- If the product name or SKU conflicts, set `option_mismatch` or
  `needs_review`; do not add it.
- If any required option is absent or ambiguous, set `needs_review`.
- Record a changed observed price. Do not hide or silently accept the change.
- Use `out_of_stock`, `backordered`, `login_required`, `captcha_required`,
  `unsupported_retailer`, or `failed` when those conditions occur.
- Never retry an item already marked `added` unless the user explicitly
  authorizes adding that item again through Studio.

## Hard safety boundary

- Never click Buy Now.
- Never begin or proceed to checkout.
- Never click Submit Order, Place Order, or an equivalent control.
- Never enter, select, or change payment information.
- Never accept a substitution unless Studio explicitly contains authorization.
- Never bypass a CAPTCHA.
- Never ask the user to give ChatGPT a password.
- If login is required, pause and let the user sign in visibly.
- Keep website-access approvals visible to the user.
- If a choice is ambiguous, stop on that item and mark `needs_review`.
- Adding an item to a cart does not authorize purchasing it.
