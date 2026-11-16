import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CADASTROS, carregarCadastro, ehRepetido, type QualCadastro } from '../../lib/cadastros';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import type { ItemCadastro } from '../../lib/tipos';

/** Cadastro simples (Movimentos, Paróquias): incluir, renomear, ativar/desativar e ordenar. Nunca apaga. */
export function CadastroSimples({ qual, podeAlterar }: { qual: QualCadastro; podeAlterar: boolean }) {
  const cfg = CADASTROS[qual];
  const [lista, setLista] = useState<ItemCadastro[] | null>(null);
  const [nova, setNova] = useState('');
  const [editando, setEditando] = useState<{ id: string; nome: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setLista(await carregarCadastro(qual));
    } catch (e) {
      setErro(mensagemErro(e));
      setLista((l) => l ?? []);
    }
  }, [qual]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function executar(acao: () => PromiseLike<{ error: unknown }>, depois?: () => void) {
    setOcupado(true);
    setErro(null);
    const { error } = await acao();
    if (error) setErro(ehRepetido(error) ? `Já existe ${cfg.artigo === 'a' ? 'uma' : 'um'} ${cfg.singular.toLowerCase()} com esse nome.` : mensagemErro(error, 'Não foi possível salvar.'));
    else depois?.();
    await carregar();
    setOcupado(false);
  }

  function incluir(e: FormEvent) {
    e.preventDefault();
    const nome = nova.trim();
    if (!nome) return;
    const ordem = Math.max(0, ...(lista ?? []).map((c) => c.ordem)) + 1;
    void executar(() => supabase.from(cfg.tabela).insert({ nome, ordem }), () => setNova(''));
  }

  function renomear(e: FormEvent) {
    e.preventDefault();
    if (!editando) return;
    const nome = editando.nome.trim();
    const atual = lista?.find((c) => c.id === editando.id);
    if (!nome || nome === atual?.nome) return setEditando(null);
    void executar(() => supabase.from(cfg.tabela).update({ nome }).eq('id', editando.id), () => setEditando(null));
  }

  function mover(i: number, dir: -1 | 1) {
    if (!lista) return;
    const j = i + dir;
    if (j < 0 || j >= lista.length) return;
    const trocada = [...lista];
    [trocada[i], trocada[j]] = [trocada[j], trocada[i]];
    const reordenada = trocada.map((c, k) => ({ ...c, ordem: k + 1 }));
    const mudancas = reordenada.filter((c) => c.ordem !== lista.find((x) => x.id === c.id)?.ordem);
    setLista(reordenada);
    void executar(async () => {
      const r = await Promise.all(mudancas.map((c) => supabase.from(cfg.tabela).update({ ordem: c.ordem }).eq('id', c.id)));
      return { error: r.find((x) => x.error)?.error ?? null };
    });
  }

  if (!lista) return <p className="note">Carregando…</p>;

  return (
    <section className="secao">
      <h3>{cfg.titulo}</h3>
      <p className="note">{cfg.nota}</p>
      {lista.length === 0 ? (
        <p className="vazio">Nenhum cadastro ainda.</p>
      ) : (
        <ul className="linhas">
          {lista.map((c, i) => (
            <li key={c.id} className={`linha${c.ativo ? '' : ' inativa'}`}>
              {podeAlterar && (
                <span className="setas">
                  <button className="ib" onClick={() => mover(i, -1)} disabled={ocupado || i === 0} aria-label={`Subir ${c.nome}`}>
                    <Icone nome="up" tamanho={16} />
                  </button>
                  <button className="ib" onClick={() => mover(i, 1)} disabled={ocupado || i === lista.length - 1} aria-label={`Descer ${c.nome}`}>
                    <Icone nome="down" tamanho={16} />
                  </button>
                </span>
              )}
              {editando?.id === c.id ? (
                <form className="tx edita" onSubmit={renomear}>
                  <input className="inp" value={editando.nome} maxLength={80} autoFocus aria-label="Novo nome" onChange={(e) => setEditando({ id: c.id, nome: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && setEditando(null)} />
                  <button className="btn peq pri" type="submit" disabled={ocupado}>
                    Salvar
                  </button>
                  <button className="btn peq" type="button" onClick={() => setEditando(null)}>
                    Cancelar
                  </button>
                </form>
              ) : (
                <div className="tx">
                  <strong>{c.nome}</strong>
                </div>
              )}
              {!c.ativo && <span className="tag">{cfg.artigo === 'a' ? 'Inativa' : 'Inativo'}</span>}
              {podeAlterar && editando?.id !== c.id && (
                <span className="acoes">
                  <button className="ib" onClick={() => setEditando({ id: c.id, nome: c.nome })} disabled={ocupado} aria-label={`Renomear ${c.nome}`} title="Renomear">
                    <Icone nome="edit" tamanho={16} />
                  </button>
                  <label className="chave" title={c.ativo ? 'Desativar' : 'Ativar'}>
                    <input type="checkbox" checked={c.ativo} disabled={ocupado} onChange={() => void executar(() => supabase.from(cfg.tabela).update({ ativo: !c.ativo }).eq('id', c.id))} />
                    <span>{cfg.artigo === 'a' ? 'Ativa' : 'Ativo'}</span>
                  </label>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {podeAlterar && (
        <form className="incluir" onSubmit={incluir}>
          <input className="inp" value={nova} maxLength={80} placeholder={cfg.novo} aria-label={cfg.novo} onChange={(e) => setNova(e.target.value)} />
          <button className="btn pri" type="submit" disabled={ocupado || !nova.trim()}>
            <Icone nome="plus" tamanho={16} />
            Incluir
          </button>
        </form>
      )}
      {erro && (
        <p className="msg-erro" role="alert">
          {erro}
        </p>
      )}
    </section>
  );
}
