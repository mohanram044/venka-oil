import { createClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.VITE_SUPABASE_URL || '';
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!rawUrl || !rawKey) {
  console.warn(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables. " +
    "Please add them to your .env file."
  );
}

// createClient throws synchronously if the URL is empty or lacks http/https.
// We provide a safe fallback so the SSR bundle can finish evaluating routeTree.gen.ts without a 500 crash.
const supabaseUrl = rawUrl.startsWith('http') ? rawUrl : 'https://dummy-fallback.supabase.co';
const supabaseAnonKey = rawKey || 'dummy-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
