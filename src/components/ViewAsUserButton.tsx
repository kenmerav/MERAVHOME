import { useState } from "react";
import { Eye } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isUserViewTab } from "@/lib/userView";

export function ViewAsUserButton({
  user,
}: {
  user: { id: string; full_name: string; is_active: boolean };
}) {
  const [opening, setOpening] = useState(false);
  const open = async () => {
    const channel = crypto.randomUUID();
    const origin = window.location.origin;
    const view = { child: null as Window | null };
    let timer: ReturnType<typeof setTimeout>;
    let handler: (event: MessageEvent) => void;
    setOpening(true);
    try {
      await new Promise<void>((resolve, reject) => {
        let requested = false;
        handler = (event) => {
          if (
            event.origin !== origin ||
            event.source !== view.child ||
            event.data?.channel !== channel
          )
            return;
          if (event.data.type === "merav-user-view-complete") return resolve();
          if (event.data.type === "merav-user-view-error")
            return reject(new Error(event.data.error || "Could not open this account."));
          if (event.data.type !== "merav-user-view-ready" || requested) return;
          requested = true;
          void (async () => {
            try {
              const { data } = await supabase.auth.getSession();
              if (!data.session) throw new Error("Your admin session expired. Sign in again.");
              const response = await fetch("/api/view-user", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${data.session.access_token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ user_id: user.id }),
              });
              const payload = await response.json();
              if (!response.ok) throw new Error(payload.error || "Could not open this account.");
              view.child?.postMessage(
                { type: "merav-user-view-session", channel, payload },
                origin,
              );
            } catch (error) {
              reject(error);
            }
          })();
        };
        window.addEventListener("message", handler);
        timer = setTimeout(
          () => reject(new Error("Account view took too long to open. Please try again.")),
          30000,
        );
        view.child = window.open(`/view-user#${channel}`, "_blank");
        if (!view.child) reject(new Error("Allow Studio to open a new tab, then try again."));
      });
    } catch (error) {
      view.child?.close();
      toast.error(error instanceof Error ? error.message : "Could not open this account.");
    } finally {
      clearTimeout(timer!);
      if (handler!) window.removeEventListener("message", handler);
      setOpening(false);
    }
  };

  return (
    <button
      type="button"
      disabled={!user.is_active || opening || isUserViewTab()}
      onClick={() => void open()}
      aria-label={`View as ${user.full_name}`}
      className="mt-2 inline-flex items-center gap-1.5 border border-border px-3 py-2 text-xs text-ink hover:border-ink disabled:opacity-40"
    >
      <Eye className="h-3.5 w-3.5" />
      {opening ? "Opening…" : "View as user"}
    </button>
  );
}
