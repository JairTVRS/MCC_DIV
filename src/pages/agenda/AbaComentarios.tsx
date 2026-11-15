import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useSessao } from '../../auth/Sessao';
import { Avatar } from '../../layout/Avatar';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import type { Comentario, Reserva } from '../../lib/tipos';
import type { UsuarioCurto } from './FormReserva';

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Pedaço digitado depois do @ (até o cursor), ou null se não está marcando ninguém. */
function termoMencao(texto: string, cursor: number): { inicio: number; termo: string } | null {
  const m = /(^|\s)@([^\s@]{0,30})$/.exec(texto.slice(0, cursor));
  return m ? { inicio: cursor - m[2].length - 1, termo: m[2] } : null;
}

/** Usuários citados no texto como "@Nome" (nome inteiro). */
function citados(texto: string, candidatos: UsuarioCurto[]): string[] {
  const t = sem(texto);
  return candidatos.filter((u) => new RegExp(`(^|\\s)@${sem(u.nome).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(t)).map((u) => u.id);
}

/** Texto com as menções destacadas. */
function comMencoes(texto: string, candidatos: UsuarioCurto[]): ReactNode[] {
  const nomes = candidatos.map((u) => u.nome).sort((a, b) => b.length - a.length);
  if (!nomes.length) return [texto];
  const re = new RegExp(`(@(?:${nomes.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'gi');
  return texto.split(re).map((parte, i) => (i % 2 === 1 ? <mark key={i} className="mencao">{parte}</mark> : parte));
}

/** Caixa de texto com sugestão de @menção. */
function CaixaTexto({
  valor,
  onMudar,
  candidatos,
  onEnviar,
  placeholder,
  autoFocus,
}: {
  valor: string;
  onMudar: (v: string) => void;
  candidatos: UsuarioCurto[];
  onEnviar: () => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mencao, setMencao] = useState<{ inicio: number; termo: string } | null>(null);
  const [sel, setSel] = useState(0);

  const sugestoes = useMemo(() => {
    if (!mencao) return [];
    const q = sem(mencao.termo);
    return candidatos.filter((u) => !q || sem(u.nome).split(/\s+/).some((p) => p.startsWith(q))).slice(0, 6);
  }, [mencao, candidatos]);

  function atualizar(v: string, cursor: number) {
    onMudar(v);
    setMencao(termoMencao(v, cursor));
    setSel(0);
  }

  function escolher(u: UsuarioCurto) {
    if (!mencao || !ref.current) return;
    const cursor = ref.current.selectionStart;
    const novo = `${valor.slice(0, mencao.inicio)}@${u.nome} ${valor.slice(cursor)}`;
    const pos = mencao.inicio + u.nome.length + 2;
    onMudar(novo);
    setMencao(null);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  }

  function tecla(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (sugestoes.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSel((s) => (s + (e.key === 'ArrowDown' ? 1 : sugestoes.length - 1)) % sugestoes.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        escolher(sugestoes[sel]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMencao(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onEnviar();
    }
  }

  return (
    <div className="caixa-mencao">
      <textarea
        ref={ref}
        className="inp"
        rows={3}
        value={valor}
        placeholder={placeholder}
        autoFocus={autoFocus}
        maxLength={4000}
        onChange={(e) => atualizar(e.target.value, e.target.selectionStart)}
        onKeyDown={tecla}
        onClick={(e) => setMencao(termoMencao(valor, e.currentTarget.selectionStart))}
        onBlur={() => setTimeout(() => setMencao(null), 150)}
      />
      {sugestoes.length > 0 && (
        <ul className="sugestoes" role="listbox">
          {sugestoes.map((u, i) => (
            <li key={u.id} role="option" aria-selected={i === sel}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => escolher(u)}>
                <Avatar nome={u.nome} foto={u.foto} tamanho={22} />
                {u.nome}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Aba Comentários da reserva: linha do tempo, @menção (avisa no sino), editar o próprio e excluir. */
export function AbaComentarios({
  reserva,
  usuarios,
  destaque,
  onMudou,
}: {
  reserva: Reserva;
  usuarios: UsuarioCurto[];
  destaque?: string | null;
  onMudou: () => void;
}) {
  const { usuario, tem } = useSessao();
  const [lista, setLista] = useState<Comentario[] | null>(null);
  const [texto, setTexto] = useState('');
  const [editando, setEditando] = useState<{ id: string; texto: string } | null>(null);
  const [excluindo, setExcluindo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  const podeIncluir = tem('comentarios.incluir');
  const podeAlterar = tem('comentarios.alterar');
  const podeExcluir = tem('comentarios.excluir');
  // Só dá para marcar quem está ativo e vê a agenda (o banco confere de novo).
  const candidatos = useMemo(() => usuarios.filter((u) => u.responsavel), [usuarios]);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from('comentarios')
      .select('id, locacao_id, texto, autor_id, criado_em, editado_em')
      .eq('locacao_id', reserva.id)
      .eq('excluido', false)
      .order('criado_em');
    if (error) setErro(mensagemErro(error));
    setLista((data ?? []) as Comentario[]);
  }, [reserva.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Abriu pelo sino: rola até o comentário; senão, até o fim.
  useEffect(() => {
    if (!lista) return;
    const alvo = destaque ? document.getElementById(`comentario-${destaque}`) : null;
    (alvo ?? fim.current)?.scrollIntoView({ block: alvo ? 'center' : 'end' });
  }, [lista, destaque]);

  async function marcar(comentarioId: string, conteudo: string) {
    const ids = citados(conteudo, candidatos);
    if (!ids.length) return;
    const { data } = await supabase.from('comentario_mencoes').select('usuario_mencionado_id').eq('comentario_id', comentarioId);
    const ja = new Set((data ?? []).map((x: { usuario_mencionado_id: string }) => x.usuario_mencionado_id));
    const novos = ids.filter((id) => !ja.has(id));
    if (!novos.length) return;
    const { error } = await supabase.from('comentario_mencoes').insert(novos.map((id) => ({ comentario_id: comentarioId, usuario_mencionado_id: id })));
    if (error) throw error;
  }

  async function enviar() {
    const t = texto.trim();
    if (!t || ocupado) return;
    setOcupado(true);
    setErro(null);
    try {
      const { data, error } = await supabase.from('comentarios').insert({ locacao_id: reserva.id, texto: t }).select('id').single();
      if (error) throw error;
      setTexto('');
      await marcar((data as { id: string }).id, t);
    } catch (e) {
      setErro(mensagemErro(e));
    }
    setOcupado(false);
    await carregar();
    onMudou();
  }

  async function salvarEdicao() {
    if (!editando || ocupado) return;
    const t = editando.texto.trim();
    if (!t) return;
    setOcupado(true);
    setErro(null);
    try {
      const { error } = await supabase.from('comentarios').update({ texto: t }).eq('id', editando.id);
      if (error) throw error;
      await marcar(editando.id, t);
      setEditando(null);
    } catch (e) {
      setErro(mensagemErro(e));
    }
    setOcupado(false);
    await carregar();
  }

  async function excluir(id: string) {
    setOcupado(true);
    setErro(null);
    const { error } = await supabase.rpc('excluir_registro', { p_tabela: 'comentarios', p_id: id });
    setOcupado(false);
    setExcluindo(null);
    if (error) return setErro(mensagemErro(error));
    await carregar();
    onMudou();
  }

  if (!lista) return <p className="note">Carregando…</p>;
  const autor = (id: string) => usuarios.find((u) => u.id === id);

  return (
    <div className="comentarios">
      {lista.length === 0 ? (
        <p className="vazio">Nenhum comentário ainda.</p>
      ) : (
        <ul className="lista-comentarios">
          {lista.map((c) => {
            const a = autor(c.autor_id);
            const meu = c.autor_id === usuario?.id;
            return (
              <li key={c.id} id={`comentario-${c.id}`} className={c.id === destaque ? 'destaque' : undefined}>
                <Avatar nome={a?.nome ?? '?'} foto={a?.foto ?? null} tamanho={30} />
                <div className="com-corpo">
                  <div className="com-topo">
                    <strong>{a?.nome ?? 'Usuário'}</strong>
                    <span>
                      {new Date(c.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                      {c.editado_em && <em title={new Date(c.editado_em).toLocaleString('pt-BR')}> (editado)</em>}
                    </span>
                    <span className="com-acoes">
                      {meu && podeAlterar && editando?.id !== c.id && (
                        <button type="button" className="ib" onClick={() => setEditando({ id: c.id, texto: c.texto })} aria-label="Editar comentário" title="Editar">
                          <Icone nome="edit" tamanho={15} />
                        </button>
                      )}
                      {podeExcluir &&
                        (excluindo === c.id ? (
                          <>
                            <button type="button" className="btn peq" onClick={() => setExcluindo(null)}>
                              Voltar
                            </button>
                            <button type="button" className="btn peq perigo" onClick={() => void excluir(c.id)} disabled={ocupado}>
                              Excluir
                            </button>
                          </>
                        ) : (
                          <button type="button" className="ib" onClick={() => setExcluindo(c.id)} aria-label="Excluir comentário" title="Excluir (vai para a lixeira)">
                            <Icone nome="trash" tamanho={15} />
                          </button>
                        ))}
                    </span>
                  </div>
                  {editando?.id === c.id ? (
                    <div className="com-editar">
                      <CaixaTexto valor={editando.texto} onMudar={(v) => setEditando({ id: c.id, texto: v })} candidatos={candidatos} onEnviar={() => void salvarEdicao()} autoFocus />
                      <div className="acoes">
                        <button type="button" className="btn peq" onClick={() => setEditando(null)}>
                          Cancelar
                        </button>
                        <button type="button" className="btn peq pri" onClick={() => void salvarEdicao()} disabled={ocupado || !editando.texto.trim()}>
                          Salvar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="com-texto">{comMencoes(c.texto, candidatos)}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div ref={fim} />

      {erro && (
        <p className="msg-erro" role="alert">
          {erro}
        </p>
      )}

      {podeIncluir && (
        <div className="com-novo">
          <CaixaTexto valor={texto} onMudar={setTexto} candidatos={candidatos} onEnviar={() => void enviar()} placeholder="Escreva um comentário… use @ para marcar alguém (Ctrl+Enter envia)" />
          <button type="button" className="btn pri" onClick={() => void enviar()} disabled={ocupado || !texto.trim()}>
            <Icone nome="enviar" tamanho={16} /> Enviar
          </button>
        </div>
      )}
    </div>
  );
}
