export type ConstructionDocumentProject = {
  id: string;
  name?: string | null;
  client_name?: string | null;
  status?: string | null;
};

const FILE_NOISE = new Set([
  "colorized",
  "construction",
  "document",
  "documents",
  "drawing",
  "drawings",
  "final",
  "mi",
  "pdf",
  "permit",
  "plans",
  "revised",
  "revision",
  "set",
]);

function words(value: unknown) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s*\(\d+\)\s*(?=\.[a-z0-9]{2,5}$)/i, " ")
    .replace(/\.[a-z0-9]{2,5}$/i, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\bmi\b[\s_-]*\d{6,8}\b/gi, " ")
    .replace(/\b\d{6,8}\b/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function fileWords(value: unknown) {
  return words(value).filter((word) => !FILE_NOISE.has(word));
}

function normalized(value: unknown) {
  return words(value).join(" ");
}

function isHistorical(project: ConstructionDocumentProject) {
  return /\b(old|archive|archived|test|duplicate|copy)\b/i.test(String(project.name || ""));
}

function aliasScore(fileTokens: string[], aliasValue: unknown) {
  const aliasTokens = words(aliasValue);
  if (!fileTokens.length || !aliasTokens.length) return 0;
  const file = fileTokens.join(" ");
  const alias = aliasTokens.join(" ");
  if (file === alias) return 100;
  if (file.length >= 4 && (alias.includes(file) || file.includes(alias))) return 90;
  if (fileTokens.every((token) => aliasTokens.includes(token))) return 80;
  if (aliasTokens.every((token) => fileTokens.includes(token))) return 75;
  return 0;
}

/**
 * Match a Blue Sky construction-document filename to one Studio project. The function
 * intentionally returns null on a tie; a document must never be auto-filed to the wrong client.
 */
export function matchConstructionDocumentProject(
  fileName: string,
  projects: ConstructionDocumentProject[],
) {
  const tokens = fileWords(fileName);
  if (!tokens.length) return null;
  const candidates = projects
    .map((project) => {
      const baseScore = Math.max(
        aliasScore(tokens, project.name),
        aliasScore(tokens, project.client_name),
      );
      return {
        project,
        score: Math.max(0, baseScore - (isHistorical(project) ? 30 : 0)),
      };
    })
    .filter((candidate) => candidate.score >= 75)
    .sort(
      (a, b) =>
        b.score - a.score || normalized(a.project.name).localeCompare(normalized(b.project.name)),
    );
  if (!candidates.length) return null;
  if (candidates[1]?.score === candidates[0].score) return null;
  return {
    projectId: candidates[0].project.id,
    projectName: String(
      candidates[0].project.name || candidates[0].project.client_name || "Project",
    ),
    confidence: candidates[0].score / 100,
    reason: `Construction PDF filename matches ${String(candidates[0].project.name || candidates[0].project.client_name || "the project")}`,
  };
}
