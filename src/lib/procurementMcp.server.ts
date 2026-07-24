import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  PROCUREMENT_ITEM_STATUSES,
  itemStatusLabel,
  type ProcurementItemStatus,
} from "@/lib/procurementCart";
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
  "Adding to a cart never authorizes purchasing.",
] as const;

type ProcurementMcpServices = {
  authorizeRun: typeof authorizeProcurementRun;
  updateItem: typeof updateAuthorizedProcurementItem;
  completeRun: typeof completeAuthorizedProcurementRun;
};

const defaultServices: ProcurementMcpServices = {
  authorizeRun: authorizeProcurementRun,
  updateItem: updateAuthorizedProcurementItem,
  completeRun: completeAuthorizedProcurementRun,
};

export function createMeravCartMcpServer(services: ProcurementMcpServices = defaultServices) {
  const server = new McpServer(
    { name: "merav-cart-builder", version: "0.1.0" },
    {
      instructions:
        "Retrieve one token-scoped Merav cart run, use @Chrome for retailer work, and update Studio after every item. Never guess options, accept unauthorized substitutions, bypass CAPTCHA, begin checkout, enter payment, or place an order.",
    },
  );

  server.registerTool(
    "get_procurement_run",
    {
      title: "Get procurement run",
      description:
        "Retrieve the exact products and frozen purchasing requirements for one authorized Merav Studio cart run.",
      inputSchema: {
        run_authorization: z
          .string()
          .min(32)
          .describe("Short-lived run authorization copied from Merav Studio."),
      },
      outputSchema: {
        run: z.record(z.unknown()),
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
      const readyProducts = run.items.map((item) => ({
        run_item_id: item.id,
        spec_book_item_id: item.spec_book_item_id,
        room: item.room_name,
        product_name: item.product_name,
        vendor: item.vendor,
        retailer_domain: item.retailer_domain,
        exact_product_url: item.product_url,
        sku: item.sku,
        quantity: item.requested_quantity,
        requested_options: item.requested_options,
        expected_unit_price: item.expected_price,
        product_image_url: item.product_image_url,
        notes: item.source_notes,
        current_status: item.status,
        current_status_label: itemStatusLabel(item.status),
      }));
      const vendors = Array.from(
        new Set(readyProducts.map((item) => item.retailer_domain).filter(Boolean)),
      );
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
        safety_rules: [...SAFETY_RULES],
      };
      return {
        structuredContent,
        content: [
          {
            type: "text",
            text: `Retrieved ${readyProducts.length} products across ${vendors.length} retailers for ${run.project_name}.`,
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
        status: z.enum(PROCUREMENT_ITEM_STATUSES),
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
            text: `Completed run ${structuredContent.run_id}: ${structuredContent.added} added, ${structuredContent.needs_review} need review, ${structuredContent.failed} failed, ${structuredContent.skipped} skipped.`,
          },
        ],
      };
    },
  );

  return server;
}
