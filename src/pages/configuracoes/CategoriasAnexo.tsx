import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import type { CategoriaAnexo } from '../../lib/tipos';

/** Categorias dos anexos da reserva: incluir, renomear, ativar/desativar e ordenar. "Comprovante" é do sistema. */
export function CategoriasAnexo({ podeAlterar }: { podeAlterar: boolean }) {
  const [lista, setLista] = useState<CategoriaAnexo[] | null>(null);
  const [nova, setNova] = useState('');
  const [editando, setEditando] = useState<{ id: string; nome: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('categorias_anexo').select('id, nome, ativo, ordem, sistema').order('ordem').order('nome');
    if (error) setErro(mensagemErro(error));
    setLista((data ?? []) as CategoriaAnexo[]);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function executar(acao: () => PromiseLike<{ error: unknown }>, depois?: () => void) {
    setOcupado(true);
    setErro(null);
    const { error } = await acao();
    if (error) setErro((error as { code?: string }).code === '23505' ? 'Já existe uma categoria com esse nome.' : mensagemErro(error, 'Não foi possível salvar.'));
    else depois?.();
    await carregar();
    setOcupado(false);
  }

  function incluir(e: FormEvent) {
    e.preventDefault();
    const nome = nova.trim();
    if (!nome) return;
    const ordem = Math.max(0, ...(lista ?? []).map((c) => c.ordem)) + 1;
    void executar(() => supabase.from('categorias_anexo').insert({ nome, ordem }), () => setNova(''));
  }

  function renomear(e: FormEvent) {
    e.preventDefault();
    if (!editando) return;
    const nome = editando.nome.trim();
    const atual = lista?.find((c) => c.id === editando.id);
    if (!nome || nome === atual?.nome) return setEditando(null);
    void executar(() => supabase.from('categorias_anexo').update({ nome }).eq('id', editando.id), () => setEditando(null));
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
      const r = await Promise.all(mudancas.map((c) => supabase.from('categorias_anexo').update({ ordem: c.ordem }).eq('id', c.id)));
      return { error: r.find((x) => x.error)?.error ?? null };
    });
  }

  if (!lista) return <p className="note">Carregando…</p>;

  return (
    <section className="secao">
      <h3>Categorias de anexo</h3>
      <p className="note">Aparecem ao enviar um anexo na reserva. "Comprovante" é usada pelos pagamentos e devoluções e não pode ser renomeada nem desativada.</p>
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
                <input className="inp" value={editando.nome} maxLength={40} autoFocus aria-label="Novo nome" onChange={(e) => setEditando({ id: c.id, nome: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && setEditando(null)} />
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
            {c.sistema && <span className="tag">do sistema</span>}
            {!c.ativo && <span className="tag">Inativa</span>}
            {podeAlterar && !c.sistema && editando?.id !== c.id && (
              <span className="acoes">
                <button className="ib" onClick={() => setEditando({ id: c.id, nome: c.nome })} disabled={ocupado} aria-label={`Renomear ${c.nome}`} title="Renomear">
                  <Icone nome="edit" tamanho={16} />
                </button>
                <label className="chave" title={c.ativo ? 'Desativar' : 'Ativar'}>
                  <input type="checkbox" checked={c.ativo} disabled={ocupado} onChange={() => void executar(() => supabase.from('categorias_anexo').update({ ativo: !c.ativo }).eq('id', c.id))} />
                  <span>Ativa</span>
                </label>
              </span>
            )}
          </li>
        ))}
      </ul>
      {podeAlterar && (
        <form className="incluir" onSubmit={incluir}>
          <input className="inp" value={nova} maxLength={40} placeholder="Nova categoria" aria-label="Nova categoria" onChange={(e) => setNova(e.target.value)} />
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
