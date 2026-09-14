/* eslint-disable @typescript-eslint/no-explicit-any -- Procurement email tables are server-only until generated Supabase types include the migration. */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildProcurementEmailDrafts,
  KEN_PROCUREMENT_EMAIL,
  type ProcurementEmailDraft,
} from "@/lib/procurementCart";
import { canUseProcurementCartBuilder } from "@/lib/permissions";
import { authorizeProcurementRun } from "@/lib/procurementRuns.server";

const admin = supabaseAdmin as any;
const GMAIL_DRAFTS_URL = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";
const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";

type ProcurementEmailAccess = {
  user: { id: string; email?: string };
  profile: { id: string; email: string; role: string; is_active: boolean };
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function requireProcurementEmailUser(
  request: Request,
): Promise<ProcurementEmailAccess | { error: Response }> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: json({ error: "Sign in first." }, 401) };
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    return { error: json({ error: "Your Studio session is no longer valid." }, 401) };
  }
  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("id,email,role,is_active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!canUseProcurementCartBuilder(profile)) {
    return { error: json({ error: "Procurement email is available to Ken only." }, 403) };
  }
  return {
    user: { id: userData.user.id, email: userData.user.email },
    profile,
  };
}

function credentialKey() {
  const configured =
    process.env.PROCUREMENT_EMAIL_ENCRYPTION_KEY?.trim() ||
    process.env.MARVIN_ENCRYPTION_KEY?.trim();
  if (!configured) throw new Error("Procurement email encryption is not configured.");
  const decoded = /^[a-f0-9]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (decoded.length !== 32) {
    throw new Error("The procurement email encryption key must decode to exactly 32 bytes.");
  }
  return decoded;
}

