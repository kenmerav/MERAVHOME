import { useEffect, useState } from "react";
import { userViewInfo, type UserViewInfo } from "@/lib/userView";
import { returnFromUserView } from "@/lib/userViewExit";

export function UserViewBanner() {
  const [info, setInfo] = useState<UserViewInfo | null>(null);
  const [ending, setEnding] = useState(false);
  const exit = async () => {
    setEnding(true);
    await returnFromUserView();
  };
  useEffect(() => {
    const current = userViewInfo();
    setInfo(current);
    if (!current) return;
    document.body.classList.add("user-view-active");
    const timer = setTimeout(() => void exit(), Math.max(0, current.expires_at - Date.now()));
    return () => {
      clearTimeout(timer);
      document.body.classList.remove("user-view-active");
    };
  }, []);
  if (!info) return null;
  return (
    <>
      <style>{`.user-view-active .studio-sidebar,.user-view-active .studio-mobile-header{top:56px}.user-view-active .studio-sidebar{height:calc(100vh - 56px)}.user-view-active .studio-mobile-menu{top:112px;max-height:calc(100vh - 112px)}`}</style>
      <div className="h-14 print:hidden" />
      <div
        role="status"
        className="fixed inset-x-0 top-0 z-[100] flex h-14 items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 text-sm text-ink print:hidden"
      >
        <div className="min-w-0 truncate">
          <strong>Viewing as {info.full_name || info.email}</strong>
          <span className="ml-2 text-xs text-muted-foreground">{info.role} · View only</span>
        </div>
        <button
          type="button"
          disabled={ending}
          onClick={() => void exit()}
          className="shrink-0 border border-ink px-3 py-2 text-xs disabled:opacity-50"
        >
          {ending ? "Returning…" : "Return to my account"}
        </button>
      </div>
    </>
  );
}
