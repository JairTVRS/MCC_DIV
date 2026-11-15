import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import type { PrazoPagamento } from '../../lib/tipos';

type Linha = { dias: string; percentual: string };

const fmtPct = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const lerNum = (s: string) => Number(s.replace(',', '.'));

/** "0 · 50% — 30 · 16,67% — …" */
export function resumoPrazo(p: Pick<PrazoPagamento, 'parcelas'>): string {
  return p.parcelas.map((x) => `${x.dias === 0 ? 'na hora' : `${x.dias} dias`} · ${fmtPct(x.percentual)}%`).join(' — ');
}

/** Cadastro de prazos de pagamento: nome + parcelas em dias (a partir da pré-reserva) e % do valor. */
export function PrazosPagamento({ podeAlterar }: { podeAlterar: boolean }) {
  const [lista, setLista] = useState<PrazoPagamento[] | null>(null);
  const [editando, setEditando] = useState<PrazoPagamento | 'novo' | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('prazos_pagamento').select('id, nome, parcelas, ativo, ordem').order('ordem').order('nome');
    if (error) setErro(mensagemErro(error));
    setLista((data ?? []) as PrazoPagamento[]);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function alternar(p: PrazoPagamento) {
    const { error } = await supabase.from('prazos_pagamento').update({ ativo: !p.ativo }).eq('id', p.id);
    if (error) setErro(mensagemErro(error));
    await carregar();
  }

  async function mover(i: number, dir: -1 | 1) {
    if (!lista) return;
    const j = i + dir;
    if (j < 0 || j >= lista.length) return;
    const trocada = [...lista];
    [trocada[i], trocada[j]] = [trocada[j], trocada[i]];
    const reordenada = trocada.map((p, k) => ({ ...p, ordem: k + 1 }));
    setLista(reordenada);
    const mudou = reordenada.filter((p) => p.ordem !== lista.find((x) => x.id === p.id)?.ordem);
    const r = await Promise.all(mudou.map((p) => supabase.from('prazos_pagamento').update({ ordem: p.ordem }).eq('id', p.id)));
    const falha = r.find((x) => x.error)?.error;
    if (falha) setErro(mensagemErro(falha));
    await carregar();
  }

  if (!lista) return <p className="note">Carregando…</p>;

  return (
    <section className="secao">
      <div className="secao-cab">
        <h3>Prazos de pagamento</h3>
        {podeAlterar && (
          <button className="btn pri" onClick={() => setEditando('novo')}>
            <Icone nome="plus" tamanho={16} />
            Novo prazo
          </button>
        )}
      </div>
      <p className="note">
        Os dias contam a partir da data em que a reserva entrou em Pré-reserva. Na reserva, as parcelas geradas pelo prazo ainda podem ser ajustadas uma a uma.
      </p>
      {lista.length === 0 ? (
        <p className="vazio">Nenhum prazo cadastrado.</p>
      ) : (
        <ul className="linhas">
          {lista.map((p, i) => (
            <li key={p.id} className={`linha${p.ativo ? '' : ' inativa'}`}>
              {podeAlterar && (
                <span className="setas">
                  <button className="ib" onClick={() => void mover(i, -1)} disabled={i === 0} aria-label={`Subir ${p.nome}`}>
                    <Icone nome="up" tamanho={16} />
                  </button>
                  <button className="ib" onClick={() => void mover(i, 1)} disabled={i === lista.length - 1} aria-label={`Descer ${p.nome}`}>
                    <Icone nome="down" tamanho={16} />
                  </button>
                </span>
              )}
              <div className="tx">
                <strong>{p.nome}</strong>
                <span>{resumoPrazo(p)}</span>
              </div>
              {!p.ativo && <span className="tag">Inativo</span>}
              {podeAlterar && (
                <span className="acoes">
                  <button className="ib" onClick={() => setEditando(p)} aria-label={`Editar ${p.nome}`} title="Editar">
                    <Icone nome="edit" tamanho={16} />
                  </button>
                  <label className="chave" title={p.ativo ? 'Desativar' : 'Ativar'}>
                    <input type="checkbox" checked={p.ativo} onChange={() => void alternar(p)} />
                    <span>Ativo</span>
                  </label>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {erro && (
        <p className="msg-erro" role="alert">
          {erro}
        </p>
      )}
      {editando && (
        <EditorPrazo
          prazo={editando === 'novo' ? null : editando}
          proximaOrdem={Math.max(0, ...lista.map((p) => p.ordem)) + 1}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null);
            void carregar();
          }}
        />
      )}
    </section>
  );
}

function EditorPrazo({ prazo, proximaOrdem, onFechar, onSalvo }: { prazo: PrazoPagamento | null; proximaOrdem: number; onFechar: () => void; onSalvo: () => void }) {
  const [nome, setNome] = useState(prazo?.nome ?? '');
  const [linhas, setLinhas] = useState<Linha[]>(
    prazo ? prazo.parcelas.map((p) => ({ dias: String(p.dias), percentual: fmtPct(p.percentual) })) : [{ dias: '30', percentual: '100' }],
  );
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const soma = linhas.reduce((s, l) => s + (lerNum(l.percentual) || 0), 0);
  const somaOk = Math.abs(soma - 100) <= 0.01;

  function mudar(i: number, campo: keyof Linha, valor: string) {
    setLinhas((ls) => ls.map((l, k) => (k === i ? { ...l, [campo]: valor.replace(/[^\d,.]/g, '') } : l)));
  }

  // Mantém a 1ª linha (ex.: 50% antecipado) e divide o que falta entre as demais; os centavos vão para a última.
  function dividirRestante() {
    if (linhas.length < 2) return setLinhas([{ ...linhas[0], percentual: '100' }]);
    const primeira = Math.min(100, lerNum(linhas[0].percentual) || 0);
    const resto = 100 - primeira;
    const n = linhas.length - 1;
    const parte = Math.floor((resto / n) * 100) / 100;
    setLinhas(
      linhas.map((l, k) =>
        k === 0 ? { ...l, percentual: fmtPct(primeira) } : { ...l, percentual: fmtPct(k === n ? Math.round((resto - parte * (n - 1)) * 100) / 100 : parte) },
      ),
    );
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    const parcelas = linhas.map((l) => ({ dias: Math.trunc(lerNum(l.dias)), percentual: Math.round(lerNum(l.percentual) * 100) / 100 }));
    if (!nome.trim()) return setErro('Informe o nome do prazo.');
    if (parcelas.some((p) => !Number.isFinite(p.dias) || p.dias < 0 || !(p.percentual > 0))) return setErro('Cada parcela precisa de dias (0 ou mais) e percentual.');
    if (parcelas.some((p, i) => i > 0 && p.dias < parcelas[i - 1].dias)) return setErro('Coloque as parcelas em ordem de dias.');
    if (!somaOk) return setErro(`Os percentuais somam ${fmtPct(soma)}%; precisam somar 100%.`);
    setOcupado(true);
    const dados = { nome: nome.trim(), parcelas };
    const { error } = prazo
      ? await supabase.from('prazos_pagamento').update(dados).eq('id', prazo.id)
      : await supabase.from('prazos_pagamento').insert({ ...dados, ordem: proximaOrdem });
    setOcupado(false);
    if (error) return setErro(mensagemErro(error));
    onSalvo();
  }

  return (
    <>
      <div className="scrim" onClick={ocupado ? undefined : onFechar} />
      <form className="modal estreito" role="dialog" aria-modal="true" aria-label={prazo ? 'Editar prazo' : 'Novo prazo'} onSubmit={salvar}>
        <div className="m-head">
          <h2>{prazo ? 'Editar prazo' : 'Novo prazo'}</h2>
          <button type="button" className="ib" onClick={onFechar} aria-label="Fechar" disabled={ocupado}>
            <Icone nome="x" />
          </button>
        </div>
        <div className="m-body">
          <label className="campo">
            <span className="rot">Nome *</span>
            <input className="inp" value={nome} maxLength={60} autoFocus placeholder="Ex.: 50% antecipado + 30/60/90" onChange={(e) => setNome(e.target.value)} />
          </label>
          <div className="campo">
            <span className="rot">Parcelas</span>
            <table className="tabela-prazo">
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Dias após a pré-reserva</th>
                  <th>% do valor</th>
                  <th aria-label="Remover" />
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>
                      <input className="inp" inputMode="numeric" value={l.dias} aria-label={`Dias da parcela ${i + 1}`} onChange={(e) => mudar(i, 'dias', e.target.value)} />
                    </td>
                    <td>
                      <input className="inp" inputMode="decimal" value={l.percentual} aria-label={`Percentual da parcela ${i + 1}`} onChange={(e) => mudar(i, 'percentual', e.target.value)} />
                    </td>
                    <td>
                      <button type="button" className="ib" onClick={() => setLinhas((ls) => ls.filter((_, k) => k !== i))} disabled={linhas.length === 1} aria-label={`Remover parcela ${i + 1}`}>
                        <Icone nome="trash" tamanho={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="acoes">
              <button
                type="button"
                className="btn peq"
                disabled={linhas.length >= 36}
                onClick={() => setLinhas((ls) => [...ls, { dias: String((lerNum(ls[ls.length - 1]?.dias) || 0) + 30), percentual: '0' }])}
              >
                <Icone nome="plus" tamanho={16} />
                Parcela
              </button>
              <button type="button" className="btn peq" onClick={dividirRestante} title="Mantém a 1ª parcela e divide o que falta igualmente entre as outras">
                Dividir o restante igualmente
              </button>
              <span className={`soma-pct${somaOk ? ' ok' : ''}`}>Soma: {fmtPct(soma)}%</span>
            </div>
            <p className="note">0 dias = paga na hora da pré-reserva (sinal/antecipado).</p>
          </div>
          {erro && (
            <p className="msg-erro" role="alert">
              {erro}
            </p>
          )}
        </div>
        <div className="m-foot">
          <span className="sp" />
          <button type="button" className="btn" onClick={onFechar} disabled={ocupado}>
            Cancelar
          </button>
          <button type="submit" className="btn pri" disabled={ocupado || !nome.trim() || !somaOk}>
            {ocupado ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </>
  );
}
