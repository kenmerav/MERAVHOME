import { describe, expect, it } from "vitest";
import { matchConstructionDocumentProject } from "../src/lib/constructionDocumentMatching";

const projects = [
  { id: "bella", name: "Bella Vista", client_name: "Kip", status: "Design" },
  { id: "cambridge", name: "Cambridge", client_name: "DeLaTorre", status: "Design" },
  { id: "cortez", name: "Cortez", client_name: "Christy Castellini", status: "Design" },
  { id: "quartz", name: "HBC Quartz Rock", client_name: "Christy Castellani", status: "Design" },
  { id: "rinehart-old", name: "Rinehart (OLD)", client_name: "Bret & Jessica Rinehart" },
  { id: "rinehart", name: "Rinehart Reno", client_name: "Rinehart" },
  { id: "spec-k", name: "SPEC LOT K", client_name: "Pono Investments" },
];

describe("Blue Sky construction document matching", () => {
  it.each([
    ["BELLA_MI_260903.pdf", "bella"],
    ["BELLA_MI_260903 (1).pdf", "bella"],
    ["CAMBRIDGE_MI_260826.pdf", "cambridge"],
    ["CORTEZ_MI_260826.pdf", "cortez"],
    ["QUARTZ_MI_260825.pdf", "quartz"],
    ["Spec K_MI_260831.pdf", "spec-k"],
    ["Rinehart_MI_260909_colorized.pdf", "rinehart"],
  ])("matches %s to the one current project", (fileName, projectId) => {
    expect(matchConstructionDocumentProject(fileName, projects)?.projectId).toBe(projectId);
  });

  it("stops when two current projects are equally plausible", () => {
    const duplicateProjects = [
      { id: "moore-a", name: "Moore Project", client_name: "Moore" },
      { id: "moore-b", name: "Moore Project", client_name: "Moore" },
    ];
    expect(matchConstructionDocumentProject("MOORE_MI_260813.pdf", duplicateProjects)).toBeNull();
  });

  it("does not guess from a generic filename", () => {
    expect(matchConstructionDocumentProject("Construction Documents.pdf", projects)).toBeNull();
  });
});
