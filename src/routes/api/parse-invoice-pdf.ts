import { createFileRoute } from "@tanstack/react-router";
import type { PDFParse } from "pdf-parse";
import pdfWorkerSource from "pdfjs-dist/legacy/build/pdf.worker.mjs?raw";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canViewFinancials } from "@/lib/permissions";

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
  const paidAmount = moneyValue(firstMatch(compact, /Paid:\s*\$?\s*([\d,]+(?:\.\d{2})?)/i)) ?? 0;
  const duePayments = Array.from(compact.matchAll(/^Due\s+(.+?):\s*\$?\s*([\d,]+(?:\.\d{2})?)/gim))
    .map((match, index) => ({
      label: `Due ${match[1].trim()}`,
      amount: moneyValue(match[2]) ?? 0,
      due_date: null as string | null,
      status: "due" as const,
      notes: null as string | null,
      sort_order: index + (paidAmount > 0 ? 1 : 0),
    }));
  const payments = paidAmount > 0
    ? [{
        label: "Previously Paid",
        amount: paidAmount,
        due_date: null as string | null,
        status: "paid" as const,
        notes: "Payment received before this invoice was uploaded (for example, Zelle or another external payment)." as string | null,
        sort_order: 0,
      }, ...duePayments]
    : duePayments;

  return {
    client_name: firstMatch(compact, /Client:\s*(.+?)(?:\s+SERVICE INVOICE|\n)/i),
    provider_name: firstMatch(compact, /Provider:\s*(.+?)(?:\n|$)/i),
    invoice_date: toIsoDate(firstMatch(compact, /Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)),
    total_amount: moneyValue(firstMatch(compact, /Total Design Fee:\s*\$?\s*([\d,]+(?:\.\d{2})?)/i)),
    paid_amount: paidAmount,
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

async function requireInvoiceAccess(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) return { error: json({ error: "Sign in as Ken or Katie to use invoice tools." }, 401) };

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) return { error: json({ error: "Your session is no longer valid." }, 401) };

  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("email,is_active")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!canViewFinancials(profile)) return { error: json({ error: "Only Ken and Katie can use invoice tools." }, 403) };

  return { user: userData.user };
}

function ensurePdfJsGlobals() {
  const globalScope = globalThis as typeof globalThis & {
    DOMMatrix?: typeof DOMMatrix;
    ImageData?: typeof ImageData;
    Path2D?: typeof Path2D;
  };

  if (!globalScope.DOMMatrix) {
    globalScope.DOMMatrix = class DOMMatrix {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;

      constructor(init?: number[] | string) {
        if (Array.isArray(init)) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init;
        }
      }

      multiplySelf() {
        return this;
      }

      preMultiplySelf() {
        return this;
      }

      translateSelf() {
        return this;
      }

      scaleSelf() {
        return this;
      }

      rotateSelf() {
        return this;
      }

      invertSelf() {
        return this;
      }

      transformPoint(point?: { x?: number; y?: number }) {
        return { x: point?.x ?? 0, y: point?.y ?? 0 };
      }
    } as typeof DOMMatrix;
  }

  if (!globalScope.ImageData) {
    globalScope.ImageData = class ImageData {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    } as typeof ImageData;
  }

  if (!globalScope.Path2D) {
    globalScope.Path2D = class Path2D {} as typeof Path2D;
  }
}

export const Route = createFileRoute("/api/parse-invoice-pdf")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parser: PDFParse | null = null;
        try {
          const access = await requireInvoiceAccess(request);
          if ("error" in access) return access.error;

          const { file_data_url, file_name } = (await request.json()) as {
            file_data_url?: string;
            file_name?: string;
          };
          if (!file_data_url) return json({ error: "Missing PDF upload." }, 400);

          const data = dataUrlToBuffer(file_data_url);
          ensurePdfJsGlobals();
          const { PDFParse } = await import("pdf-parse");
          PDFParse.setWorker(`data:text/javascript;base64,${Buffer.from(pdfWorkerSource).toString("base64")}`);
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
