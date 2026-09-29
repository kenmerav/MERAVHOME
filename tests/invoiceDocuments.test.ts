import { describe, expect, it } from "vitest";
import { applyInvoicePaymentLink } from "../src/lib/invoiceDocuments";

const stripeUrl = "https://buy.stripe.com/test_current_link";

describe("saved invoice payment links", () => {
  it("keeps the pay row and updates it to the current Stripe link", () => {
    const html = `
      <section class="pay">
        <div><a href="https://buy.stripe.com/test_old_link">CLICK HERE TO PAY</a></div>
        <div>$100.00</div>
      </section>
    `
      .replace('<section class="pay">', '<div class="pay">')
      .replace("</section>", "</div>");

    const result = applyInvoicePaymentLink(html, stripeUrl);

    expect(result).toContain(`href="${stripeUrl}"`);
    expect(result).toContain("CLICK HERE TO PAY");
    expect(result).not.toContain("test_old_link");
  });

  it("turns a plain pay label into a link when a current Stripe link exists", () => {
    const html = '<div class="pay"><div>CLICK HERE TO PAY</div><div>$100.00</div></div>';

    expect(applyInvoicePaymentLink(html, stripeUrl)).toContain(
      `<a href="${stripeUrl}">CLICK HERE TO PAY</a>`,
    );
  });

  it("removes the pay row when there is no currently-due Stripe link", () => {
    const html =
      '<div class="pay"><div><a href="https://buy.stripe.com/test_old_link">CLICK HERE TO PAY</a></div><div>$100.00</div></div>';

    const result = applyInvoicePaymentLink(html, null);

    expect(result).not.toContain("CLICK HERE TO PAY");
    expect(result).not.toContain("test_old_link");
  });
});
