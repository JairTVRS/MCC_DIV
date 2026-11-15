import { useEffect, useState, type FormEvent } from 'react';
import { useSessao } from '../../auth/Sessao';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import type { NoArvore } from '../../lib/tipos';
import { ArvorePermissoes } from './ArvorePermissoes';
import type { DadosUsuarios } from './Usuarios';
import { lerArvore } from './dados';

/** Grupos de usuários: lista à esquerda; à direita, nome, descrição e a árvore de permissões do grupo escolhido. */
export function Grupos({ dados }: { dados: DadosUsuarios }) {
  const { usuario, tem, recarregarPermissoes } = useSessao();
  const podeGerenciar = tem('usuarios.grupos');
  const [arvore, setArvore] = useState<NoArvore[] | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>(dados.grupos[0]?.id ?? null);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    lerArvore().then(setArvore, (e) => setErro(mensagemErro(e)));
  }, []);

  const qtdUsuarios = (id: string) => dados.usuarios.filter((u) => u.perfil_id === id && u.status_acesso !== 'recusado').length;
  const grupo = dados.grupos.find((g) => g.id === selecionado) ?? null;

  async function aoMudar(id: string | null, meuGrupo: boolean) {
    await dados.recarregar();
    if (meuGrupo) await recarregarPermissoes();
    setSelecionado(id);
  }

  return (
    <div className="grupos">
      <section className="secao grupos-lista">
        <h3>Grupos</h3>
        <ul className="linhas">
          {dados.grupos.map((g) => (
            <li key={g.id}>
              <button className={`linha clicavel${g.id === selecionado ? ' ativa' : ''}`} onClick={() => { setSelecionado(g.id); setCriando(false); }}>
                <span className="tx">
                  <strong>{g.nome}</strong>
                  <span>
                    {qtdUsuarios(g.id)} {qtdUsuarios(g.id) === 1 ? 'usuário' : 'usuários'}
                  </span>
                </span>
                {g.sistema && <span className="tag mini">tem tudo</span>}
                {g.id === usuario?.perfil_id && <span className="tag mini">seu grupo</span>}
              </button>
            </li>
          ))}
        </ul>
        {podeGerenciar && (
          <button className="btn" onClick={() => setCriando(true)}>
            <Icone nome="plus" tamanho={16} />
            Novo grupo
          </button>
        )}
      </section>

      <div className="grupos-editor">
        {erro && (
          <p className="msg-erro" role="alert">
            {erro}
          </p>
        )}
        {criando ? (
          <NovoGrupo dados={dados} onCancelar={() => setCriando(false)} onCriado={(id) => { setCriando(false); void aoMudar(id, false); }} />
        ) : grupo && arvore ? (
          <EditorGrupo
            key={grupo.id}
            grupoId={grupo.id}
            dados={dados}
            arvore={arvore}
            podeGerenciar={podeGerenciar}
            qtdUsuarios={qtdUsuarios(grupo.id)}
            onSalvo={(meu) => void aoMudar(grupo.id, meu)}
            onExcluido={() => void aoMudar(dados.grupos.find((g) => g.id !== grupo.id)?.id ?? null, false)}
          />
        ) : (
          <p className="note">Carregando…</p>
        )}
      </div>
    </div>
  );
}

