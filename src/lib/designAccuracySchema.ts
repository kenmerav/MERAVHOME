import { z } from "zod";
import type { AccuracyCommand } from "./designAccuracy";

const id = z.string().min(1).max(200);
const short = z.string().max(2000);
const key = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9]{0,79}$/)
  .refine((k) => !["constructor", "prototype"].includes(k));
const value = z.union([z.string().max(10000), z.number().finite().min(0).max(1e12), z.null()]);
export const accuracySourceSchema = z
  .object({
    id,
    kind: z.enum([
      "supplier",
      "sample",
      "layout",
      "schedule",
      "brief",
      "document",
      "default",
      "designer",
    ]),
    label: short,
    revision: z.string().min(1).max(200),
    reference: z.string().max(10000),
    documentId: id.optional(),
    sheet: short.optional(),
    page: z.number().int().positive().optional(),
  })
  .strict();
const disposition = z.enum([
  "select",
  "not-needed",
  "existing",
  "other-party",
  "included",
  "unresolved",
]);
const roomScope = { roomId: id, itemId: id };
export const accuracyCommandSchema: z.ZodType<AccuracyCommand> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("default"), id, key, value, source: accuracySourceSchema }).strict(),
  z.object({ type: z.literal("inherit"), ...roomScope, defaultId: id }).strict(),
  z
    .object({
      type: z.literal("bind"),
      ...roomScope,
      selectionId: id.optional(),
      materialId: id.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("field"),
      ...roomScope,
      key,
      value,
      proposal: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("confirm"),
      ...roomScope,
      keys: z.array(key).min(1).max(80),
      source: accuracySourceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("decision"),
      ...roomScope,
      disposition,
      owner: short.optional(),
      parentId: id.optional(),
      source: accuracySourceSchema.optional(),
      meravFields: z.array(key).max(80).optional(),
    })
    .strict(),
  z.object({ type: z.literal("no-tub"), roomId: id }).strict(),
  z
    .object({
      type: z.literal("item"),
      roomId: id,
      id,
      category: z.string().min(1).max(200),
      kind: z.enum(["retail", "custom", "cabinet-finish", "coordination"]),
      sizeRequired: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("scope"),
      rooms: z
        .array(z.object({ id, name: short }).strict())
        .min(1)
        .max(5000),
      source: accuracySourceSchema,
    })
    .strict(),
  z.object({ type: z.literal("source"), source: accuracySourceSchema }).strict(),
  z
    .object({
      type: z.literal("check"),
      check: z
        .object({
          id,
          ...roomScope,
          field: key,
          expected: value,
          relation: z.enum(["equals", "maximum", "minimum", "explicit-presence"]),
          unit: short.optional(),
          source: accuracySourceSchema,
          mode: z.enum(["manual", "automated"]),
        })
        .strict(),
      dependencies: z
        .array(z.object({ itemId: id, field: key }).strict())
        .max(100)
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("coverage"),
      coverage: z
        .object({
          sourceId: id,
          revision: short,
          expected: z.array(id).max(20000),
          processed: z.array(id).max(20000),
          failed: z.array(id).max(20000),
          cancelled: z.boolean(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("companion"),
      ...roomScope,
      companion: z
        .object({
          id,
          label: short,
          disposition: z.enum(["included", "separate", "other-party"]).optional(),
          parentId: id.optional(),
          source: accuracySourceSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({ type: z.literal("snapshot"), id, kind: z.enum(["draft", "design-approved"]) })
    .strict(),
]);
export const accuracyMutationSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    commands: z.array(accuracyCommandSchema).min(1).max(1000),
  })
  .strict();
