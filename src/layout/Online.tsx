import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { Icone } from '../lib/icones';
import { supabase } from '../lib/supabase';
import type { Usuario, UsuarioOnline } from '../lib/tipos';
import { Avatar, fotoDe } from './Avatar';

/**
 * Presença em tempo real (Supabase Realtime) num canal privado "online".
 * O banco só deixa usuário ativo entrar e ver o canal. Cada pessoa conta uma vez,
 * mesmo com várias abas abertas (a chave da presença é o id do usuário).
 * Devolve null enquanto não conecta ou se o canal falhar.
 */
export function useOnline(usuario: Usuario | null): UsuarioOnline[] | null {
  const [lista, setLista] = useState<UsuarioOnline[] | null>(null);
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
    (async () => {
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
        })
        .subscribe(async (status, err) => {
          if (status === 'SUBSCRIBED') {
            conectadoRef.current = true;
            await canal.track({ id, ...dadosRef.current });
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            conectadoRef.current = false;
            console.warn('[Agenda] Usuários online indisponível:', err?.message ?? status);
            setLista(null);
          }
        });
    })();
    return () => {
      vivo = false;
      conectadoRef.current = false;
      if (canalRef.current) void supabase.removeChannel(canalRef.current);
      canalRef.current = null;
      setLista(null);
    };
  }, [id]);

  // Trocou a foto: os outros veem a nova sem precisar recarregar.
  useEffect(() => {
    if (id && conectadoRef.current && canalRef.current) void canalRef.current.track({ id, nome, foto });
  }, [id, nome, foto]);

  return lista;
}

/** Ícone com o número de pessoas no app agora; clicando, mostra quem são. */
export function Online({ lista, euId }: { lista: UsuarioOnline[] | null; euId: string }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  if (!lista) return null;
  const n = lista.length;
  const rotulo = `${n} ${n === 1 ? 'pessoa' : 'pessoas'} no app agora`;
  const rc = aberto ? ref.current?.getBoundingClientRect() : undefined;

  return (
    <>
      <button ref={ref} className="online" onClick={() => setAberto((v) => !v)} title={rotulo} aria-label={rotulo} aria-expanded={aberto}>
        <Icone nome="people" tamanho={16} />
        <span>{n}</span>
        <i className="dot" aria-hidden="true" />
      </button>
      {aberto && rc && (
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
