export type FinancialAdjustmentType = "credit" | "charge";
export type FinancialAdjustmentStatus =
  | "open"
  | "refunded"
  | "applied"
  | "paid"
  | "waived"
  | "void";

type PaymentLike = {
  amount?: number | null;
  status?: string | null;
};

type AdjustmentLike = {
  adjustment_type: FinancialAdjustmentType;
  amount?: number | null;
  status: FinancialAdjustmentStatus;
};

type InvoiceLedgerInput = {
  total_amount?: number | null;
  paid_amount?: number | null;
  payments?: PaymentLike[] | null;
  adjustments?: AdjustmentLike[] | null;
};

export function financialInvoiceLedger(invoice: InvoiceLedgerInput) {
  const payments = invoice.payments ?? [];
  const adjustments = invoice.adjustments ?? [];
  const paymentTotal = roundMoney(
    payments.reduce((sum, payment) => sum + money(payment.amount), 0),
  );
  const originalTotal = paymentTotal > 0 ? paymentTotal : money(invoice.total_amount);
  const originalPaid = roundMoney(
    payments.length
      ? payments
          .filter((payment) => payment.status === "paid")
          .reduce((sum, payment) => sum + money(payment.amount), 0)
      : money(invoice.paid_amount),
  );

  const activeCredits = adjustments.filter(
    (adjustment) => adjustment.adjustment_type === "credit" && adjustment.status !== "void",
  );
  const activeCharges = adjustments.filter(
    (adjustment) =>
      adjustment.adjustment_type === "charge" &&
      adjustment.status !== "waived" &&
      adjustment.status !== "void",
  );
  const creditTotal = roundMoney(
    activeCredits.reduce((sum, adjustment) => sum + money(adjustment.amount), 0),
  );
  const chargeTotal = roundMoney(
    activeCharges.reduce((sum, adjustment) => sum + money(adjustment.amount), 0),
  );
  const paidCharges = roundMoney(
    activeCharges
      .filter((adjustment) => adjustment.status === "paid")
      .reduce((sum, adjustment) => sum + money(adjustment.amount), 0),
  );
  const refundedTotal = roundMoney(
    activeCredits
      .filter((adjustment) => adjustment.status === "refunded")
      .reduce((sum, adjustment) => sum + money(adjustment.amount), 0),
  );
  const appliedTotal = roundMoney(
    activeCredits
      .filter((adjustment) => adjustment.status === "applied")
      .reduce((sum, adjustment) => sum + money(adjustment.amount), 0),
  );

  const adjustedTotal = roundMoney(Math.max(originalTotal + chargeTotal - creditTotal, 0));
  const grossPaid = roundMoney(originalPaid + paidCharges);
  const netPaid = roundMoney(Math.max(grossPaid - refundedTotal - appliedTotal, 0));

  return {
    originalTotal,
    adjustedTotal,
    originalPaid,
    grossPaid,
    netPaid,
    creditTotal,
    chargeTotal,
    refundedTotal,
    appliedTotal,
    balanceDue: roundMoney(Math.max(adjustedTotal - netPaid, 0)),
    creditOwed: roundMoney(Math.max(netPaid - adjustedTotal, 0)),
  };
}

function money(value?: number | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
