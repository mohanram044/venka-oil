import { useEffect, useState } from "react";
import { getSupabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let subscription: any;

    getSupabase().then(supabase => {
      async function loadRole(uid: string) {
        const { data } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", uid);
        if (!mounted) return;
        setIsAdmin(!!data?.some((r) => r.role === "admin"));
      }

      supabase.auth.getSession().then(({ data }) => {
        if (!mounted) return;
        const u = data.session?.user ?? null;
        setUser(u);
        if (u) loadRole(u.id);
        setLoading(false);
      });

      const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
        const u = session?.user ?? null;
        setUser(u);
        setIsAdmin(false);
        if (u) loadRole(u.id);
      });
      subscription = sub.subscription;
    });

    return () => {
      mounted = false;
      if (subscription) subscription.unsubscribe();
    };
  }, []);

  return { user, isAdmin, loading };
}