import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buildProcurementEmailDrafts,
  calculateProcurementOrderQuantity,
  KEN_PROCUREMENT_EMAIL,
  PROCUREMENT_AGENT_UPDATE_STATUSES,
  itemStatusLabel,
  type ProcurementItemStatus,
} from "@/lib/procurementCart";
import { createRetailerDraftForAuthorizedRun } from "@/lib/procurementEmail.server";
import {
  authorizeProcurementRun,
  completeAuthorizedProcurementRun,
  updateAuthorizedProcurementItem,
} from "@/lib/procurementRuns.server";

const SAFETY_RULES = [
  "Use @Chrome because retailer sessions live in the user's regular Chrome browser.",
  "Open only the exact product URL supplied by Studio.",
  "Verify product name and SKU, then exact requested options and quantity before adding.",
  "Never guess an ambiguous option or accept a substitution unless Studio explicitly authorized it.",
  "Never click Buy Now, begin checkout, submit/place an order, or enter/select payment information.",
  "Never bypass a CAPTCHA or ask the user for a password; pause for the user to sign in.",
  `For Email rep items, use only Studio's create_retailer_draft tool. It creates a reviewable draft in ${KEN_PROCUREMENT_EMAIL} and has no Send operation.`,
  "Adding to a cart never authorizes purchasing.",
] as const;

type ProcurementMcpServices = {
  authorizeRun: typeof authorizeProcurementRun;
  updateItem: typeof updateAuthorizedProcurementItem;
  completeRun: typeof completeAuthorizedProcurementRun;
  createRetailerDraft: typeof createRetailerDraftForAuthorizedRun;
};

const defaultServices: ProcurementMcpServices = {
  authorizeRun: authorizeProcurementRun,
  updateItem: updateAuthorizedProcurementItem,
  completeRun: completeAuthorizedProcurementRun,
  createRetailerDraft: createRetailerDraftForAuthorizedRun,
};

