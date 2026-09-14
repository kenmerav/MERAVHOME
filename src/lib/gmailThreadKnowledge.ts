export type GmailThreadMessage = {
  id: string;
  threadId: string;
  timestamp: number;
  subject: string;
  from: string;
  to: string;
  cc: string;
  body: string;
  participantEmails: string[];
};

export type GmailThreadKnowledge = {
  threadId: string;
  title: string;
  body: string;
  authorName: string | null;
  authorEmail: string | null;
  participants: string[];
  occurredAt: string;
  coverageStart: string;
  coverageEnd: string;
  messageIds: string[];
};

function isoDate(timestamp: number) {
  return new Date(timestamp).toISOString();
}

export function mergeCoverageDate(
  current: string | null | undefined,
  incoming: string | null | undefined,
  direction: "earliest" | "latest",
) {
  if (!current) return incoming || null;
  if (!incoming) return current;
  return direction === "earliest"
    ? current <= incoming
      ? current
      : incoming
    : current >= incoming
      ? current
      : incoming;
}

export function buildGmailThreadKnowledge(messages: GmailThreadMessage[]): GmailThreadKnowledge {
  const ordered = [...messages]
    .filter((message) => message.id && message.threadId && Number.isFinite(message.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (!ordered.length) throw new Error("The Gmail thread contained no readable messages.");
  const first = ordered[0];
  const latest = ordered[ordered.length - 1];
  const participants = Array.from(
    new Set(ordered.flatMap((message) => message.participantEmails).filter(Boolean)),
  );
  const authorEmail = latest.participantEmails.find((email) =>
    latest.from.toLowerCase().includes(email.toLowerCase()),
  );
  const body = ordered
    .map((message, index) =>
      [
        `--- EMAIL ${index + 1} OF ${ordered.length} ---`,
        `Date: ${isoDate(message.timestamp)}`,
        `From: ${message.from || "Unknown sender"}`,
        message.to ? `To: ${message.to}` : "",
        message.cc ? `Cc: ${message.cc}` : "",
        `Subject: ${message.subject || latest.subject || "Email"}`,
        "",
        message.body || "[No readable message body]",
      ]
        .filter((line) => line !== "")
        .join("\n"),
    )
    .join("\n\n")
    .slice(0, 900_000);

  return {
    threadId: latest.threadId,
    title: latest.subject || first.subject || "Email thread",
    body,
    authorName: latest.from || null,
    authorEmail: authorEmail || null,
    participants,
    occurredAt: isoDate(latest.timestamp),
    coverageStart: isoDate(first.timestamp),
    coverageEnd: isoDate(latest.timestamp),
    messageIds: ordered.map((message) => message.id),
  };
}
