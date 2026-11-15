import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import { agrupar, carregarContexto, type Evento, type GrupoEventos } from './eventos';

/** O que mostrar: a reserva (pelo log dela) ou um registro (pessoa, usuário, grupo) pela função historico(). */
export type AlvoHistorico =
  | { tipo: 'reserva'; id: string }
  | { tipo: 'pessoa'; id: string }
  | { tipo: 'usuario'; id: string }
  | { tipo: 'grupo'; id: string };

const TITULO: Record<AlvoHistorico['tipo'], string> = {
  reserva: 'Histórico da reserva',
  pessoa: 'Histórico da pessoa',
  usuario: 'Histórico do usuário',
  grupo: 'Histórico do grupo',
};

async function buscar(alvo: AlvoHistorico): Promise<Evento[]> {
  if (alvo.tipo === 'reserva') {
    const { data, error } = await supabase
      .from('log_eventos')
      .select('id, tabela, registro_id, locacao_id, usuario_id, acao, campo, valor_anterior, valor_novo, data_hora')
      .eq('locacao_id', alvo.id)
      .order('data_hora', { ascending: false })
      .order('id', { ascending: false })
      .limit(500);
    if (error) throw error;
    return (data ?? []) as Evento[];
  }
  const tabelas = alvo.tipo === 'pessoa' ? ['pessoas'] : alvo.tipo === 'usuario' ? ['usuarios'] : ['perfis', 'grupo_funcoes'];
  const { data, error } = await supabase.rpc('historico', { p_tabelas: tabelas, p_registro: alvo.id, p_limite: 500 });
  if (error) throw error;
  return (data ?? []) as Evento[];
}

/** Janela com o histórico (log imutável): uma linha por gravação, mais recente primeiro. */
export function JanelaHistorico({ alvo, nome, onFechar }: { alvo: AlvoHistorico; nome?: string; onFechar: () => void }) {
  const [grupos, setGrupos] = useState<GrupoEventos[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [eventos, ctx] = await Promise.all([buscar(alvo), carregarContexto(alvo.tipo === 'reserva' ? alvo.id : undefined)]);
        setGrupos(agrupar(eventos, ctx));
      } catch (e) {
        setErro(mensagemErro(e));
        setGrupos([]);
      }
    })();
  }, [alvo]);

  return createPortal(
    <>
      <div className="scrim alto" onClick={onFechar} />
      <div className="modal alto historico" role="dialog" aria-modal="true" aria-label={TITULO[alvo.tipo]}>
        <div className="m-head">
          <h2>
            {TITULO[alvo.tipo]}
            {nome && <span className="m-sub">{nome}</span>}
          </h2>
          <button type="button" className="ib" onClick={onFechar} aria-label="Fechar">
            <Icone nome="x" />
          </button>
        </div>
        <div className="m-body">
          <p className="note">Registro permanente: ninguém altera nem apaga o histórico, nem o administrador.</p>
          {erro && (
            <p className="msg-erro" role="alert">
              {erro}
            </p>
          )}
          {!grupos ? <p className="note">Carregando…</p> : grupos.length === 0 ? <p className="vazio">Nenhum evento registrado.</p> : <ListaEventos grupos={grupos} />}
        </div>
      </div>
    </>,
    document.body,
  );
}

/** Linhas do histórico: quando · quem · o que (e, no geral, de qual registro). */
export function ListaEventos({ grupos, comRegistro, onAbrirReserva }: { grupos: GrupoEventos[]; comRegistro?: boolean; onAbrirReserva?: (id: string) => void }) {
  return (
    <ol className={`eventos${comRegistro ? ' com-registro' : ''}`}>
      {grupos.map((g) => (
        <li key={g.chave}>
          <span className="ev-quando">{g.quando}</span>
          <span className="ev-quem">{g.quem}</span>
          <span className="ev-tx">
            {g.titulo}
            {comRegistro && g.registro && (
              <>
                {' · '}
                {g.locacaoId && onAbrirReserva ? (
                  <button type="button" className="ev-link" onClick={() => onAbrirReserva(g.locacaoId!)} title="Abrir a reserva">
                    {g.registro}
                  </button>
                ) : (
                  <em>{g.registro}</em>
                )}
              </>
            )}
            {g.linhas.length > 0 && <span className="ev-campos">: {g.linhas.join(' · ')}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
