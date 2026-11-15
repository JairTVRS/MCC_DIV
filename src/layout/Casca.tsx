import { useEffect, useRef, useState } from 'react';
import { useSessao } from '../auth/Sessao';
import { Icone } from '../lib/icones';
import { supabase } from '../lib/supabase';
import { aplicarTema, temaEfetivo } from '../lib/tema';
import type { CodigoFuncao, VersaoApp } from '../lib/tipos';
import { Configuracoes } from '../pages/configuracoes/Configuracoes';
import { Usuarios } from '../pages/usuarios/Usuarios';
import { useEsperando } from '../pages/usuarios/dados';
import { APP_VERSION } from '../version';
import { Avatar, fotoDe } from './Avatar';
import { Marca } from './Marca';
import { MeuPerfil } from './MeuPerfil';
import { Online, useOnline } from './Online';
import { TrocarFoto } from './TrocarFoto';

type Pagina = 'agenda' | 'lista' | 'pessoas' | 'usuarios' | 'configuracoes';

// Cada tela abre com a função "Visualizar" do seu módulo na árvore de permissões.
const PAGINAS: { id: Pagina; titulo: string; icone: string; funcao: CodigoFuncao; etapa: string; descricao: string }[] = [
  { id: 'agenda', titulo: 'Agenda', icone: 'cal', funcao: 'reservas.visualizar', etapa: 'Etapas 4 a 6', descricao: 'Visões de mês, semana e dia, com arrastar e soltar e bloqueio de conflito.' },
  { id: 'lista', titulo: 'Lista / Relatório', icone: 'list', funcao: 'lista.visualizar', etapa: 'Etapa 10', descricao: 'Tabela com filtros, colunas de auditoria e exportação.' },
  { id: 'pessoas', titulo: 'Pessoas', icone: 'people', funcao: 'pessoas.visualizar', etapa: 'Etapa 4', descricao: 'Cadastro de locatários e locadores.' },
  { id: 'usuarios', titulo: 'Usuários e Grupos', icone: 'shield', funcao: 'usuarios.visualizar', etapa: 'Etapa 3', descricao: '' },
];

function paginaDaUrl(): Pagina {
  const h = window.location.hash.replace('#', '');
  return (['agenda', 'lista', 'pessoas', 'usuarios', 'configuracoes'] as string[]).includes(h) ? (h as Pagina) : 'agenda';
}

type Janela = 'perfil' | 'foto' | null;

