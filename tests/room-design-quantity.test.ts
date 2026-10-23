import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { parseRoomDesignQuantity, roomDesignQuantityLabel } from "@/lib/roomDesignQuantity";
import {
  createDefaultRoomDesignWorkflowState,
  mergeExtensionProductIntoRoomDesignWorkflow,
  normalizeRoomDesignWorkflowState,
  mergeRoomDesignSelectionsIntoBoard,
} from "@/lib/roomDesignWorkflow";
import { planSpecBoardSync } from "@/lib/specBoardSync";

const context: Record<string, any> = {};
runInNewContext(readFileSync("chrome-extension/send-to-merav-studio/quantity.js", "utf8"), context);

describe("Room Design quantity", () => {
  it.each(["TBD", "tbd", " TBD "])(
    "carries %s from extension through saved workflow and Materials",
    (input) => {
      const wire = context.parseMeravQuantity(input);
      expect(wire).toBe("TBD");
      const quantity = parseRoomDesignQuantity(wire);
      expect(quantity).toBeNull();
      const productId = "64f674d2-01d1-45bc-8fe5-8c6a24e66c9c";
      const product = {
        id: productId,
        name: "Sink",
        vendor: "Vendor",
        finish: "White",
        sourcePageUrl: "https://example.com/sink",
        imageUrl: "https://example.com/sink.jpg",
        originalImageUrl: "",
        price: "100",
        sku: "1",
        dimensions: "20 in",
        quantity,
      };
      const imported = mergeExtensionProductIntoRoomDesignWorkflow({
        state: createDefaultRoomDesignWorkflowState("Kitchen"),
        itemKey: "sink",
        product,
      });
      const saved = normalizeRoomDesignWorkflowState(
        JSON.parse(JSON.stringify(imported.state)),
        "Kitchen",
      );
      expect(saved.links.find((link) => link.id === "sink")?.quantity).toBeNull();
      expect(saved.selections[0].quantity).toBeNull();
      expect(roomDesignQuantityLabel(saved.selections[0].quantity)).toBe("TBD");
      const roomId = "0033186c-a2e6-417f-a50f-37f5390f5cf5";
      const board = mergeRoomDesignSelectionsIntoBoard({
        boardState: { pages: [] },
        projectName: "Test",
        roomId,
        roomName: "Kitchen",
        selections: saved.selections,
        pageCount: 1,
      });
      const layer = board.pages
        .flatMap((page) => page.elements)
        .find((element) => element.productId === productId);
      expect(layer?.materialQuantity).toBeNull();
      const sync = planSpecBoardSync(
        "527d1356-919b-48b9-877e-1924c766282b",
        board,
        [],
        [{ id: roomId, name: "Kitchen" }],
        [{ id: productId, name: "Sink", product_url: product.sourcePageUrl } as any],
        () => "89863790-1b55-4a90-a9fe-0ec3a11f0b0d",
      );
      expect(sync.inserts).toHaveLength(1);
      expect(sync.inserts[0]).toMatchObject({ quantity: null, quantity_tbd: true });
    },
  );
  it("keeps numeric quantities and preserves omitted quantities as unknown", () => {
    expect(parseRoomDesignQuantity(context.parseMeravQuantity("2.5"))).toBe(2.5);
    expect(parseRoomDesignQuantity(undefined)).toBeNull();
    expect(parseRoomDesignQuantity(null)).toBeNull();
  });
  it.each(["", "0", "-1", "two", "Infinity", "1.23456"])("rejects invalid quantity %s", (value) => {
    expect(() => context.parseMeravQuantity(value)).toThrow();
    expect(() => parseRoomDesignQuantity(value)).toThrow();
  });
});
