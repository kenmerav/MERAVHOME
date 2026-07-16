import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BATCH_SIZE = 6;
const FINISH_CHECK_MIGRATION = "20260715173000_add_material_finish_checks.sql";

type FinishCheckStatus = "match" | "possible_mismatch" | "uncertain";

type FinishAnalysis = {
  image_finish: string;
  confidence: number;
  status: FinishCheckStatus;
  reason: string;
};

type MaterialFinishCandidate = {
  id: string;
  item_label: string;
  category: string | null;
  cad_label: string | null;
  color: string | null;
  image_url: string | null;
  finish_check_status: string | null;
  finish_check_image_url: string | null;
  finish_check_product_finish: string | null;
  product: {
    name: string;
    finish: string | null;
    vendor: string | null;
  } | null;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isMissingFinishCheckSchema(error: unknown) {
  const candidate = error as { code?: string; message?: string } | null;
  return (
    candidate?.code === "42703" ||
    /finish_check_(status|image_finish|product_finish|image_url|confidence|reason)/i.test(
      candidate?.message ?? "",
    )
  );
}

async function requireStudioUser(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!token) return { error: json({ error: "Sign in to check material finishes." }, 401) };

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) {
    return { error: json({ error: "Your session is no longer valid." }, 401) };
  }

  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("role,is_active")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!profile?.is_active || !["Admin", "Employee"].includes(String(profile.role))) {
    return { error: json({ error: "Only MERAV team members can check finishes." }, 403) };
  }

  return { user: userData.user };
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function claimedFinish(item: MaterialFinishCandidate) {
  const values = [cleanText(item.color), cleanText(item.product?.finish)].filter(Boolean);
  return Array.from(new Set(values.map((value) => value.toLowerCase())))
    .map((value) => values.find((candidate) => candidate.toLowerCase() === value)!)
    .join(" / ");
}

function isPublicImageUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function currentResult(item: MaterialFinishCandidate, productFinish: string) {
  return (
    item.finish_check_status &&
    item.finish_check_status !== "unchecked" &&
    item.finish_check_image_url === item.image_url &&
    item.finish_check_product_finish === productFinish
  );
}