function encryptCredentials(value: Record<string, unknown>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    encrypted_credentials: encrypted.toString("base64"),
    credential_iv: iv.toString("base64"),
    credential_tag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptCredentials(row: any): Record<string, any> {
  if (!row?.encrypted_credentials || !row?.credential_iv || !row?.credential_tag) return {};
  const decipher = createDecipheriv(
    "aes-256-gcm",
    credentialKey(),
    Buffer.from(row.credential_iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(row.credential_tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(row.encrypted_credentials, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  );
}

function oauthStateSecret() {
  return (
    process.env.PROCUREMENT_EMAIL_OAUTH_STATE_SECRET ||
    process.env.MARVIN_OAUTH_STATE_SECRET ||
    process.env.PROCUREMENT_EMAIL_ENCRYPTION_KEY ||
    process.env.MARVIN_ENCRYPTION_KEY ||
    ""
  );
}

function googleClientId() {
  return process.env.GOOGLE_PROCUREMENT_CLIENT_ID || process.env.GOOGLE_MARVIN_CLIENT_ID || "";
}

function googleClientSecret() {
  return (
    process.env.GOOGLE_PROCUREMENT_CLIENT_SECRET || process.env.GOOGLE_MARVIN_CLIENT_SECRET || ""
  );
}

function safeReturnPath(value: unknown) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/specbooks";
  return candidate;
}

function createOauthState(input: { userId: string; redirectUri: string; returnPath: string }) {
  const secret = oauthStateSecret();
  if (!secret) throw new Error("Procurement email OAuth state is not configured.");
  const payload = Buffer.from(
    JSON.stringify({
      ...input,
      accountEmail: KEN_PROCUREMENT_EMAIL,
      exp: Date.now() + 600_000,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyOauthState(value: string) {
  const [payload, supplied] = value.split(".");
  const secret = oauthStateSecret();
  if (!payload || !supplied || !secret) throw new Error("Invalid OAuth state.");
  const expected = createHmac("sha256", secret).update(payload).digest();
  const actual = Buffer.from(supplied, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Invalid OAuth state.");
  }
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (
    !decoded?.userId ||
    !decoded?.redirectUri ||
    decoded.accountEmail !== KEN_PROCUREMENT_EMAIL ||
    Number(decoded.exp) < Date.now()
  ) {
    throw new Error("The Google connection request expired.");
  }
  return decoded as {
    userId: string;
    accountEmail: string;
    redirectUri: string;
    returnPath: string;
  };
}

export function procurementGmailAuthorizationUrl(input: {
  access: ProcurementEmailAccess;
  origin: string;
  returnPath?: string;
}) {
  if (input.access.profile.email.toLowerCase() !== KEN_PROCUREMENT_EMAIL) {
    throw new Error(`Sign in to Studio as ${KEN_PROCUREMENT_EMAIL} to connect draft email.`);
  }
  const clientId = googleClientId();
  const redirectUri =
    process.env.GOOGLE_PROCUREMENT_REDIRECT_URI || `${input.origin}/api/procurement-gmail-callback`;
  if (!clientId) throw new Error("Google OAuth is not configured for procurement drafts.");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `openid email ${GMAIL_COMPOSE_SCOPE}`,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    login_hint: KEN_PROCUREMENT_EMAIL,
    state: createOauthState({
      userId: input.access.user.id,
      redirectUri,
      returnPath: safeReturnPath(input.returnPath),
    }),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function completeProcurementGmailOauth(code: string, state: string) {
  const identity = verifyOauthState(state);
  const clientId = googleClientId();
  const clientSecret = googleClientSecret();
  if (!clientId || !clientSecret) throw new Error("Google OAuth is incomplete.");
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: identity.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok) throw new Error(tokens?.error_description || "Google connection failed.");
  const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const googleProfile = await profileResponse.json();
  const accountEmail = String(googleProfile?.email || "").toLowerCase();
  if (accountEmail !== KEN_PROCUREMENT_EMAIL) {
    throw new Error(`Connect ${KEN_PROCUREMENT_EMAIL}, not ${accountEmail || "another account"}.`);
  }

  const { data: existing } = await admin
    .from("procurement_email_integrations")
    .select("*")
    .eq("account_email", KEN_PROCUREMENT_EMAIL)
    .maybeSingle();
  const old = existing ? decryptCredentials(existing) : {};
  const credentials = encryptCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || old.refresh_token,
    expires_at: Date.now() + Number(tokens.expires_in || 3600) * 1000,
    scope: tokens.scope,
  });
  const { error } = await admin.from("procurement_email_integrations").upsert(
    {
      owner_user_id: identity.userId,
      account_email: KEN_PROCUREMENT_EMAIL,
      ...credentials,
      oauth_scope: tokens.scope || GMAIL_COMPOSE_SCOPE,
      status: "connected",
      last_error: null,
    },
    { onConflict: "account_email" },
  );
  if (error) throw error;
  return { returnPath: safeReturnPath(identity.returnPath) };
}

export async function getProcurementEmailConnection() {
  const { data, error } = await admin
    .from("procurement_email_integrations")
    .select("account_email,status,updated_at,last_error")
    .eq("account_email", KEN_PROCUREMENT_EMAIL)
    .maybeSingle();
  if (error) throw error;
  return {
    connected: data?.status === "connected",
    account_email: data?.account_email ?? KEN_PROCUREMENT_EMAIL,
    status: data?.status ?? "not_connected",
    updated_at: data?.updated_at ?? null,
    last_error: data?.last_error ?? null,
    capability: "draft_only" as const,
  };
}

async function gmailAccessToken(integration: any) {
  const credentials = decryptCredentials(integration);
  if (credentials.access_token && Number(credentials.expires_at || 0) > Date.now() + 60_000) {
    return String(credentials.access_token);
  }
  if (!credentials.refresh_token) throw new Error("Reconnect Ken's draft email account.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      refresh_token: String(credentials.refresh_token),
      grant_type: "refresh_token",
    }),
  });
  const refreshed = await response.json();
  if (!response.ok) {
    throw new Error(refreshed?.error_description || "Procurement Gmail token refresh failed.");
  }
  const next = {
    ...credentials,
    access_token: refreshed.access_token,
    expires_at: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
  };
  const { error } = await admin
    .from("procurement_email_integrations")
    .update({ ...encryptCredentials(next), status: "connected", last_error: null })
    .eq("id", integration.id);
  if (error) throw error;
  return String(refreshed.access_token);
}

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function buildGmailDraftRaw(draft: ProcurementEmailDraft) {
  const subject = `=?UTF-8?B?${Buffer.from(safeHeader(draft.subject), "utf8").toString("base64")}?=`;
  const encodedBody = Buffer.from(draft.body, "utf8").toString("base64");
  const message = [
    `To: ${safeHeader(draft.to)}`,
    `From: ${KEN_PROCUREMENT_EMAIL}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodedBody,
  ].join("\r\n");
  return Buffer.from(message, "utf8").toString("base64url");
}

function draftPayloadHash(draft: ProcurementEmailDraft) {
  return createHash("sha256")
    .update(JSON.stringify({ to: draft.to, subject: draft.subject, body: draft.body }))
    .digest("hex");
}

async function markRunItemsDrafted(input: {
  runId: string;
  items: Array<{ id: string; observed_options: Record<string, unknown> }>;
  draftId: string;
  threadId: string | null;
  draftedAt: string;
}) {
  for (const item of input.items) {
    const { error } = await admin
      .from("procurement_run_items")
      .update({
        status: "drafted",
        observed_options: {
          ...(item.observed_options ?? {}),
          gmail_draft_id: input.draftId,
          gmail_thread_id: input.threadId,
          gmail_account: KEN_PROCUREMENT_EMAIL,
          drafted_at: input.draftedAt,
        },
        result_notes: `Draft created in ${KEN_PROCUREMENT_EMAIL}; awaiting Ken's review and manual send.`,
      })
      .eq("id", item.id)
      .eq("run_id", input.runId);
    if (error) throw error;
  }
  await admin
    .from("procurement_runs")
    .update({ status: "in_progress", started_at: input.draftedAt })
    .eq("id", input.runId)
    .eq("status", "prepared");
}

