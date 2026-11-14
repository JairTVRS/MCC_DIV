import { createClient } from '@supabase/supabase-js';

// trim(): tira espaços e quebras de linha que entram ao colar a chave no painel.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/+$/, '');
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

/** Falso quando as variáveis do Supabase não foram configuradas no ambiente. */
export const supabaseConfigurado = Boolean(url && key);

export const supabase = createClient(url || 'http://localhost:54321', key || 'chave-ausente', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
