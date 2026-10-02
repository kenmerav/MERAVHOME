// Offline visual fixture using the actual project invoice renderer and payment helper.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import http from "node:http";

const root = process.cwd();
const formatMoney = value => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const helper = fs.readFileSync(path.join(root, "src/lib/serviceInvoicePayments.ts"), "utf8")
  .replace('import { formatMoney } from "@/lib/money";', "");
const helperContext = { formatMoney, exports: {} };
vm.runInNewContext(ts.transpileModule(helper, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, helperContext);
const { renderServiceInvoicePayments } = helperContext.exports;
const templateSource = fs.readFileSync(path.join(root, "src/lib/serviceInvoiceTemplate.ts"), "utf8")
  .replace(/^import .*;\n/gm, "");
const templateContext = { formatMoney, renderServiceInvoicePayments, URL, exports: {}, window: { location: { origin: "http://127.0.0.1:4337" } } };
vm.runInNewContext(ts.transpileModule(templateSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, templateContext);
const { buildServiceInvoiceTemplate } = templateContext.exports;
const source = fs.readFileSync(path.join(root, "src/routes/projects.$id.financials.tsx"), "utf8");
const functions = source.slice(source.indexOf("function numberValue("), source.indexOf("function invoicePdfFileName("));
const executable = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const context = { formatMoney, buildServiceInvoiceTemplate };
vm.runInNewContext(executable, context);
const draft = {
  projectName: "Sample Phase Review", clientName: "Sample Client", projectAddress: "123 Sample Lane, Scottsdale, Arizona",
  invoiceDate: "2026-10-02", serviceType: "Full Service", projectType: "Renovation",
  squareFeet: "2000", renovationRate: "4", furnitureRate: "0", paid: "",
  roomSelectionsRenovation: ["Full Space"], roomSelectionsFurniture: ["Full Space"],
  servicesRenovation: ["Conceptual design planning", "Drafting elevations", "Digital renderings", "Space planning", "Presentations", "Sourcing all Fixtures + Finishes"],
  servicesFurniture: ["Conceptual design planning", "Drafting elevations", "Digital renderings", "Space planning", "Sourcing furniture + fixtures", "Presentations", "Ordering", "Managing installation"], otherRoomRenovation: "", otherRoomFurniture: "",
  otherServiceRenovation: "", otherServiceFurniture: "", location: "Full Home", description: "Design services",
  currentPhase: "Project Start", stripeLink: "https://buy.stripe.com/test_old",
  phases: [
    { name: "Project Start", percent: "50" }, { name: "Design Presentation", percent: "25" },
    { name: "Design Document Delivery", percent: "20" }, { name: "Project Completion", percent: "5" },
  ],
};
const payments = [
  { label: "Phase 1 - Project Start", amount: 4000, status: "paid", notes: draft.stripeLink, sort_order: 0 },
  { label: "Phase 2 - Design Presentation", amount: 2000, status: "paid", notes: "https://buy.stripe.com/test_presentation", sort_order: 1 },
  { label: "Phase 3 - Design Document Delivery", amount: 1600, status: "due", notes: "https://buy.stripe.com/test_documents", sort_order: 2 },
  { label: "Phase 4 - Project Completion", amount: 400, status: "not_due", notes: null, sort_order: 3 },
];
const html = context.buildServiceInvoiceHtml(draft, 8000, payments, { paidAmount: 6000, balanceDue: 2000 });
if (html.includes("test_old") || !html.includes("<s>$4,000.00</s>") || !html.includes('href="https://buy.stripe.com/test_documents"') || html.includes("<small>Paid</small>")) {
  throw new Error("Actual invoice renderer failed the phase/link fixture");
}
const dir = path.join(root, "tmp/pdfs");
fs.mkdirSync(dir, { recursive: true });
const output = path.join(dir, "service-invoice-paid-phase.html");
fs.writeFileSync(output, html);
console.log(output);
if (process.argv.includes("--serve")) {
  const assets = new Set(["PlayfairDisplay.ttf", "PlayfairDisplay-Italic.ttf", "merav-submark.png", "OFL.txt"]);
  http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1:4337").pathname;
    const name = pathname.split("/").pop();
    const file = pathname === "/" ? output
      : pathname === `/invoice-assets/v1/${name}` && assets.has(name)
        ? path.join(root, "public/invoice-assets/v1", name) : null;
    if (!file) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html" : file.endsWith(".png") ? "image/png" : file.endsWith(".ttf") ? "font/ttf" : "text/plain" });
    response.end(fs.readFileSync(file));
  }).listen(4337, "127.0.0.1", () => console.log("Local sample: http://127.0.0.1:4337"));
}