export async function createRetailerDraftForAuthorizedRun(input: {
  runAuthorization: string;
  draftKey: string;
}) {
  const run = await authorizeProcurementRun(input.runAuthorization);
  const draft = buildProcurementEmailDrafts(run.project_name, run.items).find(
    (candidate) => candidate.draft_key === input.draftKey,
  );
  if (!draft) throw new Error("That draft does not belong to the authorized procurement run.");
  const runItems = run.items.filter((item) => draft.run_item_ids.includes(item.id));
  if (!runItems.length || runItems.some((item) => item.status === "added")) {
    throw new Error("This email draft cannot be created for the current item states.");
  }

  const payloadHash = draftPayloadHash(draft);
  const { data: existing, error: existingError } = await admin
    .from("procurement_email_drafts")
    .select("*")
    .eq("run_id", run.id)
    .eq("draft_key", draft.draft_key)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.payload_hash && existing.payload_hash !== payloadHash) {
    throw new Error("The frozen email draft changed unexpectedly. Prepare a new run.");
  }
  if (existing?.status === "created" && existing.gmail_draft_id) {
    await markRunItemsDrafted({
      runId: run.id,
      items: runItems,
      draftId: existing.gmail_draft_id,
      threadId: existing.gmail_thread_id ?? null,
      draftedAt: existing.created_in_gmail_at ?? existing.updated_at,
    });
    return {
      draft_id: existing.gmail_draft_id,
      thread_id: existing.gmail_thread_id ?? null,
      draft_key: draft.draft_key,
      recipient: draft.to,
      subject: draft.subject,
      account_email: KEN_PROCUREMENT_EMAIL,
      run_item_ids: draft.run_item_ids,
      created_at: existing.created_in_gmail_at ?? existing.updated_at,
      already_existed: true,
    };
  }
  if (existing?.status === "creating") {
    throw new Error(
      "This retailer draft is already being created. Refresh the run before retrying.",
    );
  }

  if (existing) {
    const { data: claimed, error } = await admin
      .from("procurement_email_drafts")
      .update({ status: "creating", last_error: null })
      .eq("id", existing.id)
      .eq("status", "failed")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!claimed) {
      throw new Error("This retailer draft is already being retried. Refresh before retrying.");
    }
  } else {
    const { error } = await admin.from("procurement_email_drafts").insert({
      run_id: run.id,
      draft_key: draft.draft_key,
      payload_hash: payloadHash,
      account_email: KEN_PROCUREMENT_EMAIL,
      recipient_email: draft.to,
      subject: draft.subject,
      status: "creating",
    });
    if (error) {
      if (error.code === "23505") {
        throw new Error("This retailer draft is already being created. Refresh before retrying.");
      }
      throw error;
    }
  }

  try {
    const { data: integration, error: integrationError } = await admin
      .from("procurement_email_integrations")
      .select("*")
      .eq("account_email", KEN_PROCUREMENT_EMAIL)
      .eq("status", "connected")
      .maybeSingle();
    if (integrationError) throw integrationError;
    if (!integration) {
      throw new Error(`Connect ${KEN_PROCUREMENT_EMAIL} in Studio before creating rep drafts.`);
    }
    const accessToken = await gmailAccessToken(integration);
    const response = await fetch(GMAIL_DRAFTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: { raw: buildGmailDraftRaw(draft) } }),
    });
    const created = await response.json();
    if (!response.ok || !created?.id) {
      throw new Error(created?.error?.message || "Gmail could not create the retailer draft.");
    }
    const draftedAt = new Date().toISOString();
    const threadId = created.message?.threadId ? String(created.message.threadId) : null;
    const { error: recordError } = await admin
      .from("procurement_email_drafts")
      .update({
        status: "created",
        gmail_draft_id: String(created.id),
        gmail_thread_id: threadId,
        created_in_gmail_at: draftedAt,
        last_error: null,
      })
      .eq("run_id", run.id)
      .eq("draft_key", draft.draft_key);
    if (recordError) throw recordError;
    await markRunItemsDrafted({
      runId: run.id,
      items: runItems,
      draftId: String(created.id),
      threadId,
      draftedAt,
    });
    return {
      draft_id: String(created.id),
      thread_id: threadId,
      draft_key: draft.draft_key,
      recipient: draft.to,
      subject: draft.subject,
      account_email: KEN_PROCUREMENT_EMAIL,
      run_item_ids: draft.run_item_ids,
      created_at: draftedAt,
      already_existed: false,
    };
  } catch (error) {
    await admin
      .from("procurement_email_drafts")
      .update({
        status: "failed",
        last_error:
          error instanceof Error ? error.message.slice(0, 1000) : "Draft creation failed.",
      })
      .eq("run_id", run.id)
      .eq("draft_key", draft.draft_key);
    throw error;
  }
}
