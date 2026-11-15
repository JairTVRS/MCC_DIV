import { useState } from 'react';
import { useSessao } from '../../auth/Sessao';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import type { StatusAcesso, UsuarioAdmin } from '../../lib/tipos';
import { Avatar, fotoDe } from '../../layout/Avatar';
import type { DadosUsuarios } from './Usuarios';
import { SITUACAO, dataHora } from './dados';

type Filtro = StatusAcesso | 'todos';
const FILTROS: { id: Filtro; rotulo: string }[] = [
  { id: 'ativo', rotulo: 'Ativos' },
  { id: 'inativo', rotulo: 'Inativos' },
  { id: 'recusado', rotulo: 'Recusados' },
  { id: 'pendente', rotulo: 'Aguardando' },
  { id: 'todos', rotulo: 'Todos' },
];

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Todos os usuários, com filtro por situação e busca; clicando, abre o detalhe. */
export function ListaUsuarios({ dados }: { dados: DadosUsuarios }) {
  const { usuario } = useSessao();
  const [filtro, setFiltro] = useState<Filtro>('ativo');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);
  const nomeGrupo = (id: string | null) => dados.grupos.find((g) => g.id === id)?.nome ?? '—';

  const qtd = (f: Filtro) => (f === 'todos' ? dados.usuarios.length : dados.usuarios.filter((u) => u.status_acesso === f).length);
  const termo = semAcento(busca.trim());
  const visiveis = dados.usuarios.filter(
    (u) => (filtro === 'todos' || u.status_acesso === filtro) && (!termo || semAcento(`${u.nome} ${u.email}`).includes(termo)),
  );
  const selecionado = dados.usuarios.find((u) => u.id === aberto) ?? null;

  return (
    <section className="secao">
      <h3>Usuários</h3>
      <div className="filtros">
        <div className="chips" role="group" aria-label="Filtrar por situação">
          {FILTROS.map((f) => (
            <button key={f.id} className="chip" aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}>
              {f.rotulo} · {qtd(f.id)}
            </button>
          ))}
        </div>
        <input className="inp busca" type="search" value={busca} placeholder="Buscar por nome ou e-mail" aria-label="Buscar usuário" onChange={(e) => setBusca(e.target.value)} />
      </div>

      {visiveis.length === 0 ? (
        <p className="vazio">Nenhum usuário encontrado.</p>
      ) : (
        <ul className="linhas">
          {visiveis.map((u) => (
            <li key={u.id}>
              <button className="linha clicavel" onClick={() => setAberto(u.id)}>
                <Avatar nome={u.nome} foto={fotoDe(u)} tamanho={36} />
                <span className="tx">
                  <strong>
                    {u.nome}
                    {u.id === usuario?.id && <span className="tag mini">você</span>}
                  </strong>
                  <span>{u.email}</span>
                </span>
                <span className="col-grupo">{nomeGrupo(u.perfil_id)}</span>
                <span className="situacao" style={{ color: SITUACAO[u.status_acesso].cor }}>
                  {SITUACAO[u.status_acesso].rotulo}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selecionado && <DetalheUsuario u={selecionado} dados={dados} onFechar={() => setAberto(null)} />}
    </section>
  );
}

/** Detalhe de um usuário: nome, grupo e situação, conforme as funções liberadas para quem está vendo. */
function DetalheUsuario({ u, dados, onFechar }: { u: UsuarioAdmin; dados: DadosUsuarios; onFechar: () => void }) {
  const { usuario, tem } = useSessao();
  const [nome, setNome] = useState(u.nome);
  const [grupo, setGrupo] = useState(u.perfil_id ?? '');
  const [motivo, setMotivo] = useState('');
  const [confirmar, setConfirmar] = useState<'inativar' | 'recusar' | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const souEu = u.id === usuario?.id;
  const grupoAdmin = dados.grupos.find((g) => g.sistema)?.id;
  const alvoAdmin = u.perfil_id === grupoAdmin;
  const bloqueadoAdmin = alvoAdmin && !dados.souAdmin; // só administrador mexe em administrador
  const podeEditar = tem('usuarios.editar') && !bloqueadoAdmin;
  const podeAtivar = tem('usuarios.ativar') && !souEu && !bloqueadoAdmin;
  const podeAprovar = tem('usuarios.aprovar') && !souEu;
  const decididoPor = dados.usuarios.find((x) => x.id === u.decidido_por)?.nome;
  const gruposEscolha = dados.grupos.filter((g) => !g.sistema || dados.souAdmin || g.id === u.perfil_id);
  const aguardando = u.status_acesso === 'pendente' || u.status_acesso === 'recusado';
  const mudouDados = nome.trim() !== u.nome || (!aguardando && grupo !== (u.perfil_id ?? ''));

  async function gravar(campos: Partial<UsuarioAdmin>) {
    setOcupado(true);
    setErro(null);
    const { error } = await supabase.from('usuarios').update(campos).eq('id', u.id);
    setOcupado(false);
    if (error) {
      setErro(mensagemErro(error));
      return false;
    }
    setConfirmar(null);
    await dados.recarregar();
    return true;
  }

  function salvarDados() {
    const campos: Partial<UsuarioAdmin> = {};
    if (nome.trim() !== u.nome) campos.nome = nome.trim();
    if (!aguardando && grupo !== (u.perfil_id ?? '')) campos.perfil_id = grupo || null;
    void gravar(campos);
  }

  return (
    <>
      <div className="scrim" onClick={ocupado ? undefined : onFechar} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Usuário ${u.nome}`}>
        <div className="m-head">
          <h2>Usuário</h2>
          <button className="ib" onClick={onFechar} aria-label="Fechar" disabled={ocupado}>
            <Icone nome="x" />
          </button>
        </div>
        <div className="m-body">
          <div className="usuario-topo">
            <Avatar nome={u.nome} foto={fotoDe(u)} tamanho={64} />
            <div className="tx">
              <strong>{u.nome}</strong>
              <span>{u.email}</span>
              <span className="situacao" style={{ color: SITUACAO[u.status_acesso].cor }}>
                {SITUACAO[u.status_acesso].rotulo}
              </span>
            </div>
          </div>

          <label className="campo">
            <span className="rot">Nome</span>
            <input className="inp" value={nome} maxLength={80} disabled={!podeEditar || ocupado} onChange={(e) => setNome(e.target.value)} />
          </label>
          <label className="campo">
            <span className="rot">Grupo</span>
            <select className="inp" value={grupo} disabled={souEu || ocupado || (aguardando ? !podeAprovar : !podeEditar)} onChange={(e) => setGrupo(e.target.value)}>
              <option value="">{aguardando ? 'Escolha o grupo…' : 'Sem grupo'}</option>
              {gruposEscolha.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nome}
                </option>
              ))}
            </select>
          </label>
          {souEu && <p className="note">Você não pode alterar o seu próprio acesso ou grupo.</p>}
          {bloqueadoAdmin && <p className="note">Só um administrador pode alterar outro administrador.</p>}

          <dl className="dados">
            <div>
              <dt>Pediu acesso</dt>
              <dd>{dataHora(u.solicitado_em)}</dd>
            </div>
            {u.decidido_em && (
              <div>
                <dt>Decidido</dt>
                <dd>
                  {dataHora(u.decidido_em)}
                  {decididoPor ? ` por ${decididoPor}` : ''}
                </dd>
              </div>
            )}
            {u.status_acesso === 'recusado' && u.motivo_recusa && (
              <div>
                <dt>Motivo</dt>
                <dd>{u.motivo_recusa}</dd>
              </div>
            )}
          </dl>

          {confirmar === 'recusar' && (
            <input className="inp" value={motivo} maxLength={200} placeholder="Motivo da recusa (opcional)" aria-label="Motivo da recusa" onChange={(e) => setMotivo(e.target.value)} />
          )}
          {erro && (
            <p className="msg-erro" role="alert">
              {erro}
            </p>
          )}
        </div>
        <div className="m-foot">
          {u.status_acesso === 'ativo' && podeAtivar &&
            (confirmar === 'inativar' ? (
              <>
                <button className="btn" onClick={() => setConfirmar(null)} disabled={ocupado}>
                  Voltar
                </button>
                <button className="btn perigo" onClick={() => void gravar({ status_acesso: 'inativo' })} disabled={ocupado}>
                  Confirmar inativação
                </button>
              </>
            ) : (
              <button className="btn" onClick={() => setConfirmar('inativar')} disabled={ocupado} title="Tira o acesso na hora, sem apagar o histórico">
                Inativar
              </button>
            ))}
          {u.status_acesso === 'inativo' && podeAtivar && (
            <button className="btn" onClick={() => void gravar({ status_acesso: 'ativo' })} disabled={ocupado}>
              Reativar
            </button>
          )}
          {aguardando && podeAprovar && (
            <>
              <button className="btn pri" onClick={() => void gravar({ status_acesso: 'ativo', perfil_id: grupo || null })} disabled={!grupo || ocupado}>
                Aprovar no grupo
              </button>
              {u.status_acesso === 'pendente' &&
                (confirmar === 'recusar' ? (
                  <button className="btn perigo" onClick={() => void gravar({ status_acesso: 'recusado', motivo_recusa: motivo.trim() || null })} disabled={ocupado}>
                    Confirmar recusa
                  </button>
                ) : (
                  <button className="btn" onClick={() => setConfirmar('recusar')} disabled={ocupado}>
                    Recusar
                  </button>
                ))}
            </>
          )}
          <span className="sp" />
          {(podeEditar || mudouDados) && (
            <button className="btn pri" onClick={salvarDados} disabled={!mudouDados || ocupado || !nome.trim()}>
              {ocupado ? 'Salvando…' : 'Salvar'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
