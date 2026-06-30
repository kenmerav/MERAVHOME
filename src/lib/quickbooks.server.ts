import { supabaseAdmin } from "@/integrations/supabase/client.server";

type QuickBooksEnvironment = "sandbox" | "production";

type QuickBooksConnection = {
  id: string;
  realm_id: string;
  environment: QuickBooksEnvironment;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  is_active: boolean;
};

type QuickBooksProjectLink = {
  id: string;
  project_id: string;
  realm_id: string;
  quickbooks_customer_id: string | null;
  quickbooks_customer_name: string | null;
  quickbooks_project_id: string | null;
  quickbooks_project_name: string | null;
};

type QuickBooksTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  x_refresh_token_expires_in?: number;
};

export type QuickBooksCustomerOption = {
  id: string;
  name: string;
  companyName: string | null;
};

const QUICKBOOKS_ACCOUNTING_SCOPE = "com.intuit.quickbooks.accounting";

export function getQuickBooksConfig() {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  const environment = (process.env.QUICKBOOKS_ENVIRONMENT === "production" ? "production" : "sandbox") as QuickBooksEnvironment;
  const redirectUri =
    process.env.QUICKBOOKS_REDIRECT_URI ||
    "https://studio.meravinteriors.com/api/quickbooks/callback";

  return { clientId, clientSecret, environment, redirectUri };
}

export function quickBooksIsConfigured() {
  const config = getQuickBooksConfig();
  return Boolean(config.clientId && config.clientSecret && config.redirectUri);
}

export function quickBooksAuthorizationUrl(state: string) {
  const { clientId, redirectUri } = getQuickBooksConfig();
  if (!clientId) throw new Error("Missing QUICKBOOKS_CLIENT_ID.");

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: QUICKBOOKS_ACCOUNTING_SCOPE,
    redirect_uri: redirectUri,
    state,
  });

  return `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`;
}

export async function exchangeQuickBooksCode(code: string, realmId: string) {
  const tokens = await quickBooksTokenRequest(new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: getQuickBooksConfig().redirectUri,
  }));

  const now = Date.now();
  const accessExpiresAt = new Date(now + Number(tokens.expires_in ?? 3600) * 1000).toISOString();
  const refreshExpiresAt = tokens.x_refresh_token_expires_in
    ? new Date(now + Number(tokens.x_refresh_token_expires_in) * 1000).toISOString()
    : null;

  const { data, error } = await supabaseAdmin
    .from("quickbooks_connections" as any)
    .upsert({
      realm_id: realmId,
      environment: getQuickBooksConfig().environment,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      access_token_expires_at: accessExpiresAt,
      refresh_token_expires_at: refreshExpiresAt,
      is_active: true,
    }, { onConflict: "realm_id" })
    .select()
    .single();

  if (error) throw error;

  await supabaseAdmin
    .from("quickbooks_connections" as any)
    .update({ is_active: false })
    .neq("id", data.id);

  return data as QuickBooksConnection;
}

export async function getQuickBooksStatus(projectId?: string | null) {
  const connection = await getActiveQuickBooksConnection();
  let projectLink: QuickBooksProjectLink | null = null;

  if (connection && projectId) {
    projectLink = await getProjectLink(projectId, connection.realm_id);
  }

  return {
    configured: quickBooksIsConfigured(),
    connected: Boolean(connection),
    environment: getQuickBooksConfig().environment,
    realmId: connection?.realm_id ?? null,
    projectLink,
  };
}

export async function disconnectQuickBooks() {
  const { error } = await supabaseAdmin
    .from("quickbooks_connections" as any)
    .update({ is_active: false })
    .eq("is_active", true);

  if (error) throw error;
}

