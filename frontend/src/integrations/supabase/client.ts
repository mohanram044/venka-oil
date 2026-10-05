import type { SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;

export const getSupabase = async (): Promise<SupabaseClient> => {
  if (supabaseInstance) return supabaseInstance;
  
  // Dynamically import only when this function is called (which will be on the client)
  const { createClient } = await import('@supabase/supabase-js');
  
  const rawUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  
  if (!rawUrl || !rawKey) {
    console.warn(
      "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables. " +
      "Please add them to your .env file."
    );
  }
  
  const supabaseUrl = rawUrl.startsWith('http') ? rawUrl : 'https://dummy-fallback.supabase.co';
  const supabaseAnonKey = rawKey || 'dummy-key';
  
  supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
  return supabaseInstance;
};
