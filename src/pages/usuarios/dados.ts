import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Grupo, NoArvore, StatusAcesso, UsuarioAdmin } from '../../lib/tipos';

export const COLUNAS_USUARIO_ADMIN =
  'id, nome, email, status_acesso, perfil_id, foto_google, foto_upload, usar_foto_upload, motivo_recusa, solicitado_em, decidido_em, decidido_por';

export const SITUACAO: Record<StatusAcesso, { rotulo: string; cor: string }> = {
  ativo: { rotulo: 'Ativo', cor: 'var(--ok)' },
  pendente: { rotulo: 'Aguardando', cor: 'var(--warn)' },
  recusado: { rotulo: 'Recusado', cor: 'var(--danger)' },
  inativo: { rotulo: 'Inativo', cor: 'var(--muted)' },
};

export function dataHora(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export async function lerGrupos(): Promise<Grupo[]> {
  const { data, error } = await supabase.from('perfis').select('id, nome, descricao, sistema').order('sistema', { ascending: false }).order('nome');
  if (error) throw error;
  return (data ?? []) as Grupo[];
}

export async function lerUsuarios(): Promise<UsuarioAdmin[]> {
  const { data, error } = await supabase.from('usuarios').select(COLUNAS_USUARIO_ADMIN).order('nome');
  if (error) throw error;
  return (data ?? []) as UsuarioAdmin[];
}

export async function lerArvore(): Promise<NoArvore[]> {
  const { data, error } = await supabase.from('funcoes').select('codigo, pai, tipo, rotulo, descricao, ordem').order('ordem');
  if (error) throw error;
  return (data ?? []) as NoArvore[];
}

/** Recusados que tentaram entrar de novo: ids com alerta de pedido de acesso ainda não lido para mim. */
export async function lerNovasTentativas(): Promise<Set<string>> {
  const { data } = await supabase.from('notificacoes').select('usuario_solicitante_id').eq('tipo', 'pedido_acesso').eq('lida', false);
  return new Set((data ?? []).map((n: { usuario_solicitante_id: string | null }) => n.usuario_solicitante_id).filter((x): x is string => !!x));
}

/**
 * Quantas pessoas estão na lista de espera (para o número no menu).
 * Só consulta quando `ativo` (quem pode aprovar); atualiza a cada minuto e ao voltar para a aba.
 */
export function useEsperando(ativo: boolean): { qtd: number; recarregar: () => void } {
  const [qtd, setQtd] = useState(0);
  const recarregar = useCallback(() => {
    if (!ativo) return;
    void (async () => {
      const [pend, tent] = await Promise.all([
        supabase.from('usuarios').select('id', { count: 'exact', head: true }).eq('status_acesso', 'pendente'),
        lerNovasTentativas(),
      ]);
      let recusadosDeNovo = 0;
      if (tent.size) {
        const { count } = await supabase.from('usuarios').select('id', { count: 'exact', head: true }).eq('status_acesso', 'recusado').in('id', [...tent]);
        recusadosDeNovo = count ?? 0;
      }
      setQtd((pend.count ?? 0) + recusadosDeNovo);
    })();
  }, [ativo]);

  useEffect(() => {
    if (!ativo) {
      setQtd(0);
      return;
    }
    recarregar();
    const t = window.setInterval(recarregar, 60000);
    const aoVoltar = () => document.visibilityState === 'visible' && recarregar();
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [ativo, recarregar]);

  return { qtd, recarregar };
}