function outputText(response: unknown) {
  const candidate = response as {
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  for (const output of candidate.output ?? []) {
    for (const content of output?.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return "";
}

function safeAnalysis(value: unknown): FinishAnalysis {
  const candidate = value as Partial<FinishAnalysis> | null;
  const imageFinish = cleanText(candidate?.image_finish) || "Unclear";
  const confidence = Math.max(0, Math.min(1, Number(candidate?.confidence) || 0));
  const proposedStatus = candidate?.status;
  const status: FinishCheckStatus =
    confidence < 0.72 || /^unclear$/i.test(imageFinish) || proposedStatus === "uncertain"
      ? "uncertain"
      : proposedStatus === "possible_mismatch"
        ? "possible_mismatch"
        : "match";

  return {
    image_finish: imageFinish,
    confidence,
    status,
    reason: cleanText(candidate?.reason).slice(0, 240) || "Finish comparison completed.",
  };
}

async function analyzeFinish(item: MaterialFinishCandidate, productFinish: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_FINISH_CHECK_MODEL || "gpt-5.4-mini",
      store: false,
      max_output_tokens: 350,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Compare the visible finish of the main product in this design-board image with the product information below.

Product: ${item.product?.name || item.item_label}
Vendor: ${item.product?.vendor || "Not provided"}
Item label: ${item.item_label}
CAD label: ${item.cad_label || "Not provided"}
Category: ${item.category || "Not provided"}
Product information finish: ${productFinish}

Classify metal finishes into practical families such as silver/chrome/polished nickel, brass/gold, bronze, black, copper/rose gold, or white. For tile, stone, wood, fabric, and paint, compare the plainly visible color and finish instead.

Focus only on the main product indicated by the item label. Ignore the background, nearby objects, lighting warmth, reflections, shadows, and styling. If the relevant object is too small, obscured, color-shifted, or ambiguous, return uncertain. Only return possible_mismatch when the visible finish is clear with at least 0.72 confidence and belongs to a genuinely different finish family. Never infer that the product data should be changed; this is a review warning only.`,
            },
            {
              type: "input_image",
              image_url: item.image_url,
              detail: "high",
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "material_finish_check",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              image_finish: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              status: {
                type: "string",
                enum: ["match", "possible_mismatch", "uncertain"],
              },
              reason: { type: "string" },
            },
            required: ["image_finish", "confidence", "status", "reason"],
          },
        },
      },
    }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || `OpenAI finish check failed (${response.status}).`);
  }

  const text = outputText(body);
  if (!text) throw new Error("OpenAI did not return a finish comparison.");
  return safeAnalysis(JSON.parse(text));
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  run: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await run(values[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

export const Route = createFileRoute("/api/check-material-finishes")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const access = await requireStudioUser(request);
          if ("error" in access) return access.error;

          const body = (await request.json()) as {
            project_id?: string;
            exclude_material_item_ids?: string[];
          };
          if (!body.project_id) return json({ error: "project_id is required." }, 400);

          const probe = await supabaseAdmin
            .from("material_items")
            .select("id,finish_check_status")
            .eq("project_id", body.project_id)
            .limit(1);
          if (probe.error) {
            if (isMissingFinishCheckSchema(probe.error)) {
              return json(
                {
                  error: `Apply ${FINISH_CHECK_MIGRATION} in Supabase before checking finishes.`,
                  migration_required: true,
                },
                409,
              );
            }
            throw probe.error;
          }

          const { data, error } = await supabaseAdmin
            .from("material_items")
            .select(
              "id,item_label,category,cad_label,color,image_url,finish_check_status,finish_check_image_url,finish_check_product_finish,product:products(name,finish,vendor)",
            )
            .eq("project_id", body.project_id)
            .eq("not_needed", false)
            .not("product_id", "is", null)
            .order("sort_order")
            .order("created_at");
          if (error) throw error;

          const excluded = new Set(body.exclude_material_item_ids ?? []);
          const allCandidates = ((data ?? []) as unknown as MaterialFinishCandidate[]).filter(
            (item) => {
              const productFinish = claimedFinish(item);
              return (
                !excluded.has(item.id) &&
                Boolean(productFinish) &&
                Boolean(item.image_url && isPublicImageUrl(item.image_url)) &&
                !currentResult(item, productFinish)
              );
            },
          );
          const batch = allCandidates.slice(0, BATCH_SIZE);

          const results = await mapWithConcurrency(batch, 2, async (item) => {
            const productFinish = claimedFinish(item);
            let analysis: FinishAnalysis;
            try {
              analysis = await analyzeFinish(item, productFinish);
            } catch (error) {
              return {
                material_item_id: item.id,
                item_label: item.item_label,
                product_finish: productFinish,
                image_finish: null,
                confidence: 0,
                status: "error" as const,
                reason:
                  error instanceof Error ? error.message.slice(0, 240) : "Finish check failed.",
              };
            }

            const checkedAt = new Date().toISOString();
            const { error: updateError } = await supabaseAdmin
              .from("material_items")
              .update({
                finish_check_status: analysis.status,
                finish_check_image_finish: analysis.image_finish,
                finish_check_product_finish: productFinish,
                finish_check_image_url: item.image_url,
                finish_check_confidence: analysis.confidence,
                finish_check_reason: analysis.reason,
                finish_checked_at: checkedAt,
              })
              .eq("id", item.id)
              .eq("project_id", body.project_id);
            if (updateError) throw updateError;

            return {
              material_item_id: item.id,
              item_label: item.item_label,
              product_finish: productFinish,
              image_finish: analysis.image_finish,
              confidence: analysis.confidence,
              status: analysis.status,
              reason: analysis.reason,
            };
          });

          return json({
            rows: results,
            checked_count: results.length,
            remaining_count: Math.max(0, allCandidates.length - batch.length),
            skipped_count: Math.max(0, (data?.length ?? 0) - allCandidates.length),
          });
        } catch (error) {
          if (isMissingFinishCheckSchema(error)) {
            return json(
              {
                error: `Apply ${FINISH_CHECK_MIGRATION} in Supabase before checking finishes.`,
                migration_required: true,
              },
              409,
            );
          }
          return json(
            { error: error instanceof Error ? error.message : "Finish check failed." },
            500,
          );
        }
      },
    },
  },
});
