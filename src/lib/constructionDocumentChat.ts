export function shouldCompareConstructionDocumentVersions(
  question: string,
  history: Array<{ content: string }> = [],
) {
  return /\b(change|changed|changes|compare|comparison|different|difference|previous|prior|older|revision|revised|updated|version)\b/i.test(
    `${question}\n${history.map((message) => message.content).join("\n")}`,
  );
}
