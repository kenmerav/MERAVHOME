/* eslint-disable @typescript-eslint/no-explicit-any -- New product coverage columns remain server-only until generated Supabase types include the migration. */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  packagingDocumentUrls,
  resolveCartonCoverage,
  resolveCartonCoverageTable,
  type CartonCoverageResult,
} from "@/lib/cartonCoverage";
import { cleanUuid } from "@/lib/ids";
import { isStudioTeamRole } from "@/lib/permissions";

const admin = supabaseAdmin as any;
const FIRECRAWL_API = "https://api.firecrawl.dev/v2/scrape";
const SCRAPE_TIMEOUT_MS = 40_000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function firstString(...values: unknown[]) {
  return (
    values
      .find((value): value is string => typeof value === "string" && value.trim().length > 0)
      ?.trim() ?? ""
  );
}

function normalizeHttpUrl(value: string, baseUrl: string) {
  if (!value) return "";
  try {
    const url = new URL(value.replace(/&amp;/g, "&"), baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

async function requireStudioTeam(request: Request) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: json({ error: "Sign in to scrape product coverage." }, 401) };
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    return { error: json({ error: "Your Studio session is no longer valid." }, 401) };
  }
  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("role,is_active")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.is_active || !isStudioTeamRole(profile.role)) {
    return {
      error: json({ error: "Product scraping is available to the Studio team only." }, 403),
    };
  }
  return { user: userData.user };
}

const coverageSchema = {
  type: "object",
  properties: {
    carton_coverage_sq_ft: {
      type: "number",
      description:
        "Total square feet contained in exactly one unopened box, carton, or case for the requested product size.",
    },
    carton_coverage_text: {
      type: "string",
      description: "Exact source line supporting the carton coverage number.",
    },
    coverage_matches_requested_variant: {
      type: "boolean",
      description:
        "True only when the source line clearly matches the requested product and exact size or SKU.",
    },
    packaging_document_url: {
      type: "string",
      description: "Absolute URL of a linked packaging or carton specification document.",
    },
  },
};

type ScrapedPage = {
  json?: Record<string, unknown>;
  extract?: Record<string, unknown>;
  markdown?: string;
  html?: string;
  metadata?: Record<string, unknown>;
};

async function scrapePage(input: {
  url: string;
  apiKey: string;
  productName: string;
  sku: string;
  size: string;
}) {
  const requestedDetails = [
    `Product: ${input.productName || "not supplied"}`,
    `SKU: ${input.sku || "not supplied"}`,
    `Exact size/dimensions: ${input.size || "not supplied"}`,
  ].join("\n");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);
  try {
    const response = await fetch(FIRECRAWL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        url: input.url,
        formats: [
          "markdown",
          "html",
          {
            type: "json",
            schema: coverageSchema,
            prompt: [
              "Find the total square footage contained in one unopened box, carton, or case for the requested product variant.",
              requestedDetails,
              "Do not use pieces per box, price per square foot, pallet coverage, the area of one tile, or coverage for another size.",
              "If the page lists multiple sizes and the exact requested size or SKU cannot be matched, leave carton_coverage_sq_ft empty and set coverage_matches_requested_variant to false.",
              "Return the exact supporting source line. Also return a linked packaging specification URL when the product page does not contain the number.",
            ].join("\n"),
          },
        ],
        onlyMainContent: false,
        timeout: SCRAPE_TIMEOUT_MS,
        waitFor: 1500,
        maxAge: 10 * 60 * 1000,
        location: { country: "US", languages: ["en-US"] },
        proxy: "auto",
      }),
    });
    if (!response.ok) throw new Error(`Coverage scrape failed (${response.status}).`);
    const body = (await response.json()) as Record<string, any>;
    return (body.data ?? body) as ScrapedPage;
  } finally {
    clearTimeout(timeout);
  }
}