export function createMeravCartMcpServer(services: ProcurementMcpServices = defaultServices) {
  const server = new McpServer(
    { name: "merav-cart-builder", version: "0.2.0" },
    {
      instructions: `Retrieve one token-scoped Merav cart run, use @Chrome for online retailers, use Studio's draft-only tool for representative emails, and update Studio after every item. The email tool can create a draft in ${KEN_PROCUREMENT_EMAIL} but exposes no Send operation. Never guess options, accept unauthorized substitutions, bypass CAPTCHA, begin checkout, enter payment, or place an order.`,
    },
  );

  server.registerTool(
    "get_procurement_run",
    {
      title: "Get procurement run",
      description:
        "Retrieve the exact products, frozen purchasing requirements, and any manual retailer email drafts for one authorized Merav Studio cart run.",
      inputSchema: {
        run_authorization: z
          .string()
          .min(32)
          .describe("Short-lived run authorization copied from Merav Studio."),
      },
      outputSchema: {
        run: z.record(z.unknown()),
        manual_email_drafts: z.array(z.record(z.unknown())),
        safety_rules: z.array(z.string()),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ run_authorization }) => {
      const run = await services.authorizeRun(run_authorization);
      const readyProducts = run.items.map((item) => {
        const orderQuantity = calculateProcurementOrderQuantity({
          quantity: item.requested_quantity,
          quantityUnit: item.requested_options.quantity_unit ?? "pieces",
          cartonCoverageSquareFeet: item.requested_options.carton_coverage_sq_ft,
          wastePercentage: item.requested_options.waste_percentage,
        });
        return {
          run_item_id: item.id,
          spec_book_item_id: item.spec_book_item_id,
          room: item.room_name,
          product_name: item.product_name,
          vendor: item.vendor,
          retailer_domain: item.retailer_domain,
          exact_product_url: item.product_url,
          sku: item.sku,
          quantity: item.requested_quantity,
          quantity_unit: item.requested_options.quantity_unit ?? "pieces",
          cart_quantity: orderQuantity.quantity,
          cart_quantity_unit: orderQuantity.unit,
          requested_options: item.requested_options,
          procurement_method: item.requested_options.procurement_method ?? "online_cart",
          rep_email: item.requested_options.rep_email ?? null,
          expected_unit_price: item.expected_price,
          product_image_url: item.product_image_url,
          notes: item.source_notes,
          current_status: item.status,
          current_status_label: itemStatusLabel(item.status),
        };
      });
      const vendors = Array.from(
        new Set(readyProducts.map((item) => item.retailer_domain).filter(Boolean)),
      );
      const manualEmailDrafts = buildProcurementEmailDrafts(run.project_name, run.items);
      const structuredContent = {
        run: {
          run_id: run.id,
          project_id: run.project_id,
          project_name: run.project_name,
          status: run.status,
          expires_at: run.expires_at,
          product_count: readyProducts.length,
          vendor_count: vendors.length,
          vendors,
          ready_products: readyProducts,
        },
        manual_email_drafts: manualEmailDrafts,
        safety_rules: [...SAFETY_RULES],
      };
      return {
        structuredContent,
        content: [
          {
            type: "text",
            text: `Retrieved ${readyProducts.length} products across ${vendors.length} retailers for ${run.project_name}.${manualEmailDrafts.length ? ` Prepared ${manualEmailDrafts.length} manual retailer email draft.` : ""}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "create_retailer_draft",
    {
      title: "Create retailer email draft",
      description:
        "Create one exact Studio-frozen retailer email as a Gmail draft in Ken's connected procurement account. The tool accepts only the run authorization and Studio draft key; it has no Send capability.",
      inputSchema: {
        run_authorization: z.string().min(32),
        draft_key: z.string().min(3).max(500),
      },
      outputSchema: {
        draft_id: z.string(),
        thread_id: z.string().nullable(),
        draft_key: z.string(),
        recipient: z.string().email(),
        subject: z.string(),
        account_email: z.literal(KEN_PROCUREMENT_EMAIL),
        run_item_ids: z.array(z.string().uuid()),
        created_at: z.string(),
        already_existed: z.boolean(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async ({ run_authorization, draft_key }) => {
      const structuredContent = await services.createRetailerDraft({
        runAuthorization: run_authorization,
        draftKey: draft_key,
      });
      return {
        structuredContent,
        content: [
          {
            type: "text",
            text: `Created a reviewable draft to ${structuredContent.recipient} in ${structuredContent.account_email}. Studio has marked ${structuredContent.run_item_ids.length} item(s) Drafted. No email was sent.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "update_procurement_item",
    {
      title: "Update procurement item",
      description:
        "Record the current retailer result for one product in the authorized cart run. This cannot edit the original Spec Book product.",
      inputSchema: {
        run_authorization: z.string().min(32),
        run_item_id: z.string().uuid(),
        status: z.enum(PROCUREMENT_AGENT_UPDATE_STATUSES),
        observed_product_title: z.string().max(500).optional().nullable(),
        observed_options: z.record(z.unknown()).optional().default({}),
        observed_price: z.number().nonnegative().optional().nullable(),
        observed_stock_status: z.string().max(240).optional().nullable(),
        cart_url: z.string().url().optional().nullable(),
        result_notes: z.string().max(2000).optional().nullable(),
      },
      outputSchema: {
        item: z.record(z.unknown()),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({
      run_authorization,
      run_item_id,
      status,
      observed_product_title,
      observed_options,
      observed_price,
      observed_stock_status,
      cart_url,
      result_notes,
    }) => {
      const item = await services.updateItem({
        runAuthorization: run_authorization,
        runItemId: run_item_id,
        status: status as ProcurementItemStatus,
        observedProductTitle: observed_product_title,
        observedOptions: observed_options,
        observedPrice: observed_price,
        observedStockStatus: observed_stock_status,
        cartUrl: cart_url,
        resultNotes: result_notes,
      });
      const structuredContent = { item };
      return {
        structuredContent,
        content: [
          {
            type: "text",
            text: `Updated ${item.product_name} to ${itemStatusLabel(item.status)}.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "complete_procurement_run",
    {
      title: "Complete procurement run",
      description:
        "Finish the authorized cart run, summarize outcomes, and immediately revoke its short-lived access.",
      inputSchema: {
        run_authorization: z.string().min(32),
      },
      outputSchema: {
        run_id: z.string().uuid(),
        status: z.literal("completed"),
        added: z.number().int().nonnegative(),
        needs_review: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        drafted: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ run_authorization }) => {
      const structuredContent = await services.completeRun(run_authorization);
      return {
        structuredContent,
        content: [
          {
            type: "text",
            text: `Completed run ${structuredContent.run_id}: ${structuredContent.added} added, ${structuredContent.drafted} drafted, ${structuredContent.needs_review} need review, ${structuredContent.failed} failed, ${structuredContent.skipped} skipped.`,
          },
        ],
      };
    },
  );

  return server;
}
