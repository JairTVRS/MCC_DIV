import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { Icone } from '../lib/icones';
import { supabase } from '../lib/supabase';
import type { Usuario, UsuarioOnline } from '../lib/tipos';
import { Avatar, fotoDe } from './Avatar';

export interface EstadoOnline {
  /** Quem está no app agora; null enquanto conecta ou se o canal falhou. */
  lista: UsuarioOnline[] | null;
  /** Motivo da falha do canal, para mostrar no ícone. */
  erro: string | null;
}

/**
 * Presença em tempo real (Supabase Realtime) num canal privado "online".
 * O banco só deixa usuário ativo entrar e ver o canal. Cada pessoa conta uma vez,
 * mesmo com várias abas abertas (a chave da presença é o id do usuário).
 */
export function useOnline(usuario: Usuario | null): EstadoOnline {
  const [lista, setLista] = useState<UsuarioOnline[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const canalRef = useRef<RealtimeChannel | null>(null);
  const conectadoRef = useRef(false);
  const id = usuario?.id;
  const nome = usuario?.nome ?? '';
  const foto = usuario ? fotoDe(usuario) : null;
  const dadosRef = useRef({ nome, foto });
  dadosRef.current = { nome, foto };

  useEffect(() => {
    if (!id) return;
    let vivo = true;
    let espera: number | undefined;
    let tentativas = 0;

    // Se o canal falhar, tenta de novo sozinho: 5 s, 10 s, 20 s… até 1 minuto entre tentativas.
    const tentarDeNovo = (canal: RealtimeChannel) => {
      if (espera !== undefined || !vivo) return;
      conectadoRef.current = false;
      if (canalRef.current === canal) canalRef.current = null;
      void supabase.removeChannel(canal);
      const ms = Math.min(60000, 5000 * 2 ** tentativas++);
      espera = window.setTimeout(() => {
        espera = undefined;
        void conectar();
      }, ms);
    };

    const conectar = async () => {
      // O canal privado precisa do token do usuário logado.
      const { data } = await supabase.auth.getSession();
      if (!vivo) return;
      supabase.realtime.setAuth(data.session?.access_token ?? null);
      const canal = supabase.channel('online', { config: { private: true, presence: { key: id } } });
      canalRef.current = canal;
      canal
        .on('presence', { event: 'sync' }, () => {
          const estado = canal.presenceState<UsuarioOnline>();
          const pessoas = Object.values(estado)
            .map((metas) => metas[0])
            .filter((m): m is UsuarioOnline & { presence_ref: string } => !!m && !!m.id)
            .map((m) => ({ id: m.id, nome: m.nome, foto: m.foto }))
            .sort((a, b) => (a.id === id ? -1 : b.id === id ? 1 : a.nome.localeCompare(b.nome, 'pt-BR')));
          setLista(pessoas);
          setErro(null);
        })
        .subscribe(async (status, err) => {
          if (!vivo || canalRef.current !== canal) return;
          if (status === 'SUBSCRIBED') {
            tentativas = 0;
            conectadoRef.current = true;
            setErro(null);
            const r = await canal.track({ id, ...dadosRef.current });
            if (r !== 'ok') console.warn('[Agenda] Usuários online: presença não registrada:', r);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            const motivo = err?.message ?? (status === 'TIMED_OUT' ? 'tempo esgotado' : 'canal recusado');
            console.warn('[Agenda] Usuários online indisponível; tentando de novo:', motivo);
            setLista(null);
            setErro(motivo);
            tentarDeNovo(canal);
          }
        });
    };

    void conectar();
    return () => {
      vivo = false;
      window.clearTimeout(espera);
      conectadoRef.current = false;
      if (canalRef.current) void supabase.removeChannel(canalRef.current);
      canalRef.current = null;
      setLista(null);
      setErro(null);
    };
  }, [id]);

  // Trocou a foto: os outros veem a nova sem precisar recarregar.
  useEffect(() => {
    if (id && conectadoRef.current && canalRef.current) void canalRef.current.track({ id, nome, foto });
  }, [id, nome, foto]);

  return { lista, erro };
}

/** Ícone com o número de pessoas no app agora; clicando, mostra quem são. */
export function Online({ estado, euId }: { estado: EstadoOnline; euId: string }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const { lista, erro } = estado;
  const n = lista?.length ?? 0;
  const rotulo = lista
    ? `${n} ${n === 1 ? 'pessoa' : 'pessoas'} no app agora`
    : erro
      ? `Usuários online indisponível (${erro})`
      : 'Conectando aos usuários online…';
  const rc = aberto && lista ? ref.current?.getBoundingClientRect() : undefined;

  return (
    <>
      <button
        ref={ref}
        className={`online${lista ? '' : ' fora'}`}
        onClick={() => lista && setAberto((v) => !v)}
        title={rotulo}
        aria-label={rotulo}
        aria-expanded={lista ? aberto : undefined}
      >
        <Icone nome="people" tamanho={16} />
        <span>{lista ? n : erro ? '–' : '…'}</span>
        {lista && <i className="dot" aria-hidden="true" />}
      </button>
      {rc && lista && (
        <>
          <div className="scrim clear alto" onClick={() => setAberto(false)} />
          <div className="pop alto" role="dialog" aria-label="Usuários online" style={{ bottom: window.innerHeight - rc.top + 8, left: Math.max(12, rc.left) }}>
            <h4>Online agora · {n}</h4>
            <ul className="lista">
              {lista.map((p) => (
                <li key={p.id}>
                  <Avatar nome={p.nome} foto={p.foto} tamanho={30} />
                  <span className="nm-online">{p.nome}</span>
                  {p.id === euId && <span className="tag">você</span>}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