export async function saveQuickBooksProjectLink({
  projectId,
  quickbooksCustomerId,
  quickbooksCustomerName,
  quickbooksProjectId,
  quickbooksProjectName,
}: {
  projectId: string;
  quickbooksCustomerId?: string | null;
  quickbooksCustomerName?: string | null;
  quickbooksProjectId?: string | null;
  quickbooksProjectName?: string | null;
}) {
  const connection = await requireActiveQuickBooksConnection();
  const { data, error } = await supabaseAdmin
    .from("quickbooks_project_links" as any)
    .upsert({
      project_id: projectId,
      realm_id: connection.realm_id,
      quickbooks_customer_id: emptyToNull(quickbooksCustomerId),
      quickbooks_customer_name: emptyToNull(quickbooksCustomerName),
      quickbooks_project_id: emptyToNull(quickbooksProjectId),
      quickbooks_project_name: emptyToNull(quickbooksProjectName),
    }, { onConflict: "project_id,realm_id" })
    .select()
    .single();

  if (error) throw error;
  return data as QuickBooksProjectLink;
}

export async function listQuickBooksCustomers(search?: string | null): Promise<QuickBooksCustomerOption[]> {
  const connection = await requireActiveQuickBooksConnection();
  const cleanSearch = search?.trim();
  const where = cleanSearch
    ? ` where DisplayName like '%${escapeQuickBooksQuery(cleanSearch)}%'`
    : "";
  const result = await quickBooksQuery<{
    Customer?: Array<{ Id: string; DisplayName: string; CompanyName?: string | null }>;
  }>(
    connection,
    `select * from Customer${where} order by DisplayName maxresults 100`,
  );

  return (result.Customer ?? []).map((customer) => ({
    id: customer.Id,
    name: customer.DisplayName,
    companyName: customer.CompanyName ?? null,
  }));
}

export async function syncFinancialInvoiceToQuickBooks(invoiceId: string) {
  const connection = await requireActiveQuickBooksConnection();

  const { data: invoice, error: invoiceError } = await supabaseAdmin
    .from("financial_invoices" as any)
    .select("*, project:projects(id,name,client_name), payments:financial_invoice_payments(*)")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invoiceError) throw invoiceError;
  if (!invoice) throw new Error("Invoice not found.");
  if (!invoice.project_id) throw new Error("Attach this invoice to a Studio project before sending it to QuickBooks.");

  const paidRows = [...(invoice.payments ?? [])]
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .filter((payment) => payment.status === "paid" && Number(payment.amount || 0) > 0);
  const paidTotal = roundMoney(paidRows.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
  if (paidTotal <= 0) {
    throw new Error("Mark at least one payment paid before sending this invoice to QuickBooks.");
  }

  try {
    const customer = await getOrCreateCustomer(connection, invoice);
    const serviceItemId = await getOrCreateServiceItem(connection);
    const quickBooksInvoiceId = await ensureQuickBooksInvoice(connection, invoice, customer, serviceItemId, paidTotal);

    const quickBooksInvoice = await getQuickBooksInvoice(connection, quickBooksInvoiceId);
    // QuickBooks should only receive paid Studio phases, keeping P&L clean even outside cash-basis reports.
    const expectedBalance = 0;
    let paymentGap = Math.max(0, roundMoney(Number(quickBooksInvoice?.Balance ?? invoice.total_amount ?? 0) - expectedBalance));
    const paidPayments = paidRows.filter((payment) => {
      if (!payment.quickbooks_payment_id) return true;
      if (paymentGap <= 0) return false;
      paymentGap = Math.max(0, roundMoney(paymentGap - Number(payment.amount || 0)));
      return true;
    });

    const syncedPayments = [];
    for (const payment of paidPayments) {
      const quickBooksPaymentId = await createQuickBooksPayment(connection, {
        customerId: customer.id,
        invoiceId: quickBooksInvoiceId,
        amount: Number(payment.amount || 0),
        note: payment.label || "Studio payment",
      });
      syncedPayments.push({ studioPaymentId: payment.id, quickBooksPaymentId });
      await supabaseAdmin
        .from("financial_invoice_payments" as any)
        .update({
          quickbooks_payment_id: quickBooksPaymentId,
          quickbooks_synced_at: new Date().toISOString(),
          quickbooks_sync_error: null,
        })
        .eq("id", payment.id);
    }

    await supabaseAdmin
      .from("financial_invoices" as any)
      .update({
        quickbooks_invoice_id: quickBooksInvoiceId,
        quickbooks_sync_status: "sent",
        quickbooks_synced_at: new Date().toISOString(),
        quickbooks_sync_error: null,
      })
      .eq("id", invoiceId);

    return {
      quickBooksInvoiceId,
      syncedPaymentCount: syncedPayments.length,
      customerName: customer.name,
    };
  } catch (error: any) {
    await supabaseAdmin
      .from("financial_invoices" as any)
      .update({
        quickbooks_sync_status: "failed",
        quickbooks_sync_error: error?.message || "QuickBooks sync failed.",
      })
      .eq("id", invoiceId);
    throw error;
  }
}

