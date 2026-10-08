import { supabase } from "@/integrations/supabase/client";
import { isUserViewTab, userViewAuthKey, USER_VIEW_INFO_KEY } from "@/lib/userView";

export async function returnFromUserView() {
  if (isUserViewTab()) {
    const authKey = userViewAuthKey();
    try {
      await Promise.race([
        supabase.auth.signOut({ scope: "local" }),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);
    } catch {
      /* Return remains available while offline. */
    }
    window.sessionStorage.removeItem(authKey);
    window.sessionStorage.removeItem(`${authKey}-code-verifier`);
    window.sessionStorage.removeItem(USER_VIEW_INFO_KEY);
  }
  window.location.replace("/users");
}
