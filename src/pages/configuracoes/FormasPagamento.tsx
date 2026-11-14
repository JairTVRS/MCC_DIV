import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import type { FormaPagamento } from '../../lib/tipos';

/** Incluir, renomear, ativar/desativar e ordenar. Não há exclusão: desativar tira das novas escolhas e mantém o histórico. */
export function FormasPagamento({ podeAlterar }: { podeAlterar: boolean }) {
  const [lista, setLista] = useState<FormaPagamento[] | null>(null);
  const [nova, setNova] = useState('');
  const [editando, setEditando] = useState<{ id: string; nome: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('formas_pagamento').select('id, nome, ativo, ordem').order('ordem').order('nome');
    if (error) setErro(mensagemErro(error));
    setLista((data ?? []) as FormaPagamento[]);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function executar(acao: () => PromiseLike<{ error: unknown }>, depois?: () => void) {
    setOcupado(true);
    setErro(null);
    const { error } = await acao();
    if (error) setErro(mensagemErro(error, 'Não foi possível salvar.'));
    else depois?.();
    await carregar();
    setOcupado(false);
  }

  function incluir(e: FormEvent) {
    e.preventDefault();
    const nome = nova.trim();
    if (!nome) return;
    const ordem = Math.max(0, ...(lista ?? []).map((f) => f.ordem)) + 1;
    void executar(() => supabase.from('formas_pagamento').insert({ nome, ordem }), () => setNova(''));
  }

  function renomear(e: FormEvent) {
    e.preventDefault();
    if (!editando) return;
    const nome = editando.nome.trim();
    const atual = lista?.find((f) => f.id === editando.id);
    if (!nome || nome === atual?.nome) {
      setEditando(null);
      return;
    }
    void executar(() => supabase.from('formas_pagamento').update({ nome }).eq('id', editando.id), () => setEditando(null));
  }

  function alternar(f: FormaPagamento) {
    void executar(() => supabase.from('formas_pagamento').update({ ativo: !f.ativo }).eq('id', f.id));
  }

  function mover(i: number, dir: -1 | 1) {
    if (!lista) return;
    const j = i + dir;
    if (j < 0 || j >= lista.length) return;
    const trocada = [...lista];
    [trocada[i], trocada[j]] = [trocada[j], trocada[i]];
    // Renumera 1, 2, 3… e grava só o que mudou.
    const reordenada = trocada.map((f, k) => ({ ...f, ordem: k + 1 }));
    const mudancas = reordenada.filter((f) => f.ordem !== lista.find((x) => x.id === f.id)?.ordem);
    setLista(reordenada);
    void executar(async () => {
      const r = await Promise.all(mudancas.map((f) => supabase.from('formas_pagamento').update({ ordem: f.ordem }).eq('id', f.id)));
      return { error: r.find((x) => x.error)?.error ?? null };
    });
  }

  if (!lista) return <p className="note">Carregando…</p>;

  return (
    <section className="secao">
      <h3>Formas de pagamento</h3>
      <p className="note">A ordem aqui é a ordem em que elas aparecem ao registrar um pagamento. Desativar tira a forma das novas escolhas, sem mexer nos pagamentos já registrados.</p>

      {lista.length === 0 ? (
        <p className="vazio">Nenhuma forma de pagamento cadastrada.</p>
      ) : (
        <ul className="linhas">
          {lista.map((f, i) => (
            <li key={f.id} className={`linha${f.ativo ? '' : ' inativa'}`}>
              {podeAlterar && (
                <span className="setas">
                  <button className="ib" onClick={() => mover(i, -1)} disabled={ocupado || i === 0} aria-label={`Subir ${f.nome}`}>
                    <Icone nome="up" tamanho={16} />
                  </button>
                  <button className="ib" onClick={() => mover(i, 1)} disabled={ocupado || i === lista.length - 1} aria-label={`Descer ${f.nome}`}>
                    <Icone nome="down" tamanho={16} />
                  </button>
                </span>
              )}
              {editando?.id === f.id ? (
                <form className="tx edita" onSubmit={renomear}>
                  <input
                    className="inp"
                    value={editando.nome}
                    maxLength={40}
                    autoFocus
                    aria-label="Novo nome"
                    onChange={(e) => setEditando({ id: f.id, nome: e.target.value })}
                    onKeyDown={(e) => e.key === 'Escape' && setEditando(null)}
                  />
                  <button className="btn peq pri" type="submit" disabled={ocupado}>
                    Salvar
                  </button>
                  <button className="btn peq" type="button" onClick={() => setEditando(null)}>
                    Cancelar
                  </button>
                </form>
              ) : (
                <div className="tx">
                  <strong>{f.nome}</strong>
                </div>
              )}
              {!f.ativo && <span className="tag">Inativa</span>}
              {podeAlterar && editando?.id !== f.id && (
                <span className="acoes">
                  <button className="ib" onClick={() => setEditando({ id: f.id, nome: f.nome })} disabled={ocupado} aria-label={`Renomear ${f.nome}`} title="Renomear">
                    <Icone nome="edit" tamanho={16} />
                  </button>
                  <label className="chave" title={f.ativo ? 'Desativar' : 'Ativar'}>
                    <input type="checkbox" checked={f.ativo} disabled={ocupado} onChange={() => alternar(f)} />
                    <span>Ativa</span>
                  </label>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {podeAlterar && (
        <form className="incluir" onSubmit={incluir}>
          <input className="inp" value={nova} maxLength={40} placeholder="Nova forma de pagamento" aria-label="Nova forma de pagamento" onChange={(e) => setNova(e.target.value)} />
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
