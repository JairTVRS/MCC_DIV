import { supabase } from '../../lib/supabase';
import type { Pessoa } from '../../lib/tipos';
import type { UsuarioCurto } from './FormReserva';

export type Contadores = Map<string, { anexos: number; comentarios: number }>;

/**
 * O que a Agenda e o Relatório precisam para abrir o card da reserva:
 * pessoas (ativas e inativas), usuários (quem pode ser responsável) e contadores de anexos/comentários.
 */
export async function carregarBase(): Promise<{ pessoas: Pessoa[]; usuarios: UsuarioCurto[]; contadores: Contadores }> {
  const [p, u, g, c] = await Promise.all([
    supabase.from('pessoas').select('id, nome, tipo, telefone, email, documento, ativo').eq('excluido', false).order('nome'),
    supabase.from('usuarios').select('id, nome, status_acesso, perfil_id, foto_google, foto_upload, usar_foto_upload').order('nome'),
    supabase.from('grupo_funcoes').select('perfil_id').eq('funcao', 'reservas.visualizar'),
    supabase.rpc('contadores_reservas'),
  ]);
  const falha = p.error ?? u.error ?? g.error;
  if (falha) throw falha;
  const gruposAgenda = new Set((g.data ?? []).map((x: { perfil_id: string }) => x.perfil_id));
  return {
    pessoas: (p.data ?? []) as Pessoa[],
    usuarios: (u.data ?? []).map(
      (x: { id: string; nome: string; status_acesso: string; perfil_id: string | null; foto_google: string | null; foto_upload: string | null; usar_foto_upload: boolean }) => ({
        id: x.id,
        nome: x.nome,
        foto: x.usar_foto_upload && x.foto_upload ? x.foto_upload : x.foto_google,
        responsavel: x.status_acesso === 'ativo' && !!x.perfil_id && gruposAgenda.has(x.perfil_id),
      }),
    ),
    // Contadores são só enfeite: se falharem, seguem vazios.
    contadores: new Map(
      ((c.data ?? []) as { locacao_id: string; anexos: number; comentarios: number }[]).map((x) => [x.locacao_id, { anexos: Number(x.anexos), comentarios: Number(x.comentarios) }]),
    ),
  };
}
