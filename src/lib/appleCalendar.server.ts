import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CALENDAR_NAMES = ["Katie", "Ken", "FAMILY"] as const;
const CACHE_MS = 5 * 60 * 1000;

export type EaCalendarEvent = {
  id: string;
  calendar: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location: string | null;
  url: string | null;
};

export type EaCalendarData = {
  provider: "apple_calendar";
  calendars: string[];
  events: EaCalendarEvent[];
  refreshed_at: string;
  available: boolean;
  message?: string;
};

export type CreateEaCalendarEventInput = {
  task_id: string;
  calendar: (typeof CALENDAR_NAMES)[number];
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  location?: string | null;
};

export type CreateEaCalendarEventResult = {
  created: boolean;
  event: EaCalendarEvent;
};

let cache: { expiresAt: number; pastDays: number; value: EaCalendarData } | null = null;

const CREATE_EVENT_JXA = String.raw`
function run(argv) {
  const app = Application("Calendar");
  const payload = JSON.parse(String(argv[0] || "{}"));
  const calendar = app.calendars.byName(String(payload.calendar || ""));
  if (!calendar.exists()) throw new Error("Calendar not found: " + payload.calendar);

  const start = new Date(String(payload.start_at));
  const end = new Date(String(payload.end_at));
  const marker = String(payload.marker || "");
  const rangeStart = new Date(start.getTime() - 86400000);
  const rangeEnd = new Date(start.getTime() + 86400000);
  const nearby = calendar.events.whose({
    _and: [
      { startDate: { _greaterThanEquals: rangeStart } },
      { startDate: { _lessThanEquals: rangeEnd } }
    ]
  })();

  for (const candidate of nearby) {
    try {
      const value = candidate.properties();
      const sameMarker = marker && String(value.url || "") === marker;
      const sameEvent =
        String(value.summary || "") === String(payload.title || "") &&
        new Date(value.startDate).getTime() === start.getTime();
      if (sameMarker || sameEvent) {
        return JSON.stringify({
          created: false,
          event: {
            id: String(value.uid || ""),
            calendar: String(payload.calendar),
            title: String(value.summary || payload.title),
            start_at: new Date(value.startDate).toISOString(),
            end_at: new Date(value.endDate).toISOString(),
            all_day: value.alldayEvent === true,
            location: value.location ? String(value.location) : null,
            url: value.url ? String(value.url) : null
          }
        });
      }
    } catch (_) {}
  }

  const event = app.Event({
    summary: String(payload.title),
    startDate: start,
    endDate: end,
    alldayEvent: false,
    location: payload.location ? String(payload.location) : "",
    url: marker,
    description: "Confirmed in MERAV Studio EA Desk"
  });
  calendar.events.push(event);
  const value = event.properties();
  return JSON.stringify({
    created: true,
    event: {
      id: String(value.uid || ""),
      calendar: String(payload.calendar),
      title: String(value.summary || payload.title),
      start_at: new Date(value.startDate).toISOString(),
      end_at: new Date(value.endDate).toISOString(),
      all_day: value.alldayEvent === true,
      location: value.location ? String(value.location) : null,
      url: value.url ? String(value.url) : null
    }
  });
}
`;

const EVENTKIT_SWIFT = String.raw`
import Foundation
import EventKit

struct CalendarEvent: Codable {
  let id: String
  let calendar: String
  let title: String
  let start_at: String
  let end_at: String
  let all_day: Bool
  let location: String?
  let url: String?
}

let store = EKEventStore()
let permission = DispatchSemaphore(value: 0)
var accessGranted = false
var accessError: Error?

if #available(macOS 14.0, *) {
  store.requestFullAccessToEvents { granted, error in
    accessGranted = granted
    accessError = error
    permission.signal()
  }
} else {
  store.requestAccess(to: .event) { granted, error in
    accessGranted = granted
    accessError = error
    permission.signal()
  }
}

if permission.wait(timeout: .now() + 20) == .timedOut {
  fputs("Apple Calendar access timed out.\n", stderr)
  exit(2)
}
if !accessGranted {
  fputs("Apple Calendar access denied: \(accessError?.localizedDescription ?? "permission required")\n", stderr)
  exit(3)
}

let environment = ProcessInfo.processInfo.environment
let days = max(1, min(60, Int(environment["MERAV_CALENDAR_DAYS"] ?? "30") ?? 30))
let pastDays = max(0, min(60, Int(environment["MERAV_CALENDAR_PAST_DAYS"] ?? "0") ?? 0))
let wantedNames = Set(["Katie", "Ken", "FAMILY"])
let calendars = store.calendars(for: .event).filter { wantedNames.contains($0.title) }
let startOfToday = Calendar.current.startOfDay(for: Date())
let start = Calendar.current.date(byAdding: .day, value: -pastDays, to: startOfToday)!
let end = Calendar.current.date(byAdding: .day, value: pastDays + days, to: start)!
let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
let formatter = ISO8601DateFormatter()
formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
let events = store.events(matching: predicate).map { event in
  CalendarEvent(
    id: event.eventIdentifier ?? "",
    calendar: event.calendar.title,
    title: event.title ?? "Busy",
    start_at: formatter.string(from: event.startDate),
    end_at: formatter.string(from: event.endDate),
    all_day: event.isAllDay,
    location: event.location,
    url: event.url?.absoluteString
  )
}.filter { !$0.id.isEmpty }

let data = try JSONEncoder().encode(events)
FileHandle.standardOutput.write(data)
`;