function requestedDetailMatches(evidence: string, sku: string, size: string) {
  const normalizedEvidence = evidence.toLowerCase().replace(/\s+/g, " ");
  const normalizedSku = sku.toLowerCase().trim();
  if (normalizedSku && normalizedEvidence.includes(normalizedSku)) return true;
  const dimensionPattern =
    /(\d+(?:\.\d+)?)\s*(?:["'”’]|in(?:ch(?:es)?)?)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:["'”’]|in(?:ch(?:es)?)?)?/gi;
  const requestedDimensions = Array.from(size.matchAll(dimensionPattern)).map(
    (match) => `${Number(match[1])}x${Number(match[2])}`,
  );
  const evidenceDimensions = new Set(
    Array.from(evidence.matchAll(dimensionPattern)).map(
      (match) => `${Number(match[1])}x${Number(match[2])}`,
    ),
  );
  if (
    requestedDimensions.length > 0 &&
    requestedDimensions.some((dimension) => evidenceDimensions.has(dimension))
  ) {
    return true;
  }
  const normalizedSize = size.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalizedSize && normalizedEvidence.includes(normalizedSize)) return true;
  return !normalizedSku && !normalizedSize;
}

function coverageFromPage(page: ScrapedPage, sku: string, size: string): CartonCoverageResult {
  const extracted = page.json ?? page.extract ?? {};
  const evidence = firstString(
    extracted.carton_coverage_text,
    extracted.coverage_text,
    extracted.packaging_text,
  );
  const variantMatched =
    extracted.coverage_matches_requested_variant === true &&
    requestedDetailMatches(evidence, sku, size);
  if (variantMatched) {
    return resolveCartonCoverage({
      extractedSquareFeet: extracted.carton_coverage_sq_ft,
      extractedEvidence: evidence,
    });
  }

  const parsed = resolveCartonCoverage({ pageText: [page.markdown, page.html] });
  if (!sku && !size) return parsed;
  return {
    squareFeet: null,
    confidence: parsed.candidates.length ? "review" : "missing",
    evidence: evidence || parsed.evidence,
    candidates: parsed.candidates,
  };
}

export const Route = createFileRoute("/api/scrape-carton-coverage")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const access = await requireStudioTeam(request);
          if ("error" in access) return access.error;
          const body = (await request.json()) as {
            material_item_id?: string;
            size?: string;
          };
          const materialItemId = cleanUuid(body.material_item_id);
          if (!materialItemId) return json({ error: "Valid material_item_id required." }, 400);
          const { data: item, error: itemError } = await admin
            .from("material_items")
            .select(
              "id,color,product_url,product_id,product:products(id,name,sku,dimensions,finish,product_url,carton_coverage_sq_ft,carton_coverage_confidence)",
            )
            .eq("id", materialItemId)
            .maybeSingle();
          if (itemError) throw itemError;
          if (!item?.product_id || !item.product) {
            return json({ error: "Link this material to a catalog product before scraping." }, 400);
          }
          const sourceUrl = firstString(item.product_url, item.product.product_url);
          if (!/^https?:\/\//i.test(sourceUrl)) {
            return json({ error: "Add a valid product URL before scraping carton coverage." }, 400);
          }
          const apiKey = process.env.FIRECRAWL_API_KEY;
          if (!apiKey) return json({ error: "Firecrawl is not connected yet." }, 500);
          const productName = firstString(item.product.name);
          const sku = firstString(item.product.sku);
          const size = firstString(body.size, item.product.dimensions);
          const color = firstString(item.color, item.product.finish);

          const productPage = await scrapePage({
            url: sourceUrl,
            apiKey,
            productName,
            sku,
            size,
          });
          let result = coverageFromPage(productPage, sku, size);
          let resultSourceUrl = sourceUrl;
          const extracted = productPage.json ?? productPage.extract ?? {};
          const linkedUrls = [
            normalizeHttpUrl(firstString(extracted.packaging_document_url), sourceUrl),
            ...packagingDocumentUrls(sourceUrl, productPage.markdown, productPage.html),
          ].filter((value, index, values) => value && values.indexOf(value) === index);

          if (result.confidence !== "exact" && linkedUrls.length) {
            const packagingUrl = linkedUrls[0];
            const packagingPage = await scrapePage({
              url: packagingUrl,
              apiKey,
              productName,
              sku,
              size,
            });
            const tableResult = resolveCartonCoverageTable({
              html: packagingPage.html,
              sourceUrl: packagingUrl,
              productName,
              sku,
              size,
              color,
            });
            const packagingResult =
              tableResult.confidence === "exact"
                ? tableResult
                : coverageFromPage(packagingPage, sku, size);
            if (
              packagingResult.confidence === "exact" ||
              packagingResult.candidates.length > result.candidates.length
            ) {
              result = packagingResult;
              resultSourceUrl = packagingUrl;
            }
          }

          const now = new Date().toISOString();
          const productPatch: Record<string, unknown> = {
            carton_coverage_confidence: result.confidence,
            carton_coverage_scraped_at: now,
          };
          if (result.confidence === "exact" && result.squareFeet !== null) {
            productPatch.carton_coverage_sq_ft = result.squareFeet;
            productPatch.carton_coverage_source_url = resultSourceUrl;
            productPatch.carton_coverage_source_text = result.evidence;
          } else if (!item.product.carton_coverage_sq_ft) {
            productPatch.carton_coverage_source_url = resultSourceUrl;
            productPatch.carton_coverage_source_text = result.evidence;
          }
          const { error: productError } = await admin
            .from("products")
            .update(productPatch)
            .eq("id", item.product_id);
          if (productError) throw productError;

          return json({
            carton_coverage_sq_ft: result.squareFeet,
            confidence: result.confidence,
            source_url: resultSourceUrl,
            evidence: result.evidence,
            candidates: result.candidates,
            scraped_at: now,
            message:
              result.confidence === "exact"
                ? `Found ${result.squareFeet} sq ft per carton.`
                : result.confidence === "review"
                  ? "The page showed multiple carton coverage values. Confirm the exact product size manually."
                  : "No reliable carton coverage was found. Enter it manually from the manufacturer packaging details.",
          });
        } catch (error) {
          console.error("[Carton Coverage] Scrape failed", error);
          return json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Could not scrape carton coverage. Enter it manually.",
            },
            500,
          );
        }
      },
    },
  },
});
