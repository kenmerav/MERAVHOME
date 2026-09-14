// Build Carts grants site access only for online products in the frozen run.
export function retailerOrigins(source) {
  const origins = new Set();
  for (const item of source.ready_products || []) {
    if (item.procurement_method === "email_rep") continue;
    try {
      const url = new URL(item.exact_product_url);
      if (url.protocol !== "https:" || url.username || url.password || url.port) continue;
      origins.add(url.origin);
      // Retailers commonly redirect between their bare host and www host.
      const host = url.hostname.replace(/^www\./, "");
      origins.add(`https://${host}`);
      origins.add(`https://www.${host}`);
    } catch {
      /* Invalid links confer no browser permission. */
    }
  }
  return origins;
}

export function approvedRunRequest(request, run, now = Date.now()) {
  const p = request.params;
  if (
    !run.authorizeRetailerSites ||
    run.cancelRequested ||
    now >= run.expiresAt ||
    p?.threadId !== run.threadId ||
    request.method !== "mcpServer/elicitation/request" ||
    !["form", "openai/form", "openaiForm"].includes(p.mode)
  )
    return null;
  // Only a yes/no permission prompt, never a form asking for additional data.
  const schema = p.requestedSchema;
  if (
    schema?.type !== "object" ||
    Object.keys(schema.properties || {}).length ||
    (schema.required || []).length
  )
    return null;
  if (p.serverName === "cua_repl") {
    const match = /^Allow Browser use to access (https:\/\/[^\s/?#]+)\?$/.exec(p.message || "");
    if (match && run.retailerOrigins.has(match[1]))
      return `Retailer access included in Build Carts: ${match[1]}`;
  }
  if (
    p.serverName === "merav-cart-builder" &&
    p.message === 'Allow the merav-cart-builder MCP server to run tool "complete_procurement_run"?'
  )
    return "Saving the completed cart run in Studio.";
  return null;
}