export function Casca() {
  const { usuario, config, tem, sair, atualizarUsuario } = useSessao();
  const [pagina, setPagina] = useState<Pagina>(paginaDaUrl);
  const [menuAberto, setMenuAberto] = useState(false);
  const [avatarAberto, setAvatarAberto] = useState(false);
  const [janela, setJanela] = useState<Janela>(null);
  const [novidades, setNovidades] = useState<VersaoApp[] | null>(null);
  const [tema, setTema] = useState(temaEfetivo());
  const avatarRef = useRef<HTMLButtonElement>(null);
  const veOnline = tem('online.visualizar');
  const online = useOnline(veOnline ? usuario : null);
  const espera = useEsperando(tem('usuarios.aprovar'));

  useEffect(() => {
    const f = () => setPagina(paginaDaUrl());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);

  // Depois de uma atualização, o painel de novidades abre sozinho uma vez para cada usuário.
  useEffect(() => {
    if (usuario && usuario.ultima_versao_vista !== APP_VERSION) void abrirNovidades();
  }, [usuario?.id]);

  // Esc fecha o que estiver aberto por cima.
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setAvatarAberto(false);
      setMenuAberto(false);
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  async function abrirNovidades() {
    const { data } = await supabase.from('versoes_app').select('numero, data_publicacao, itens').order('data_publicacao', { ascending: false }).order('numero', { ascending: false });
    setNovidades((data ?? []) as VersaoApp[]);
  }
  function fecharNovidades() {
    setNovidades(null);
    if (usuario && usuario.ultima_versao_vista !== APP_VERSION) void atualizarUsuario({ ultima_versao_vista: APP_VERSION });
  }

  function ir(p: Pagina) {
    window.location.hash = p;
    setMenuAberto(false);
  }

  function alternarTema() {
    const novo = tema === 'escuro' ? 'claro' : 'escuro';
    aplicarTema(novo);
    setTema(novo);
    void atualizarUsuario({ tema_preferido: novo });
  }

  function abrirJanela(j: Janela) {
    setAvatarAberto(false);
    setJanela(j);
  }

  if (!usuario) return null;
  const visiveis = PAGINAS.filter((p) => tem(p.funcao));
  const emConfig = pagina === 'configuracoes';
  const atual = PAGINAS.find((p) => p.id === pagina) ?? PAGINAS[0];
  const permitido = emConfig ? tem('configuracoes.visualizar') : visiveis.some((p) => p.id === atual.id);
  const titulo = !permitido ? 'Agenda' : emConfig ? 'Configurações' : atual.titulo;
  const foto = fotoDe(usuario);
  const rc = avatarAberto ? avatarRef.current?.getBoundingClientRect() : undefined;

  return (
    <div className="app">
      <aside className={`side${menuAberto ? ' open' : ''}`} aria-label="Menu principal">
        <button className="brand" onClick={() => ir('agenda')} title="Voltar para a agenda">
          <Marca config={config} fundoEscuro />
        </button>
        <nav className="nav">
          {visiveis.map((p) => (
            <button key={p.id} onClick={() => ir(p.id)} aria-current={pagina === p.id ? 'page' : undefined}>
              <Icone nome={p.icone} />
              {p.titulo}
              {p.id === 'usuarios' && espera.qtd > 0 && (
                <span className="badge" title={`${espera.qtd} na lista de espera`} aria-label={`${espera.qtd} na lista de espera`}>
                  {espera.qtd}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="esq">
            <button className="ver" onClick={() => void abrirNovidades()} title="Ver as novidades desta versão">
              {APP_VERSION}
            </button>
            {veOnline && <Online estado={online} euId={usuario.id} />}
          </div>
          {tem('configuracoes.visualizar') && (
            <button
              className="gear"
              onClick={() => ir('configuracoes')}
              title="Configurações do sistema"
              aria-label="Configurações do sistema"
              aria-current={emConfig ? 'page' : undefined}
            >
              <Icone nome="gear" tamanho={20} />
            </button>
          )}
        </div>
      </aside>
      {menuAberto && <div className="scrim" onClick={() => setMenuAberto(false)} />}

      <div className="main">
        <header className="top">
          <button className="ib hamb" onClick={() => setMenuAberto(true)} aria-label="Abrir menu">
            <Icone nome="menu" />
          </button>
          <h1>{titulo}</h1>
          <span className="sp" />
          <button className="ib" onClick={alternarTema} title={tema === 'escuro' ? 'Usar tema claro' : 'Usar tema escuro'} aria-label="Alternar tema">
            <Icone nome={tema === 'escuro' ? 'sun' : 'moon'} />
          </button>
          <button className="avbtn" ref={avatarRef} onClick={() => setAvatarAberto((v) => !v)} aria-label="Menu do usuário" aria-expanded={avatarAberto}>
            <Avatar nome={usuario.nome} foto={foto} />
          </button>
        </header>

        <main className="content">
          {!permitido ? (
            <div className="empty-stage">
              <h2>Sem acesso a esta tela</h2>
              <p>Seu perfil não tem permissão para ver esta área.</p>
            </div>
          ) : emConfig ? (
            <Configuracoes />
          ) : pagina === 'usuarios' ? (
            <Usuarios onMudouEspera={espera.recarregar} />
          ) : (
            <div className="empty-stage">
              <span className="tag">{atual.etapa}</span>
              <h2>{atual.titulo}</h2>
              <p>{atual.descricao}</p>
              <p className="note">Esta tela ainda está em construção. Login, permissões e banco já estão funcionando.</p>
            </div>
          )}
        </main>
      </div>

      {avatarAberto && rc && (
        <>
          <div className="scrim clear" onClick={() => setAvatarAberto(false)} />
          <div className="pop" style={{ top: rc.bottom + 8, right: Math.max(12, window.innerWidth - rc.right) }}>
            <div className="who">
              <Avatar nome={usuario.nome} foto={foto} tamanho={44} />
              <div>
                <strong>{usuario.nome}</strong>
                <span className="note">{usuario.email}</span>
              </div>
            </div>
            <div className="menu">
              <button onClick={() => abrirJanela('perfil')}>
                <Icone nome="user" />
                Meu perfil
              </button>
              <button onClick={() => abrirJanela('foto')}>
                <Icone nome="camera" />
                Trocar foto
              </button>
              <button onClick={() => void sair()}>
                <Icone nome="out" />
                Sair
              </button>
            </div>
          </div>
        </>
      )}

      {janela === 'perfil' && <MeuPerfil onFechar={() => setJanela(null)} onTrocarFoto={() => setJanela('foto')} />}
      {janela === 'foto' && <TrocarFoto onFechar={() => setJanela(null)} />}

      {novidades && (
        <>
          <div className="scrim" onClick={fecharNovidades} />
          <div className="modal" role="dialog" aria-modal="true" aria-label="Novidades">
            <div className="m-head">
              <h2>Novidades</h2>
              <button className="ib" onClick={fecharNovidades} aria-label="Fechar">
                <Icone nome="x" />
              </button>
            </div>
            <div className="m-body">
              {novidades.map((v) => (
                <div className="box" key={v.numero}>
                  <h4>
                    {v.numero} · {new Date(v.data_publicacao + 'T12:00:00').toLocaleDateString('pt-BR')}
                  </h4>
                  <ul>
                    {v.itens.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                </div>
              ))}
              {novidades.length === 0 && <p className="note">Nenhuma novidade registrada.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