async function quickBooksTokenRequest(body: URLSearchParams): Promise<QuickBooksTokenResponse> {
  const { clientId, clientSecret } = getQuickBooksConfig();
  if (!clientId || !clientSecret) throw new Error("Missing QuickBooks Client ID or Client Secret.");

  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error_description || data?.error || "QuickBooks token request failed.");
  return data;
}

async function getActiveQuickBooksConnection() {
  const { environment } = getQuickBooksConfig();
  const { data, error } = await supabaseAdmin
    .from("quickbooks_connections" as any)
    .select("*")
    .eq("is_active", true)
    .eq("environment", environment)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as QuickBooksConnection | null;
}

async function requireActiveQuickBooksConnection() {
  const connection = await getActiveQuickBooksConnection();
  if (!connection) throw new Error("QuickBooks is not connected yet.");
  return refreshConnectionIfNeeded(connection);
}

async function refreshConnectionIfNeeded(connection: QuickBooksConnection) {
  const expiresAt = connection.access_token_expires_at ? new Date(connection.access_token_expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 2 * 60 * 1000) return connection;

  const tokens = await quickBooksTokenRequest(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: connection.refresh_token,
  }));
  const now = Date.now();
  const patch = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    access_token_expires_at: new Date(now + Number(tokens.expires_in ?? 3600) * 1000).toISOString(),
    refresh_token_expires_at: tokens.x_refresh_token_expires_in
      ? new Date(now + Number(tokens.x_refresh_token_expires_in) * 1000).toISOString()
      : connection.refresh_token_expires_at,
  };

  const { data, error } = await supabaseAdmin
    .from("quickbooks_connections" as any)
    .update(patch)
    .eq("id", connection.id)
    .select()
    .single();
  if (error) throw error;
  return data as QuickBooksConnection;
}

async function getProjectLink(projectId: string, realmId: string) {
  const { data, error } = await supabaseAdmin
    .from("quickbooks_project_links" as any)
    .select("*")
    .eq("project_id", projectId)
    .eq("realm_id", realmId)
    .maybeSingle();
  if (error) throw error;
  return data as QuickBooksProjectLink | null;
}

async function quickBooksApi<T>(connection: QuickBooksConnection, path: string, init?: RequestInit): Promise<T> {
  const freshConnection = await refreshConnectionIfNeeded(connection);
  const baseUrl = freshConnection.environment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
  const url = `${baseUrl}/v3/company/${freshConnection.realm_id}/${path}${path.includes("?") ? "&" : "?"}minorversion=75`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${freshConnection.access_token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data?.Fault?.Error?.[0]?.Detail || data?.Fault?.Error?.[0]?.Message || data?.error_description || "QuickBooks request failed.";
    throw new Error(detail);
  }
  return data as T;
}

async function quickBooksQuery<T = any>(connection: QuickBooksConnection, query: string) {
  const data = await quickBooksApi<{ QueryResponse?: T }>(
    connection,
    `query?query=${encodeURIComponent(query)}`,
    { method: "GET" },
  );
  return data.QueryResponse ?? ({} as T);
}

