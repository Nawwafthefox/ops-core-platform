import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

export function useSystemAdmin() {
  const [isSystemAdmin, setIsSystemAdmin] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase.rpc("rpc_whoami");
        if (cancelled) return;

        if (error) {
          // If rpc_whoami fails, default to not system admin.
          setIsSystemAdmin(false);
          return;
        }

        setIsSystemAdmin(Boolean((data as any)?.is_system_admin));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { isSystemAdmin, loading };
}
