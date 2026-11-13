import { useEffect, useRef, useState } from 'react';
import { useSessao } from '../auth/Sessao';
import { Icone } from '../lib/icones';
import { supabase } from '../lib/supabase';
import { aplicarTema, temaEfetivo } from '../lib/tema';
import type { Modulo, VersaoApp } from '../lib/tipos';
import { APP_VERSION } from '../version';
import { Marca } from './Marca';

type Pagina = 'agenda' | 'lista' | 'pessoas' | 'usuarios' | 'configuracoes';

const PAGINAS: { id: Pagina; titulo: string; icone: string; modulo: Modulo; etapa: string; descricao: string }[] = [
  { id: 'agenda', titulo: 'Agenda', icone: 'cal', modulo: 'reservas', etapa: 'Etapas 4 a 6', descricao: 'Visões de mês, semana e dia, com arrastar e soltar e bloqueio de conflito.' },
  { id: 'lista', titulo: 'Lista / Relatório', icone: 'list', modulo: 'reservas', etapa: 'Etapa 10', descricao: 'Tabela com filtros, colunas de auditoria e exportação.' },
  { id: 'pessoas', titulo: 'Pessoas', icone: 'people', modulo: 'pessoas', etapa: 'Etapa 4', descricao: 'Cadastro de locatários e locadores.' },
  { id: 'usuarios', titulo: 'Usuários e Perfis', icone: 'shield', modulo: 'usuarios', etapa: 'Etapa 3', descricao: 'Aprovação de acesso, status ativo/inativo, perfis e permissões.' },
];

const CONFIG = { id: 'configuracoes' as const, titulo: 'Configurações', etapa: 'Etapa 2', descricao: 'Nome e logo do app, formas de pagamento e lixeira de exclusões.' };

function paginaDaUrl(): Pagina {
  const h = window.location.hash.replace('#', '');
  return (['agenda', 'lista', 'pessoas', 'usuarios', 'configuracoes'] as string[]).includes(h) ? (h as Pagina) : 'agenda';
}

export function Casca() {
  const { usuario, config, pode, sair, atualizarUsuario } = useSessao();
  const [pagina, setPagina] = useState<Pagina>(paginaDaUrl);
  const [menuAberto, setMenuAberto] = useState(false);
  const [avatarAberto, setAvatarAberto] = useState(false);
  const [novidades, setNovidades] = useState<VersaoApp[] | null>(null);
  const [tema, setTema] = useState(temaEfetivo());
  const avatarRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const f = () => setPagina(paginaDaUrl());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);

  // Depois de uma atualização, o painel de novidades abre sozinho uma vez para cada usuário.
  useEffect(() => {
    if (usuario && usuario.ultima_versao_vista !== APP_VERSION) void abrirNovidades();
  }, [usuario?.id]);

  async function abrirNovidades() {
    const { data } = await supabase.from('versoes_app').select('numero, data_publicacao, itens').order('data_publicacao', { ascending: false });
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

  if (!usuario) return null;
  const visiveis = PAGINAS.filter((p) => pode(p.modulo, 'visualizar'));
  const atual = pagina === 'configuracoes' ? CONFIG : PAGINAS.find((p) => p.id === pagina) ?? PAGINAS[0];
  const permitido = pagina === 'configuracoes' ? pode('configuracoes', 'visualizar') : visiveis.some((p) => p.id === atual.id);
  const foto = usuario.usar_foto_upload && usuario.foto_upload ? usuario.foto_upload : usuario.foto_google;
  const iniciais = usuario.nome.split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase() || '?';
  const rc = avatarRef.current?.getBoundingClientRect();

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
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <button className="ver" onClick={() => void abrirNovidades()} title="Ver as novidades desta versão">
            {APP_VERSION}
          </button>
          {pode('configuracoes', 'visualizar') && (
            <button className="gear" onClick={() => ir('configuracoes')} title="Configurações do sistema" aria-label="Configurações do sistema">
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
          <h1>{permitido ? atual.titulo : 'Agenda'}</h1>
          <span className="sp" />
          <button className="ib" onClick={alternarTema} title={tema === 'escuro' ? 'Usar tema claro' : 'Usar tema escuro'} aria-label="Alternar tema">
            <Icone nome={tema === 'escuro' ? 'sun' : 'moon'} />
          </button>
          <button className="avbtn" ref={avatarRef} onClick={() => setAvatarAberto((v) => !v)} aria-label="Menu do usuário">
            <span className="av">{foto ? <img src={foto} alt="" referrerPolicy="no-referrer" /> : iniciais}</span>
          </button>
        </header>

        <main className="content">
          {permitido ? (
            <div className="empty-stage">
              <span className="tag">{atual.etapa}</span>
              <h2>{atual.titulo}</h2>
              <p>{atual.descricao}</p>
              <p className="note">Esta tela ainda está em construção. Login, permissões e banco já estão funcionando.</p>
            </div>
          ) : (
            <div className="empty-stage">
              <h2>Sem acesso a esta tela</h2>
              <p>Seu perfil não tem permissão para ver esta área.</p>
            </div>
          )}
        </main>
      </div>

      {avatarAberto && rc && (
        <>
          <div className="scrim clear" onClick={() => setAvatarAberto(false)} />
          <div className="pop" style={{ top: rc.bottom + 8, right: Math.max(12, window.innerWidth - rc.right) }}>
            <div className="who">
              <span className="av" style={{ width: 44, height: 44 }}>
                {foto ? <img src={foto} alt="" referrerPolicy="no-referrer" /> : iniciais}
              </span>
              <div>
                <strong>{usuario.nome}</strong>
                <span className="note">{usuario.email}</span>
              </div>
            </div>
            <div className="menu">
              <button onClick={() => void sair()}>
                <Icone nome="out" />
                Sair
              </button>
            </div>
          </div>
        </>
      )}

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