async function getOrCreateCustomer(connection: QuickBooksConnection, invoice: any) {
  const projectId = invoice.project_id as string;
  const project = invoice.project ?? {};
  const link = await getProjectLink(projectId, connection.realm_id);
  if (link?.quickbooks_customer_id) {
    return { id: link.quickbooks_customer_id, name: link.quickbooks_customer_name || project.client_name || project.name || "Studio Client" };
  }

  const displayName = cleanQuickBooksName(invoice.client_name || project.client_name || project.name || invoice.file_name || "Studio Client");
  const existing = await quickBooksQuery<{ Customer?: Array<{ Id: string; DisplayName: string }> }>(
    connection,
    `select * from Customer where DisplayName = '${escapeQuickBooksQuery(displayName)}' maxresults 1`,
  );
  const customer = existing.Customer?.[0] ?? await createCustomer(connection, displayName);

  await saveQuickBooksProjectLink({
    projectId,
    quickbooksCustomerId: customer.Id,
    quickbooksCustomerName: customer.DisplayName,
  });

  return { id: customer.Id, name: customer.DisplayName };
}

async function createCustomer(connection: QuickBooksConnection, displayName: string) {
  const data = await quickBooksApi<{ Customer: { Id: string; DisplayName: string } }>(connection, "customer", {
    method: "POST",
    body: JSON.stringify({ DisplayName: displayName }),
  });
  return data.Customer;
}

async function getOrCreateServiceItem(connection: QuickBooksConnection) {
  const itemName = cleanQuickBooksName(process.env.QUICKBOOKS_SERVICE_ITEM_NAME || "Design Services");
  const existing = await quickBooksQuery<{ Item?: Array<{ Id: string; Name: string }> }>(
    connection,
    `select * from Item where Name = '${escapeQuickBooksQuery(itemName)}' maxresults 1`,
  );
  if (existing.Item?.[0]?.Id) return existing.Item[0].Id;

  const incomeAccount = await getIncomeAccount(connection);
  const data = await quickBooksApi<{ Item: { Id: string } }>(connection, "item", {
    method: "POST",
    body: JSON.stringify({
      Name: itemName,
      Type: "Service",
      IncomeAccountRef: { value: incomeAccount.Id, name: incomeAccount.Name },
    }),
  });
  return data.Item.Id;
}

async function getIncomeAccount(connection: QuickBooksConnection) {
  const servicesAccount = await quickBooksQuery<{ Account?: Array<{ Id: string; Name: string }> }>(
    connection,
    "select * from Account where Name = 'Services' and AccountType = 'Income' maxresults 1",
  );
  const preferredAccount = servicesAccount.Account?.[0];
  if (preferredAccount) return preferredAccount;

  const existing = await quickBooksQuery<{ Account?: Array<{ Id: string; Name: string }> }>(
    connection,
    "select * from Account where AccountType = 'Income' maxresults 1",
  );
  const account = existing.Account?.[0];
  if (!account) throw new Error("QuickBooks needs an Income account before Studio can create a service item.");
  return account;
}

async function ensureQuickBooksInvoice(
  connection: QuickBooksConnection,
  invoice: any,
  customer: { id: string; name: string },
  itemId: string,
  paidTotal: number,
) {
  if (!invoice.quickbooks_invoice_id) {
    return createQuickBooksInvoice(connection, invoice, customer, itemId, paidTotal);
  }

  const existing = await getQuickBooksInvoice(connection, invoice.quickbooks_invoice_id);
  if (!existing) {
    return createQuickBooksInvoice(connection, invoice, customer, itemId, paidTotal);
  }

  const salesLine = existing.Line?.find((line: any) => line.DetailType === "SalesItemLineDetail");
  const customerChanged = existing.CustomerRef?.value !== customer.id;
  const amountChanged = roundMoney(Number(salesLine?.Amount ?? existing.TotalAmt ?? 0)) !== paidTotal;
  const descriptionChanged = Boolean(salesLine) && salesLine.Description !== (invoice.file_name || "MERAV Studio invoice");

  if (customerChanged || amountChanged || descriptionChanged) {
    await updateQuickBooksInvoice(connection, existing, invoice, customer, itemId, salesLine, paidTotal);
  }

  return existing.Id;
}

