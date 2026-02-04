import { useEffect } from "react";
import { supabase } from "./supabaseClient";

export function useEnforceActiveUser() {
  useEffect(() => {
    const run = async () => {
      try {
        const { data, error } = await supabase.rpc("rpc_my_is_active");
        if (error || data !== true) {
          await supabase.auth.signOut();
          localStorage.setItem("ocp_disabled_reason", "Account disabled. Contact your administrator.");
          window.location.href = "/login";
        }
      } catch {
        await supabase.auth.signOut();
        localStorage.setItem("ocp_disabled_reason", "Account disabled. Contact your administrator.");
        window.location.href = "/login";
      }
    };
    run();
  }, []);
}
