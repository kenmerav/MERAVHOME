import { describe, expect, it } from "vitest";
import { isConstructionDocumentQuestion } from "../src/lib/constructionDocumentQuestion";

describe("construction-document question routing", () => {
  it.each([
    "How many square feet is the office?",
    "What is the office square footage?",
    "How many sq ft is this room?",
    "Show me the drawing page with the kitchen dimensions.",
    "Where is the sconce installed?",
  ])("routes visual drawing question: %s", (question) => {
    expect(isConstructionDocumentQuestion(question)).toBe(true);
  });

  it.each([
    "Who should reply to Jessica?",
    "What is the next task?",
    "Summarize the client's latest email.",
  ])("leaves ordinary project question in the standard chat path: %s", (question) => {
    expect(isConstructionDocumentQuestion(question)).toBe(false);
  });
});
