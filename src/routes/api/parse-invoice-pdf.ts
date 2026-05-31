import { createFileRoute } from "@tanstack/react-router";
import { PDFParse } from "pdf-parse";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function moneyValue(value?: string | null) {
  if (!value) return null;
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function firstMatch(text: string, pattern: RegExp) {
  return text.match(pattern)?.[1]?.trim() ?? null;
}

function toIsoDate(value: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, mm, dd, yyyy] = match;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function parseInvoiceText(text: string) {
  const compact = text.replace(/\r/g, "");
  const payments = Array.from(compact.matchAll(/^Due\s+(.+?):\s*\$?\s*([\d,]+(?:\.\d{2})?)/gim))
    .map((match, index) => ({
      label: `Due ${match[1].trim()}`,
      amount: moneyValue(match[2]) ?? 0,
      due_date: null as string | null,
      status: "due" as const,
      notes: null as string | null,
      sort_order: index,
    }));

  return {
    client_name: firstMatch(compact, /Client:\s*(.+?)(?:\s+SERVICE INVOICE|\n)/i),
    provider_name: firstMatch(compact, /Provider:\s*(.+?)(?:\n|$)/i),
    invoice_date: toIsoDate(firstMatch(compact, /Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)),
    total_amount: moneyValue(firstMatch(compact, /Total Design Fee:\s*\$?\s*([\d,]+(?:\.\d{2})?)/i)),
    paid_amount: moneyValue(firstMatch(compact, /Paid:\s*\$?\s*([\d,]+(?:\.\d{2})?)/i)),
    balance_due: moneyValue(firstMatch(compact, /Design Fee Due:\s*\$?\s*([\d,]+(?:\.\d{2})?)/i)),
    payments,
    raw_text: compact.trim(),
  };
}

function dataUrlToBuffer(dataUrl: string) {
  const match = dataUrl.match(/^data:application\/pdf(?:;[^,]*)?,(.+)$/);
  if (!match) throw new Error("Upload a PDF file.");
  return Buffer.from(match[1], "base64");
}

export const Route = createFileRoute("/api/parse-invoice-pdf")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parser: PDFParse | null = null;
        try {
          const { file_data_url, file_name } = (await request.json()) as {
            file_data_url?: string;
            file_name?: string;
          };
          if (!file_data_url) return json({ error: "Missing PDF upload." }, 400);

          const data = dataUrlToBuffer(file_data_url);
          parser = new PDFParse({ data });
          const result = await parser.getText();
          const parsed = parseInvoiceText(result.text);

          return json({
            file_name: file_name ?? "Invoice.pdf",
            invoice: parsed,
          });
        } catch (e: any) {
          return json({ error: e?.message || "Could not parse invoice PDF." }, 500);
        } finally {
          await parser?.destroy();
        }
      },
    },
  },
});