async function readCalendars(pastDays = 0) {
  const { stdout } = await execFileAsync("/usr/bin/swift", ["-e", EVENTKIT_SWIFT], {
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
    env: {
      ...process.env,
      MERAV_CALENDAR_DAYS: "30",
      MERAV_CALENDAR_PAST_DAYS: String(pastDays),
    },
  });
  const parsed = JSON.parse(stdout || "[]");
  return Array.isArray(parsed) ? (parsed as EaCalendarEvent[]) : [];
}

function calendarReadMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error || "");
  if (/not authorized|not permitted|access denied|permission required|-1743/i.test(detail)) {
    return "Allow your terminal or Studio to read calendars in System Settings → Privacy & Security → Calendars, then refresh again.";
  }
  if (/timed out|timeout|killed/i.test(detail)) {
    return "Apple Calendar took too long to respond. Open the Calendar app, then try Refresh calendars again.";
  }
  return "Apple Calendar was temporarily unavailable. Open the Calendar app, then try Refresh calendars again.";
}

export async function loadAppleCalendar(force = false, pastDays = 0): Promise<EaCalendarData> {
  if (!force && cache && cache.pastDays === pastDays && cache.expiresAt > Date.now())
    return cache.value;
  if (process.platform !== "darwin") {
    return {
      provider: "apple_calendar",
      calendars: [...CALENDAR_NAMES],
      events: [],
      refreshed_at: new Date().toISOString(),
      available: false,
      message: "Apple Calendar is available only from the local Studio Mac during preview.",
    };
  }
  try {
    const events = (await readCalendars(pastDays)).filter((event) => event.id && event.start_at);
    events.sort((left, right) => left.start_at.localeCompare(right.start_at));
    const value: EaCalendarData = {
      provider: "apple_calendar",
      calendars: [...CALENDAR_NAMES],
      events,
      refreshed_at: new Date().toISOString(),
      available: true,
    };
    cache = {
      expiresAt: Date.now() + CACHE_MS,
      pastDays,
      value,
    };
    return value;
  } catch (error) {
    if (cache?.pastDays === pastDays && cache.value.events.length) {
      return {
        ...cache.value,
        available: true,
        message:
          "Apple Calendar did not finish refreshing. Showing the last successful calendar update.",
      };
    }
    return {
      provider: "apple_calendar",
      calendars: [...CALENDAR_NAMES],
      events: [],
      refreshed_at: new Date().toISOString(),
      available: false,
      message: calendarReadMessage(error),
    };
  }
}

export async function createAppleCalendarEvent(
  input: CreateEaCalendarEventInput,
): Promise<CreateEaCalendarEventResult> {
  if (process.platform !== "darwin") {
    throw new Error("Apple Calendar appointments can be added only from the local Studio Mac.");
  }
  if (!CALENDAR_NAMES.includes(input.calendar)) throw new Error("Choose a Studio calendar.");
  const taskId = String(input.task_id || "").trim();
  const title = String(input.title || "")
    .trim()
    .slice(0, 200);
  const location = String(input.location || "")
    .trim()
    .slice(0, 500);
  if (!taskId || !title) throw new Error("Task and appointment title are required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Choose an appointment date.");
  if (!/^\d{2}:\d{2}$/.test(input.start_time) || !/^\d{2}:\d{2}$/.test(input.end_time)) {
    throw new Error("Choose a start and end time.");
  }
  const start = new Date(`${input.date}T${input.start_time}:00-07:00`);
  const end = new Date(`${input.date}T${input.end_time}:00-07:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    throw new Error("The appointment end time must be after its start time.");
  }
  if (end.getTime() - start.getTime() > 24 * 60 * 60 * 1000) {
    throw new Error("An appointment cannot be longer than 24 hours.");
  }

  const payload = JSON.stringify({
    calendar: input.calendar,
    title,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    location: location || null,
    marker: `merav-ea://task/${encodeURIComponent(taskId)}`,
  });
  const { stdout } = await execFileAsync(
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", CREATE_EVENT_JXA, "--", payload],
    { timeout: 120_000, maxBuffer: 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout || "{}");
  if (!parsed?.event?.start_at) throw new Error("Apple Calendar did not return the appointment.");
  cache = null;
  return parsed as CreateEaCalendarEventResult;
}