async function getQuickBooksInvoice(connection: QuickBooksConnection, quickBooksInvoiceId: string) {
  const existing = await quickBooksQuery<{ Invoice?: Array<any> }>(
    connection,
    `select * from Invoice where Id = '${escapeQuickBooksQuery(quickBooksInvoiceId)}' maxresults 1`,
  );
  return existing.Invoice?.[0] ?? null;
}

async function updateQuickBooksInvoice(
  connection: QuickBooksConnection,
  existingInvoice: any,
  studioInvoice: any,
  customer: { id: string; name: string },
  itemId: string,
  salesLine: any,
  paidTotal: number,
) {
  if (paidTotal <= 0) throw new Error("Paid total must be greater than $0 before it can be sent to QuickBooks.");

  const line = {
    ...(salesLine?.Id ? { Id: salesLine.Id } : {}),
    Description: studioInvoice.file_name || "MERAV Studio invoice",
    Amount: roundMoney(paidTotal),
    DetailType: "SalesItemLineDetail",
    SalesItemLineDetail: {
      ItemRef: { value: itemId },
      Qty: 1,
      UnitPrice: roundMoney(paidTotal),
    },
  };

  await quickBooksApi<{ Invoice: { Id: string } }>(connection, "invoice?operation=update", {
    method: "POST",
    body: JSON.stringify({
      Id: existingInvoice.Id,
      SyncToken: existingInvoice.SyncToken,
      sparse: true,
      CustomerRef: { value: customer.id, name: customer.name },
      PrivateNote: `Created from MERAV Studio invoice ${studioInvoice.id}`,
      Line: [line],
    }),
  });
}

async function createQuickBooksInvoice(connection: QuickBooksConnection, invoice: any, customer: { id: string; name: string }, itemId: string, paidTotal: number) {
  if (paidTotal <= 0) throw new Error("Paid total must be greater than $0 before it can be sent to QuickBooks.");

  const data = await quickBooksApi<{ Invoice: { Id: string } }>(connection, "invoice", {
    method: "POST",
    body: JSON.stringify({
      CustomerRef: { value: customer.id, name: customer.name },
      TxnDate: invoice.invoice_date || new Date().toISOString().slice(0, 10),
      PrivateNote: `Created from MERAV Studio invoice ${invoice.id}`,
      Line: [
        {
          Description: invoice.file_name || "MERAV Studio invoice",
          Amount: roundMoney(paidTotal),
          DetailType: "SalesItemLineDetail",
          SalesItemLineDetail: {
            ItemRef: { value: itemId },
            Qty: 1,
            UnitPrice: roundMoney(paidTotal),
          },
        },
      ],
    }),
  });

  return data.Invoice.Id;
}

async function createQuickBooksPayment(
  connection: QuickBooksConnection,
  payment: { customerId: string; invoiceId: string; amount: number; note: string },
) {
  const data = await quickBooksApi<{ Payment: { Id: string } }>(connection, "payment", {
    method: "POST",
    body: JSON.stringify({
      CustomerRef: { value: payment.customerId },
      TotalAmt: roundMoney(payment.amount),
      PrivateNote: `MERAV Studio: ${payment.note}`,
      Line: [
        {
          Amount: roundMoney(payment.amount),
          LinkedTxn: [{ TxnId: payment.invoiceId, TxnType: "Invoice" }],
        },
      ],
    }),
  });

  return data.Payment.Id;
}

function emptyToNull(value?: string | null) {
  const clean = value?.trim();
  return clean ? clean : null;
}

function cleanQuickBooksName(value: string) {
  return value.trim().slice(0, 100) || "MERAV Studio Client";
}

function escapeQuickBooksQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
