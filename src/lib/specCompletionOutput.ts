export function completionOutput(value: any): unknown[] {
  if (value?.status !== "completed") throw new Error("Incomplete review");
  const output = value.output_text ?? value.output?.flatMap((item: any) => item.content ?? [])
    .filter((part: any) => part.type === "output_text").map((part: any) => part.text).join("");
  const parsed = JSON.parse(String(output || "").replace(/^```json\s*|\s*```$/g, "").trim());
  if (!Array.isArray(parsed.findings)) throw new Error("Invalid review");
  return parsed.findings;
}
