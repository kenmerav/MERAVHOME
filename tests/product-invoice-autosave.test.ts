import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(), success: vi.fn(), error: vi.fn(),
}));
vi.mock("react", async (load) => ({
  ...await load<any>(),
  useState: (initial: any) => [typeof initial === "function" ? initial() : initial, vi.fn()],
  useMemo: (fn: any) => fn(), useEffect: () => {}, useRef: (initial: any) => ({ current: initial }),
}));
vi.mock("@/lib/db", () => ({ db: { createFinancialInvoice: mocks.create } }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { ProductInvoiceCreator } from "@/components/ProductInvoiceCreator";

let printWindow: any;
let openWindow: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ id: "saved-invoice" });
  printWindow = {
    closed: false, opener: {}, close: vi.fn(), focus: vi.fn(), print: vi.fn(),
    document: { body: { textContent: "" }, open: vi.fn(), write: vi.fn(), close: vi.fn(), title: "" },
    setTimeout: vi.fn(),
  };
  openWindow = vi.fn(() => printWindow);
  vi.stubGlobal("window", { open: openWindow });
});
afterEach(() => vi.unstubAllGlobals());

function findButton(node: any, label: string): any {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.map((child) => findButton(child, label)).find(Boolean);
  const children = node.props?.children;
  if (node.type === "button" && JSON.stringify(children).includes(label)) return node;
  return findButton(children, label);
}
function editor() {
  const onSaved = vi.fn();
  const tree = ProductInvoiceCreator({
    projectId: "project-a", projectName: "Bella Vista", clientName: "Kip", defaultTaxRate: "8",
    items: [{ id: "material-a", material: {
      client_product_name: "Bathroom sink", category: "Plumbing", quantity: 2, quantity_unit: "count",
      image_url: null, color: "White", product_url: null, cad_label: null, notes: null,
    }, room_product: { product: {
      id: "product-a", name: "Sink", category: "Plumbing", price: "250", unit_cost: "150",
      shipping: "10", image_url: null, vendor: "Vendor", finish: "White", dimensions: null,
      sku: null, product_url: null,
    }, room: { id: "room-a", name: "Bathroom" } } }], onSaved,
  });
  return { onSaved, download: findButton(tree, "Save & Download / Print PDF").props.onClick,
    save: findButton(tree, "Save Invoice").props.onClick };
}

it("saves the exact preview and payment totals before opening the printable invoice", async () => {
  let finish: any;
  mocks.create.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const form = editor();
  const pending = form.download();
  expect(openWindow).toHaveBeenCalledWith("", "_blank");
  expect(printWindow.document.write).not.toHaveBeenCalled();
  expect(form.onSaved).not.toHaveBeenCalled();
  finish({ id: "saved-invoice" });
  await pending;
  const [invoice, payments] = mocks.create.mock.calls[0];
  expect(invoice).toMatchObject({ project_id: "project-a", total_amount: 560, balance_due: 560 });
  expect(payments[0]).toMatchObject({ project_id: "project-a", amount: 560 });
  const printedHtml = printWindow.document.write.mock.calls[0][0];
  expect(printedHtml).toBe(decodeURIComponent(invoice.pdf_data_url.split(",")[1]));
  expect(printedHtml).toContain("Bathroom sink");
  expect(form.onSaved).toHaveBeenCalledTimes(1);
  printWindow.setTimeout.mock.calls[0][0]();
  expect(printWindow.print).toHaveBeenCalledOnce();
});
it("ignores repeated download and Save clicks while the same invoice is saving", async () => {
  let finish: any;
  mocks.create.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const form = editor();
  const first = form.download();
  await form.download(); await form.save();
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(openWindow).toHaveBeenCalledTimes(1);
  finish({ id: "saved-invoice" }); await first;
});
it.each(["rejected", "missing"])("keeps the draft and prevents printing when persistence is %s", async (failure) => {
  if (failure === "rejected") mocks.create.mockRejectedValue(new Error("Save failed"));
  else mocks.create.mockResolvedValue(null);
  const form = editor(); await form.download();
  expect(printWindow.close).toHaveBeenCalledOnce();
  expect(printWindow.document.write).not.toHaveBeenCalled();
  expect(form.onSaved).not.toHaveBeenCalled();
  expect(mocks.success).not.toHaveBeenCalled();
  expect(mocks.error).toHaveBeenCalledOnce();
  mocks.create.mockResolvedValue({ id: "retry-saved" });
  await form.save();
  expect(form.onSaved).toHaveBeenCalledOnce();
});
it("does not create an invoice when a popup is blocked", async () => {
  openWindow.mockReturnValue(null);
  const form = editor(); await form.download();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.error.mock.calls[0][0]).toContain("Allow popups");
});
it("keeps a successfully saved invoice when the print window is closed", async () => {
  printWindow.closed = true;
  const form = editor(); await form.download();
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(form.onSaved).toHaveBeenCalledOnce();
  expect(mocks.error.mock.calls[0][0]).toContain("Invoice saved");
});
it("still supports Save Invoice without a download window", async () => {
  const form = editor(); await form.save();
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(form.onSaved).toHaveBeenCalledOnce();
  expect(openWindow).not.toHaveBeenCalled();
});
