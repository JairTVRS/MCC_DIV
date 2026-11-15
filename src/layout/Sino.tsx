import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { mensagemErro } from '../lib/erros';
import { Icone } from '../lib/icones';
import { supabase } from '../lib/supabase';
import type { Notificacao } from '../lib/tipos';

function quando(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 24 * 60) return `há ${Math.round(min / 60)} h`;
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Para onde cada aviso leva. */
function destino(n: Notificacao): string | null {
  if (n.tipo === 'pedido_acesso') return '#usuarios';
  if (!n.locacao_id) return null;
  if (n.tipo === 'mencao') return `#agenda?r=${n.locacao_id}&aba=comentarios${n.comentario_id ? `&c=${n.comentario_id}` : ''}`;
  return `#agenda?r=${n.locacao_id}&aba=pagamento`;
}

/**
 * Sino de notificações: número de não lidas em tempo real (Realtime, só as do próprio usuário pela RLS)
 * e a lista com menções, pedidos de acesso e parcelas a vencer/vencidas. Clicar abre o lugar certo.
 */
export function Sino({ usuarioId }: { usuarioId: string }) {
  const [naoLidas, setNaoLidas] = useState(0);
  const [lista, setLista] = useState<Notificacao[] | null>(null);
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const abertoRef = useRef(false);
  abertoRef.current = aberto;

  const contar = useCallback(async () => {
    const { count } = await supabase.from('notificacoes').select('id', { count: 'exact', head: true }).eq('usuario_id', usuarioId).eq('lida', false);
    setNaoLidas(count ?? 0);
  }, [usuarioId]);

  const carregarLista = useCallback(async () => {
    const { data, error } = await supabase.rpc('minhas_notificacoes', { p_limite: 30 });
    if (error) {
      setErro(mensagemErro(error));
      setLista([]);
      return;
    }
    setErro(null);
    setLista((data ?? []) as Notificacao[]);
  }, []);

  // Tempo real: qualquer aviso novo (ou marcado como lido em outra aba) atualiza o número.
  useEffect(() => {
    let vivo = true;
    let canal: RealtimeChannel | null = null;
    void contar();
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!vivo) return;
      supabase.realtime.setAuth(data.session?.access_token ?? null);
      canal = supabase
        .channel(`sino-${usuarioId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notificacoes', filter: `usuario_id=eq.${usuarioId}` }, () => {
          void contar();
          if (abertoRef.current) void carregarLista();
        })
        .subscribe();
    })();
    // Garantia se o tempo real cair: confere ao voltar para a aba e a cada 2 minutos.
    const aoVoltar = () => document.visibilityState === 'visible' && void contar();
    document.addEventListener('visibilitychange', aoVoltar);
    const t = window.setInterval(() => void contar(), 120000);
    return () => {
      vivo = false;
      document.removeEventListener('visibilitychange', aoVoltar);
      window.clearInterval(t);
      if (canal) void supabase.removeChannel(canal);
    };
  }, [usuarioId, contar, carregarLista]);

  useEffect(() => {
    if (!aberto) return;
    void carregarLista();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [aberto, carregarLista]);

  async function marcarLidas(ids: string[]) {
    if (!ids.length) return;
    setLista((l) => l?.map((n) => (ids.includes(n.id) ? { ...n, lida: true } : n)) ?? l);
    const { error } = await supabase.from('notificacoes').update({ lida: true }).in('id', ids);
    if (error) setErro(mensagemErro(error));
    await contar();
  }

  function abrir(n: Notificacao) {
    if (!n.lida) void marcarLidas([n.id]);
    const ir = destino(n);
    setAberto(false);
    if (ir) window.location.hash = ir;
  }

  const rc = aberto ? botao.current?.getBoundingClientRect() : undefined;
  const rotulo = naoLidas ? `${naoLidas} notificaç${naoLidas > 1 ? 'ões' : 'ão'} não lida${naoLidas > 1 ? 's' : ''}` : 'Notificações';
  const naoLidasLista = (lista ?? []).filter((n) => !n.lida).map((n) => n.id);

  return (
    <>
      <button ref={botao} className="ib sino" onClick={() => setAberto((v) => !v)} title={rotulo} aria-label={rotulo} aria-expanded={aberto}>
        <Icone nome="sino" />
        {naoLidas > 0 && <span className="sino-qtd">{naoLidas > 99 ? '99+' : naoLidas}</span>}
      </button>
      {aberto && rc && (
        <>
          <div className="scrim clear" onClick={() => setAberto(false)} />
          <div className="pop sino-pop" role="dialog" aria-label="Notificações" style={{ top: rc.bottom + 8, right: Math.max(12, window.innerWidth - rc.right) }}>
            <div className="sino-topo">
              <h4>Notificações</h4>
              <button className="btn peq" onClick={() => void marcarLidas(naoLidasLista)} disabled={!naoLidasLista.length}>
                Marcar todas como lidas
              </button>
            </div>
            {erro && <p className="msg-erro">{erro}</p>}
            {!lista ? (
              <p className="note">Carregando…</p>
            ) : lista.length === 0 ? (
              <p className="vazio">Nenhuma notificação.</p>
            ) : (
              <ul className="sino-lista">
                {lista.map((n) => (
                  <li key={n.id}>
                    <button className={`sino-item tipo-${n.tipo}${n.lida ? '' : ' nova'}`} onClick={() => abrir(n)}>
                      <span className="sino-ic" aria-hidden="true">
                        <Icone nome={n.tipo === 'mencao' ? 'balao' : n.tipo === 'pedido_acesso' ? 'user' : 'relogio'} tamanho={16} />
                      </span>
                      <span className="sino-tx">
                        <strong>{n.titulo}</strong>
                        {n.detalhe && <span>{n.detalhe}</span>}
                        <em>{quando(n.criado_em)}</em>
                      </span>
                      {!n.lida && <i className="dot" aria-label="não lida" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </>
  );
}
