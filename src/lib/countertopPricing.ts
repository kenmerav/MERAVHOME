type CountertopContext = {
  item_label?: string | null; client_product_name?: string | null;
  category?: string | null; product_url?: string | null;
  product?: { name?: string | null; category?: string | null; subcategory?: string | null; product_url?: string | null } | null;
};

export function isCountertopMaterial(item: CountertopContext) {
  const paths = [item.product_url, item.product?.product_url].flatMap(link => {
    try { return [decodeURIComponent(new URL(link || "").pathname).replace(/[-_]/g, " ")]; }
    catch { return []; }
  });
  const labels = [item.item_label, item.client_product_name, item.product?.name, item.product?.subcategory].filter(Boolean).join(" ");
  const signals = `${labels} ${paths.join(" ")}`;
  // A countertop faucet, sink or dispenser is still a purchased fixture.
  if (/\b(?:faucets?|sinks?|toilets?|dispensers?|knobs?|pulls?|handles?|hinges?|hardware|doors?|lamps?|sconces?|pendants?|chairs?|tables?)\b/i.test(signals)) return false;
  if ([item.category, item.product?.category].some(category => /^(?:counter\s*tops?|countertops?\s*&\s*slabs?)$/i.test(category?.trim() || ""))) return true;
  if (/\b(?:counter\s*tops?|vanity\s*tops?)\b/i.test(labels) || /\bcounter\s*$/i.test(item.item_label || "")) return true;
  if (paths.some(path => /(?:^|\/)[^/]*counter\s*tops?[^/]*(?:\/|$)|(?:^|\/)slabs?(?:\/|$)/i.test(path))) return true;
  return /\bslabs?\b/i.test(labels) && /\b(?:marble|granite|quartz|quartzite|soapstone|limestone|solid surface)\b/i.test(labels);
}
