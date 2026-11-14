import { useEffect, useState } from 'react';
import { useSessao } from '../auth/Sessao';
import { Icone } from '../lib/icones';
import { supabase } from '../lib/supabase';
import { Avatar, fotoDe } from './Avatar';

/** Dados do próprio usuário, só leitura. O nome só muda com a liberação de um administrador. */
export function MeuPerfil({ onFechar, onTrocarFoto }: { onFechar: () => void; onTrocarFoto: () => void }) {
  const { usuario } = useSessao();
  const [grupo, setGrupo] = useState<string | null>(null);

  useEffect(() => {
    if (!usuario?.perfil_id) return;
    void supabase
      .from('perfis')
      .select('nome')
      .eq('id', usuario.perfil_id)
      .maybeSingle()
      .then(({ data }) => setGrupo((data as { nome: string } | null)?.nome ?? null));
  }, [usuario?.perfil_id]);

  if (!usuario) return null;
  return (
    <>
      <div className="scrim" onClick={onFechar} />
      <div className="modal estreito" role="dialog" aria-modal="true" aria-label="Meu perfil">
        <div className="m-head">
          <h2>Meu perfil</h2>
          <button className="ib" onClick={onFechar} aria-label="Fechar">
            <Icone nome="x" />
          </button>
        </div>
        <div className="m-body">
          <div className="perfil-topo">
            <Avatar nome={usuario.nome} foto={fotoDe(usuario)} tamanho={88} />
            <button className="btn peq" onClick={onTrocarFoto}>
              <Icone nome="camera" tamanho={16} />
              Trocar foto
            </button>
          </div>
          <dl className="dados">
            <div>
              <dt>Nome</dt>
              <dd>{usuario.nome}</dd>
            </div>
            <div>
              <dt>E-mail</dt>
              <dd>{usuario.email}</dd>
            </div>
            <div>
              <dt>Grupo</dt>
              <dd>{grupo ?? '—'}</dd>
            </div>
            <div>
              <dt>Situação</dt>
              <dd>Ativo</dd>
            </div>
          </dl>
          <p className="note">O nome vem da sua conta Google. Para alterar, fale com um administrador.</p>
        </div>
      </div>
    </>
  );
}
