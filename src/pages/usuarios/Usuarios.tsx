import { useCallback, useEffect, useState } from 'react';
import { useSessao } from '../../auth/Sessao';
import { mensagemErro } from '../../lib/erros';
import type { Grupo, UsuarioAdmin } from '../../lib/tipos';
import { Grupos } from './Grupos';
import { ListaEspera } from './ListaEspera';
import { ListaUsuarios } from './ListaUsuarios';
import { lerGrupos, lerNovasTentativas, lerUsuarios } from './dados';

type Aba = 'espera' | 'usuarios' | 'grupos';

export interface DadosUsuarios {
  grupos: Grupo[];
  usuarios: UsuarioAdmin[];
  /** Recusados que tentaram entrar de novo (alerta não lido). */
  tentativas: Set<string>;
  /** Eu estou no grupo Administrador. */
  souAdmin: boolean;
  recarregar: () => Promise<void>;
}

function abaLembrada(): Aba {
  try {
    const a = localStorage.getItem('usuarios-aba');
    if (a === 'espera' || a === 'usuarios' || a === 'grupos') return a;
  } catch {
    /* armazenamento indisponível */
  }
  return 'espera';
}

/** Tela "Usuários e Grupos": lista de espera, usuários e grupos com a árvore de permissões. */
export function Usuarios({ onMudouEspera }: { onMudouEspera: () => void }) {
  const { usuario, tem } = useSessao();
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [tentativas, setTentativas] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [escolhida, setEscolhida] = useState<Aba>(abaLembrada);

  const recarregar = useCallback(async () => {
    try {
      const [g, u, t] = await Promise.all([lerGrupos(), lerUsuarios(), lerNovasTentativas()]);
      setGrupos(g);
      setUsuarios(u);
      setTentativas(t);
      setErro(null);
    } catch (e) {
      setErro(mensagemErro(e));
      setGrupos((g) => g ?? []);
    }
    onMudouEspera();
  }, [onMudouEspera]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const esperando = usuarios.filter((u) => u.status_acesso === 'pendente' || (u.status_acesso === 'recusado' && tentativas.has(u.id)));
  const abas: { id: Aba; titulo: string; qtd?: number }[] = [
    ...(tem('usuarios.aprovar') ? [{ id: 'espera' as const, titulo: 'Lista de espera', qtd: esperando.length }] : []),
    { id: 'usuarios', titulo: 'Usuários' },
    { id: 'grupos', titulo: 'Grupos e permissões' },
  ];
  const aba = abas.some((a) => a.id === escolhida) ? escolhida : abas[0].id;

  function trocar(a: Aba) {
    setEscolhida(a);
    try {
      localStorage.setItem('usuarios-aba', a);
    } catch {
      /* armazenamento indisponível */
    }
  }

  if (!grupos || !usuario) return <p className="note">Carregando…</p>;
  const grupoAdmin = grupos.find((g) => g.sistema);
  const dados: DadosUsuarios = { grupos, usuarios, tentativas, souAdmin: !!grupoAdmin && usuario.perfil_id === grupoAdmin.id, recarregar };

  return (
    <div className="pagina larga">
      <div className="tabs" role="tablist" aria-label="Seções de usuários e grupos">
        {abas.map((a) => (
          <button key={a.id} role="tab" id={`aba-${a.id}`} aria-selected={aba === a.id} aria-controls={`painel-${a.id}`} onClick={() => trocar(a.id)}>
            {a.titulo}
            {!!a.qtd && <span className="badge">{a.qtd}</span>}
          </button>
        ))}
      </div>
      {erro && (
        <p className="msg-erro" role="alert">
          {erro}
        </p>
      )}
      <div role="tabpanel" id={`painel-${aba}`} aria-labelledby={`aba-${aba}`}>
        {aba === 'espera' && <ListaEspera dados={dados} esperando={esperando} />}
        {aba === 'usuarios' && <ListaUsuarios dados={dados} />}
        {aba === 'grupos' && <Grupos dados={dados} />}
      </div>
    </div>
  );
}
