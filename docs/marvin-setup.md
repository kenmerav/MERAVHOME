# Marvin Project Intelligence Setup

Marvin is implemented behind server APIs and is available only to the active Studio accounts for:

- `ken@meravinteriors.com`
- `katie@meravinteriors.com`

The existing `marvinbotai@gmail.com` automation is not changed. Keep it running during the 14-day comparison period.

## 1. Apply The Supabase Migration

Run the full contents of:

`supabase/migrations/20260722100000_add_marvin_project_intelligence.sql`

The migration creates Marvin's private tables and the private `marvin-sources` Storage bucket. It does not alter or delete existing project data.

## 2. Add Production Environment Variables

Add these server-only variables in Vercel for Production, Preview, and Development where appropriate:

```text
MARVIN_ENCRYPTION_KEY=<32 random bytes encoded as base64>
MARVIN_OAUTH_STATE_SECRET=<long random secret>
GOOGLE_MARVIN_CLIENT_ID=<Google OAuth web client ID>
GOOGLE_MARVIN_CLIENT_SECRET=<Google OAuth client secret>
GOOGLE_MARVIN_REDIRECT_URI=https://studio.meravinteriors.com/api/marvin-gmail-callback
MARVIN_FATHOM_WEBHOOK_URL=https://studio.meravinteriors.com/api/marvin-fathom-webhook
OPENAI_MARVIN_MODEL=gpt-5.6
CRON_SECRET=<long random secret>
```

`OPENAI_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` already used by Studio are also required.

`OPENAI_MARVIN_VECTOR_STORE_ID` is optional. When omitted, Marvin creates one shared vector store on first confirmed source indexing and saves its ID server-side.

Generate the encryption key locally without placing it in Git:

```bash
openssl rand -base64 32
```

Generate each signing secret separately:

```bash
openssl rand -base64 48
```

Do not rotate `MARVIN_ENCRYPTION_KEY` after connecting Gmail or Fathom unless stored credentials are disconnected first. Rotating it makes existing encrypted credentials unreadable; it does not delete confirmed sources.

## 3. Configure Google Workspace OAuth

In the MERAV Google Cloud project:

1. Enable the Gmail API.
2. Configure an internal OAuth consent screen for the MERAV Workspace organization.
3. Add the read-only Gmail scope: `https://www.googleapis.com/auth/gmail.readonly`.
4. Create a Web application OAuth client.
5. Add this exact production redirect URI: `https://studio.meravinteriors.com/api/marvin-gmail-callback`.
6. Add a localhost callback only when locally testing Google OAuth, and use that same value in the local `GOOGLE_MARVIN_REDIRECT_URI`.
7. Put the client ID and secret in Vercel, never in a browser variable beginning with `VITE_`.

Ken and Katie each open **Project Command Center > Marvin > Settings** from their own account and select **Connect Gmail**. Marvin verifies that the connected Google address exactly matches the signed-in Studio address.

The first sync imports up to 100 messages per run and saves its page cursor. Use **Sync Now** until neither Gmail connection reports a partial sync. Later runs use Gmail history IDs and recover with a resumable full sync if Google expires a history ID.

## 4. Connect Katie's Fathom Account

Katie completes this from her Studio account:

1. In Fathom, create an API key from API Access settings.
2. Open **Project Command Center > Marvin > Settings**.
3. Paste the API key under **Katie's Fathom** and select **Connect**.

Studio creates a signed webhook for Katie's recordings with transcript, summary, and action items enabled, encrypts both the API key and returned webhook secret, and begins the historical backfill. If the backfill is large, **Sync Now** resumes from the saved cursor.

Disconnecting Fathom deletes its webhook when possible and stops future imports. Confirmed historical project sources remain until explicitly deleted.

## 5. Verify The Pilot

1. Sign in as Ken and confirm the Marvin tab appears.
2. Sign in as Katie and confirm the Marvin tab appears.
3. Sign in as another employee and confirm the tab is absent and `/api/marvin` returns `403`.
4. Connect both Gmail accounts and Katie's Fathom account.
5. Add project contacts and aliases for reliable matching.
6. Run **Sync Now**, review uncertain matches, and confirm unrelated email removal.
7. Add a note, PDF, DOCX, text file, and voice memo to a test project.
8. Ask a project question and verify cited source links and current Studio data are shown.
9. Run the morning briefing twice and confirm no duplicate scheduled briefing or task suggestion appears.
10. Approve one suggestion and confirm only that action creates a real Project Command Center task.

Vercel runs `/api/marvin-cron` at `0 14 * * *`, which is 7:00 AM in Phoenix. Vercel sends `CRON_SECRET` as the bearer token. The date key and unique sync-job record prevent duplicate scheduled runs.
