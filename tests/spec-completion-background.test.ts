import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ poll: vi.fn(), fail: vi.fn(), sleep: vi.fn(), start: vi.fn() }));
vi.mock("workflow", () => ({ sleep: state.sleep }));
vi.mock("workflow/api", () => ({ start: state.start }));
vi.mock("@/lib/savedSpecCompletion.server", () => ({ pollCompletionSave: state.poll, failCompletionSave: state.fail }));
import { saveSpecCompletionInBackground } from "@/workflows/specCompletionSave";
import { startCompletionSaveWorker } from "@/lib/specCompletionBackground.server";
const project = "9015b5ff-6343-462b-9539-9e62ed1c52d0";
const job = "4204f2d1-e10c-4d98-a01b-350cf7d8cafe";
beforeEach(() => {
  vi.clearAllMocks();
  state.poll.mockReset().mockResolvedValue("checked");
  state.fail.mockResolvedValue(undefined);
  state.sleep.mockResolvedValue(undefined);
  state.start.mockResolvedValue({ runId: "wrun_test" });
});
it("queues a durable collector with IDs only and returns without waiting for the AI", async () => {
  expect(await startCompletionSaveWorker(project, job)).toBe("wrun_test");
  expect(state.start).toHaveBeenCalledWith(saveSpecCompletionInBackground, [project, job]);
  expect(state.poll).not.toHaveBeenCalled();
});
it("finishes after durable sleeps without any browser request", async () => {
  state.poll.mockResolvedValueOnce("checking").mockResolvedValueOnce("checking").mockResolvedValue("checked");
  expect(await saveSpecCompletionInBackground(project, job)).toBe("checked");
  expect(state.poll).toHaveBeenCalledTimes(3);
  expect(state.poll).toHaveBeenCalledWith(project, job);
  expect(state.sleep).toHaveBeenCalledTimes(2);
  expect(state.sleep).toHaveBeenCalledWith("15s");
  expect(state.fail).not.toHaveBeenCalled();
});
it.each(["replaced", "unavailable", "checked"])("stops when the saved job is %s", async status => {
  state.poll.mockResolvedValue(status);
  expect(await saveSpecCompletionInBackground(project, job)).toBe(status);
  expect(state.sleep).not.toHaveBeenCalled();
  expect(state.fail).not.toHaveBeenCalled();
});
it("continues collecting large reviews past the former forty-poll cutoff", async () => {
  let polls = 0;
  state.poll.mockImplementation(async () => ++polls <= 48 ? "checking" : "checked");
  expect(await saveSpecCompletionInBackground(project, job)).toBe("checked");
  expect(state.poll).toHaveBeenCalledTimes(49);
  expect(state.fail).not.toHaveBeenCalled();
});
it("records a failed collector after its bounded window, without another AI run", async () => {
  state.poll.mockResolvedValue("checking");
  expect(await saveSpecCompletionInBackground(project, job)).toBe("unavailable");
  expect(state.poll).toHaveBeenCalledTimes(120);
  expect(state.fail).toHaveBeenCalledWith(project, job);
});
it("keeps a durable failure recoverable if saving fails", async () => {
  state.poll.mockRejectedValue(new Error("Temporary database failure"));
  expect(await saveSpecCompletionInBackground(project, job)).toBe("unavailable");
  expect(state.fail).toHaveBeenCalledWith(project, job);
});
it("does not queue malformed project or job IDs", async () => {
  await expect(startCompletionSaveWorker("bad", job)).rejects.toThrow("Invalid completion job");
  await expect(startCompletionSaveWorker(project, "bad")).rejects.toThrow("Invalid completion job");
  expect(state.start).not.toHaveBeenCalled();
});
