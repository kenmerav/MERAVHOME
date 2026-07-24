# Procurement Draft Email Setup

This connection is separate from Marvin. Marvin keeps its existing read-only
Ken and Katie Gmail connections and scopes.

## 1. Apply the migration

Apply:

`supabase/migrations/20260724160000_add_procurement_drafts_and_tile_units.sql`

It adds the `drafted` run status, converts historical Email rep items from
`skipped` to `drafted`, and creates private integration and draft-audit tables.
Only the service role can access the new tables.

Also apply:

`supabase/migrations/20260724170000_add_product_carton_coverage.sql`

It stores the verified square feet per carton, the source link and supporting
text, confidence, and the time Studio last checked the website.

## 2. Configure server-only environment variables

Add these values to Vercel:

```text
PROCUREMENT_EMAIL_ENCRYPTION_KEY=<32 random bytes encoded as base64>
PROCUREMENT_EMAIL_OAUTH_STATE_SECRET=<long random secret>
GOOGLE_PROCUREMENT_CLIENT_ID=<Google OAuth web client ID>
GOOGLE_PROCUREMENT_CLIENT_SECRET=<Google OAuth client secret>
GOOGLE_PROCUREMENT_REDIRECT_URI=https://studio.meravinteriors.com/api/procurement-gmail-callback
```

The Google client ID and secret may use the same Google Cloud OAuth client as
Marvin, but the procurement redirect URI and authorization grant are separate.
If the procurement-specific encryption and OAuth secrets are omitted, Studio
falls back to the existing Marvin server secrets for compatibility.

## 3. Configure Google OAuth

1. Enable the Gmail API in the MERAV Google Cloud project.
2. Add the exact production redirect URI:
   `https://studio.meravinteriors.com/api/procurement-gmail-callback`.
3. Add the localhost equivalent when testing locally.
4. Make the OAuth app internal to the MERAV Workspace organization.
5. Connect only `ken@meravinteriors.com` from the Spec Book Cart Builder.

Google does not offer an OAuth scope that can create drafts but cannot send.
The connection therefore uses `gmail.compose`, while Studio enforces the
draft-only boundary in its own API: the procurement tool implements only
Gmail's draft-create endpoint, accepts only a Studio-frozen draft key, and
contains no send endpoint or send action.

## 4. Refresh the plugin

After deployment, refresh or reinstall Merav Cart Builder version `0.2.0` so
Codex uses `create_retailer_draft` instead of the Gmail connector.

## 5. Website carton coverage

Keep `FIRECRAWL_API_KEY` configured as a server-only environment variable.
When a Cart Builder item uses square feet, Studio checks the exact product page
and, when needed, its linked packaging document. It auto-fills coverage only
when the supporting text matches the requested SKU or dimensions. Ambiguous
results stay blocked for manual review.
