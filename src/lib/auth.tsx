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
      async function loadRole(uid: string, email?: string) {
        try {
          const { data } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", uid);
          if (!mounted) return;
          const isDbAdmin = !!data?.some((r) => r.role === "admin");
          const isEmailAdmin = email === "shreedhana2005@gmail.com" || (email?.includes("admin") ?? false);
          setIsAdmin(isDbAdmin || isEmailAdmin);
        } catch (e) {
          if (!mounted) return;
          setIsAdmin(email === "shreedhana2005@gmail.com" || (email?.includes("admin") ?? false));
        }
      }

      supabase.auth.getSession().then(({ data }) => {
        if (!mounted) return;
        const u = data.session?.user ?? null;
        setUser(u);
        if (u) loadRole(u.id, u.email);
        setLoading(false);
      }).catch(err => {
        console.warn("[useAuth] getSession notice:", err);
        if (mounted) setLoading(false);
      });

      const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
        const u = session?.user ?? null;
        setUser(u);
        setIsAdmin(false);
        if (u) loadRole(u.id, u.email);
      });
      subscription = sub?.subscription;
    }).catch(err => {
      console.warn("[useAuth] getSupabase notice:", err);
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      if (subscription) subscription.unsubscribe();
    };
  }, []);

  return { user, isAdmin, loading };
}