function EditorGrupo(props: {
  grupoId: string;
  dados: DadosUsuarios;
  arvore: NoArvore[];
  podeGerenciar: boolean;
  qtdUsuarios: number;
  onSalvo: (meuGrupo: boolean) => void;
  onExcluido: () => void;
}) {
  const { grupoId, dados, arvore, podeGerenciar, qtdUsuarios, onSalvo, onExcluido } = props;
  const { usuario } = useSessao();
  const grupo = dados.grupos.find((g) => g.id === grupoId)!;
  const [nome, setNome] = useState(grupo.nome);
  const [descricao, setDescricao] = useState(grupo.descricao ?? '');
  const [salvas, setSalvas] = useState<Set<string> | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const editavel = podeGerenciar && !grupo.sistema;
  const meuGrupo = usuario?.perfil_id === grupo.id;

  useEffect(() => {
    void supabase
      .from('grupo_funcoes')
      .select('funcao')
      .eq('perfil_id', grupoId)
      .then(({ data, error }) => {
        if (error) setErro(mensagemErro(error));
        const s = new Set((data ?? []).map((f: { funcao: string }) => f.funcao));
        setSalvas(s);
        setMarcadas(new Set(s));
      });
  }, [grupoId]);

  if (!salvas) return <p className="note">Carregando…</p>;

  const liberar = [...marcadas].filter((f) => !salvas.has(f));
  const retirar = [...salvas].filter((f) => !marcadas.has(f));
  const mudouCab = nome.trim() !== grupo.nome || (descricao.trim() || null) !== (grupo.descricao ?? null);
  const sujo = mudouCab || liberar.length > 0 || retirar.length > 0;

  async function salvar() {
    setOcupado(true);
    setErro(null);
    setOk(null);
    try {
      if (mudouCab) {
        const { error } = await supabase.from('perfis').update({ nome: nome.trim(), descricao: descricao.trim() || null }).eq('id', grupo.id);
        if (error) throw error;
      }
      if (retirar.length) {
        const { error } = await supabase.from('grupo_funcoes').delete().eq('perfil_id', grupo.id).in('funcao', retirar);
        if (error) throw error;
      }
      if (liberar.length) {
        const { error } = await supabase.from('grupo_funcoes').insert(liberar.map((funcao) => ({ perfil_id: grupo.id, funcao })));
        if (error) throw error;
      }
      setSalvas(new Set(marcadas));
      setOk('Grupo salvo.');
      onSalvo(meuGrupo);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function excluir() {
    setOcupado(true);
    setErro(null);
    const { error } = await supabase.from('perfis').delete().eq('id', grupo.id);
    setOcupado(false);
    if (error) {
      setErro(mensagemErro(error));
      setConfirmarExclusao(false);
      return;
    }
    onExcluido();
  }

  const totalFuncoes = arvore.filter((n) => n.tipo === 'funcao').length;

  return (
    <section className="secao">
      <div className="grupo-cab">
        <h3>{grupo.nome}</h3>
        <span className="note">
          {marcadas.size} de {totalFuncoes} funções liberadas
        </span>
      </div>
      {grupo.sistema && <p className="aviso">O grupo Administrador sempre tem todas as permissões e não pode ser renomeado nem excluído.</p>}
      {meuGrupo && editavel && <p className="aviso">Este é o seu grupo: o que você mudar aqui vale para você também.</p>}

      <div className="grupo-campos">
        <label className="campo">
          <span className="rot">Nome</span>
          <input className="inp" value={nome} maxLength={40} disabled={!editavel || ocupado} onChange={(e) => setNome(e.target.value)} />
        </label>
        <label className="campo">
          <span className="rot">Descrição</span>
          <input className="inp" value={descricao} maxLength={160} placeholder="Para que serve este grupo" disabled={!podeGerenciar || grupo.sistema || ocupado} onChange={(e) => setDescricao(e.target.value)} />
        </label>
      </div>

      <div className="campo">
        <span className="rot">Permissões</span>
        <ArvorePermissoes nos={arvore} marcadas={marcadas} editavel={editavel && !ocupado} onChange={(s) => { setMarcadas(s); setOk(null); }} />
      </div>

      {podeGerenciar && !grupo.sistema && (
        <div className="barra-salvar">
          {erro && (
            <p className="msg-erro" role="alert">
              {erro}
            </p>
          )}
          {ok && (
            <p className="msg-ok" role="status">
              {ok}
            </p>
          )}
          {confirmarExclusao ? (
            <>
              <button className="btn" onClick={() => setConfirmarExclusao(false)} disabled={ocupado}>
                Voltar
              </button>
              <button className="btn perigo" onClick={() => void excluir()} disabled={ocupado}>
                Confirmar exclusão
              </button>
            </>
          ) : (
            <button
              className="btn"
              onClick={() => setConfirmarExclusao(true)}
              disabled={ocupado || qtdUsuarios > 0}
              title={qtdUsuarios > 0 ? 'Mude os usuários de grupo antes de excluir' : undefined}
            >
              <Icone nome="trash" tamanho={16} />
              Excluir grupo
            </button>
          )}
          <span className="sp" />
          <button className="btn" onClick={() => { setNome(grupo.nome); setDescricao(grupo.descricao ?? ''); setMarcadas(new Set(salvas)); setErro(null); }} disabled={!sujo || ocupado}>
            Descartar
          </button>
          <button className="btn pri" onClick={() => void salvar()} disabled={!sujo || ocupado || !nome.trim()}>
            {ocupado ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      )}
      {!podeGerenciar && erro && (
        <p className="msg-erro" role="alert">
          {erro}
        </p>
      )}
    </section>
  );
}

function NovoGrupo({ dados, onCancelar, onCriado }: { dados: DadosUsuarios; onCancelar: () => void; onCriado: (id: string) => void }) {
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [copiarDe, setCopiarDe] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar(e: FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    setOcupado(true);
    setErro(null);
    try {
      const { data, error } = await supabase.from('perfis').insert({ nome: nome.trim(), descricao: descricao.trim() || null }).select('id').single();
      if (error) throw error;
      const id = (data as { id: string }).id;
      if (copiarDe) {
        const { data: fs, error: e1 } = await supabase.from('grupo_funcoes').select('funcao').eq('perfil_id', copiarDe);
        if (e1) throw e1;
        if (fs?.length) {
          const { error: e2 } = await supabase.from('grupo_funcoes').insert(fs.map((f: { funcao: string }) => ({ perfil_id: id, funcao: f.funcao })));
          if (e2) throw e2;
        }
      }
      onCriado(id);
    } catch (e2) {
      setErro(mensagemErro(e2));
      setOcupado(false);
    }
  }

  return (
    <form className="secao" onSubmit={criar}>
      <h3>Novo grupo</h3>
      <div className="grupo-campos">
        <label className="campo">
          <span className="rot">Nome</span>
          <input className="inp" value={nome} maxLength={40} autoFocus placeholder="Ex.: Recepção" onChange={(e) => setNome(e.target.value)} />
        </label>
        <label className="campo">
          <span className="rot">Descrição</span>
          <input className="inp" value={descricao} maxLength={160} placeholder="Para que serve este grupo (opcional)" onChange={(e) => setDescricao(e.target.value)} />
        </label>
      </div>
      <label className="campo">
        <span className="rot">Começar com as permissões de</span>
        <select className="inp" value={copiarDe} onChange={(e) => setCopiarDe(e.target.value)}>
          <option value="">Nenhuma (marco depois)</option>
          {dados.grupos.map((g) => (
            <option key={g.id} value={g.id}>
              {g.nome}
            </option>
          ))}
        </select>
      </label>
      {erro && (
        <p className="msg-erro" role="alert">
          {erro}
        </p>
      )}
      <div className="barra-salvar">
        <span className="sp" />
        <button type="button" className="btn" onClick={onCancelar} disabled={ocupado}>
          Cancelar
        </button>
        <button type="submit" className="btn pri" disabled={!nome.trim() || ocupado}>
          {ocupado ? 'Criando…' : 'Criar grupo'}
        </button>
      </div>
    </form>
  );
}
