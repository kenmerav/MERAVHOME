/* eslint-disable @typescript-eslint/no-explicit-any -- MCP mocks intentionally emulate database-backed service boundaries. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMeravCartMcpServer } from "@/lib/procurementMcp.server";

const token = "a".repeat(43);
const item = {
  id: "55555555-5555-4555-8555-555555555555",
  run_id: "11111111-1111-4111-8111-111111111111",
  spec_book_item_id: "22222222-2222-4222-8222-222222222222",
  product_id: "33333333-3333-4333-8333-333333333333",
  room_id: "44444444-4444-4444-8444-444444444444",
  room_name: "Kitchen",
  product_name: "Natural Oak Pendant",
  vendor: "Mock Retailer",
  retailer_domain: "shop.example.com",
  product_url: "https://shop.example.com/products/oak-pendant",
  sku: "PEND-24-OAK",
  requested_quantity: 2,
  requested_options: {
    color: null,
    finish: "Natural Oak",
    size: "24 in",
    dimensions: '24"',
    other_requirements: null,
    substitution_instructions: null,
    procurement_method: "online_cart",
    rep_email: null,
  },
  expected_price: 249,
  product_image_url: null,
  source_notes: null,
  status: "prepared",
  observed_product_title: null,
  observed_options: {},
  observed_price: null,
  observed_availability: null,
  result_notes: null,
  retailer_cart_url: null,
  retry_count: 0,
  updated_at: "2026-07-24T12:00:00.000Z",
} as const;

const run = {
  id: "11111111-1111-4111-8111-111111111111",
  project_id: "66666666-6666-4666-8666-666666666666",
  project_name: "Mock Residence",
  created_by: "77777777-7777-4777-8777-777777777777",
  status: "prepared",
  source_run_id: null,
  created_at: "2026-07-24T12:00:00.000Z",
  started_at: null,
  expires_at: "2026-07-24T13:00:00.000Z",
  completed_at: null,
  cancelled_at: null,
  items: [item],
} as any;

const connected: Array<{ client: Client; server: ReturnType<typeof createMeravCartMcpServer> }> =
  [];

async function setup(authorizedRun = run) {
  const authorizeRun = vi.fn(async (authorization: string) => {
    if (authorization !== token) throw new Error("Unauthorized run");
    return authorizedRun;
  });
  const updateItem = vi.fn(async (input: any) => ({
    ...item,
    status: input.status,
    observed_price: input.observedPrice ?? null,
  }));
  const completeRun = vi.fn(async () => ({
    run_id: run.id,
    status: "completed" as const,
    added: 1,
    drafted: 0,
    needs_review: 0,
    failed: 0,
    skipped: 0,
  }));
  const createRetailerDraft = vi.fn(async (input: any) => ({
    draft_id: "gmail-draft-123",
    thread_id: null,
    draft_key: input.draftKey,
    recipient: "TMeyer@arizonatile.com",
    subject: "Arizona Tile product request — Mock Residence",
    account_email: "ken@meravinteriors.com" as const,
    run_item_ids: [item.id],
    created_at: "2026-07-24T12:05:00.000Z",
    already_existed: false,
  }));
  const server = createMeravCartMcpServer({
    authorizeRun: authorizeRun as any,
    updateItem: updateItem as any,
    completeRun: completeRun as any,
    createRetailerDraft: createRetailerDraft as any,
  });
  const client = new Client({ name: "merav-cart-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  connected.push({ client, server });
  return { client, authorizeRun, updateItem, completeRun, createRetailerDraft };
}

afterEach(async () => {
  await Promise.all(
    connected.splice(0).map(({ client, server }) => Promise.all([client.close(), server.close()])),
  );
});

describe("Merav Cart Builder MCP contract", () => {
  it("advertises the four-tool surface with a dedicated draft-only email tool", async () => {
    const { client } = await setup();
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name)).toEqual([
      "get_procurement_run",
      "create_retailer_draft",
      "update_procurement_item",
      "complete_procurement_run",
    ]);
    expect(result.tools[0].annotations?.readOnlyHint).toBe(true);
    expect(result.tools[1].annotations?.readOnlyHint).toBe(false);
    expect(result.tools[1].description).toContain("no Send capability");
    expect(result.tools[2].annotations?.readOnlyHint).toBe(false);
    expect(result.tools[3].annotations?.destructiveHint).toBe(true);
  });

  it("returns only products from the authorized run and includes safety rules", async () => {
    const { client, authorizeRun } = await setup();
    const result = await client.callTool({
      name: "get_procurement_run",
      arguments: { run_authorization: token },
    });
    expect(authorizeRun).toHaveBeenCalledWith(token);
    expect(result.structuredContent).toMatchObject({
      run: {
        run_id: run.id,
        product_count: 1,
        ready_products: [{ run_item_id: item.id, sku: "PEND-24-OAK", quantity: 2 }],
      },
    });
    expect(JSON.stringify(result.structuredContent)).toContain("Never click Buy Now");
  });

  it("returns an Arizona Tile email draft with the project name and quantity", async () => {
    const arizonaTileItem = {
      ...item,
      vendor: "Arizona Tile",
      retailer_domain: "www.arizonatile.com",
      product_name: "Flash White 3 x 12",
      product_url: "https://www.arizonatile.com/products/flash-white",
      sku: "FLASWHI3X12",
      requested_quantity: 42,
      requested_options: {
        ...item.requested_options,
        procurement_method: "email_rep",
        rep_email: "TMeyer@arizonatile.com",
      },
    };
    const { client } = await setup({ ...run, items: [arizonaTileItem] });
    const result = await client.callTool({
      name: "get_procurement_run",
      arguments: { run_authorization: token },
    });

    expect(result.structuredContent).toMatchObject({
      manual_email_drafts: [
        {
          retailer: "Arizona Tile",
          from_account: "ken@meravinteriors.com",
          to: "TMeyer@arizonatile.com",
          subject: "Arizona Tile product request — Mock Residence",
          run_item_ids: [item.id],
        },
      ],
    });
    expect(JSON.stringify(result.structuredContent)).toContain("Project: Mock Residence");
    expect(JSON.stringify(result.structuredContent)).toContain("Quantity needed: 42 pieces");
    expect(JSON.stringify(result.structuredContent)).toContain("has no Send operation");
  });

  it("creates the exact frozen retailer draft through Studio and records Drafted items", async () => {
    const { client, createRetailerDraft } = await setup();
    const result = await client.callTool({
      name: "create_retailer_draft",
      arguments: {
        run_authorization: token,
        draft_key: "tmeyer@arizonatile.com::arizona tile",
      },
    });
    expect(createRetailerDraft).toHaveBeenCalledWith({
      runAuthorization: token,
      draftKey: "tmeyer@arizonatile.com::arizona tile",
    });
    expect(result.structuredContent).toMatchObject({
      draft_id: "gmail-draft-123",
      account_email: "ken@meravinteriors.com",
      run_item_ids: [item.id],
    });
    expect(JSON.stringify(result.content)).toContain("No email was sent");
  });

  it("validates and forwards item results without changing source requirements", async () => {
    const { client, updateItem } = await setup();
    const result = await client.callTool({
      name: "update_procurement_item",
      arguments: {
        run_authorization: token,
        run_item_id: item.id,
        status: "out_of_stock",
        observed_product_title: "Natural Oak Pendant",
        observed_options: { finish: "Natural Oak", size: "24-inch" },
        observed_price: 259,
        observed_stock_status: "Out of stock",
        result_notes: "Safe mock fixture; nothing added.",
      },
    });
    expect(updateItem).toHaveBeenCalledWith(
      expect.objectContaining({
        runItemId: item.id,
        status: "out_of_stock",
        observedPrice: 259,
      }),
    );
    expect(result.structuredContent).toMatchObject({
      item: { status: "out_of_stock", requested_quantity: 2 },
    });
  });

  it("completes and returns Added, Drafted, Needs Review, Failed, and Skipped totals", async () => {
    const { client, completeRun } = await setup();
    const result = await client.callTool({
      name: "complete_procurement_run",
      arguments: { run_authorization: token },
    });
    expect(completeRun).toHaveBeenCalledWith(token);
    expect(result.structuredContent).toEqual({
      run_id: run.id,
      status: "completed",
      added: 1,
      drafted: 0,
      needs_review: 0,
      failed: 0,
      skipped: 0,
    });
  });

  it("rejects malformed tool input before a write handler runs", async () => {
    const { client, updateItem } = await setup();
    const result = await client.callTool({
      name: "update_procurement_item",
      arguments: {
        run_authorization: "short",
        run_item_id: "not-a-uuid",
        status: "added",
      },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Input validation error");
    expect(updateItem).not.toHaveBeenCalled();
  });
});
