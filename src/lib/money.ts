export function moneyValue(value?: string | number | null) {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function procurementTotals(items: any[], taxRate: string | number = 0) {
  const money = items.reduce((sum, item) => {
    const product = item.room_product?.product;
    const material = item.material as { quantity?: number | null } | null;
    const qty = material?.quantity && material.quantity > 0 ? material.quantity : 1;
    return {
      client: sum.client + moneyValue(product?.price) * qty,
      cost: sum.cost + moneyValue(product?.unit_cost) * qty,
      shipping: sum.shipping + moneyValue(product?.shipping) * qty,
    };
  }, { client: 0, cost: 0, shipping: 0 });
  const tax = money.cost * ((Number(taxRate) || 0) / 100);
  return {
    ...money,
    tax,
    profit: money.client - money.cost - tax - money.shipping,
  };
}
