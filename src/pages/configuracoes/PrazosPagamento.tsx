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

/**
 * Nome do prazo, espelho das parcelas (mesma regra da função nome_prazo do banco, que é quem grava):
 * "À vista" · "30 dias" · "30/60/90" · "30% antecipado + 30/60/90" · "30 dias 40% / 60 dias 60%".
 */
export function nomePrazo(parcelas: { dias: number; percentual: number }[]): string {
  const antecipado = parcelas.filter((p) => p.dias === 0).reduce((s, p) => s + p.percentual, 0);
  const resto = parcelas.filter((p) => p.dias > 0);
  if (resto.length === 0) return 'À vista';
  const pcts = resto.map((p) => p.percentual);
  const parte =
    resto.length === 1
      ? `${resto[0].dias} dias`
      : Math.max(...pcts) - Math.min(...pcts) <= 0.02
        ? resto.map((p) => p.dias).join('/')
        : resto.map((p) => `${p.dias} dias ${fmtPct(p.percentual)}%`).join(' / ');
  return antecipado > 0 ? `${fmtPct(antecipado)}% antecipado + ${parte}` : parte;
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
          outros={lista.filter((p) => editando === 'novo' || p.id !== editando.id).map((p) => p.nome)}
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

/**
 * Divide 100% entre as parcelas: se a 1ª for antecipada (0 dias), ela fica como está e o resto
 * é dividido entre as outras; senão, tudo é dividido igualmente. Os centavos vão para a última.
 */
function dividir(linhas: Linha[]): Linha[] {
  if (linhas.length === 0) return linhas;
  const mantem = linhas.length > 1 && lerNum(linhas[0].dias) === 0 ? Math.min(99.99, Math.max(0, lerNum(linhas[0].percentual) || 0)) : null;
  const inicio = mantem === null ? 0 : 1;
  const resto = 100 - (mantem ?? 0);
  const n = linhas.length - inicio;
  const parte = Math.floor((resto / n) * 100) / 100;
  return linhas.map((l, k) =>
    k < inicio ? { ...l, percentual: fmtPct(mantem!) } : { ...l, percentual: fmtPct(k === linhas.length - 1 ? Math.round((resto - parte * (n - 1)) * 100) / 100 : parte) },
  );
}

function EditorPrazo(props: { prazo: PrazoPagamento | null; outros: string[]; proximaOrdem: number; onFechar: () => void; onSalvo: () => void }) {
  const { prazo, outros, proximaOrdem, onFechar, onSalvo } = props;
  const [linhas, setLinhas] = useState<Linha[]>(
    prazo ? prazo.parcelas.map((p) => ({ dias: String(p.dias), percentual: fmtPct(p.percentual) })) : [{ dias: '30', percentual: '100' }],
  );
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Conferência linha a linha: dias inteiros e crescentes (sem repetir), % maior que zero, soma 100%.
  const parcelas = linhas.map((l) => ({ dias: Math.trunc(lerNum(l.dias)), percentual: Math.round(lerNum(l.percentual) * 100) / 100 }));
  const diasRuim = parcelas.map((p, i) => l_vazio(linhas[i].dias) || !Number.isFinite(p.dias) || p.dias < 0 || (i > 0 && p.dias <= parcelas[i - 1].dias));
  const pctRuim = parcelas.map((p, i) => l_vazio(linhas[i].percentual) || !(p.percentual > 0));
  const soma = parcelas.reduce((s, p) => s + (p.percentual || 0), 0);
  const somaOk = Math.abs(soma - 100) <= 0.01;
  const linhasOk = !diasRuim.some(Boolean) && !pctRuim.some(Boolean);
  const nome = linhasOk ? nomePrazo(parcelas) : '';
  const repetido = !!nome && outros.some((o) => o.toLowerCase() === nome.toLowerCase());
  const pronto = linhasOk && somaOk && !repetido;
  const motivo = diasRuim.some(Boolean)
    ? 'Os dias precisam ser crescentes, sem repetir (0 = na hora da pré-reserva).'
    : pctRuim.some(Boolean)
      ? 'Cada parcela precisa de um % maior que zero. Use "Dividir igualmente".'
      : !somaOk
        ? `Os percentuais somam ${fmtPct(soma)}%; precisam somar 100%.`
        : repetido
          ? 'Já existe um prazo igual a este.'
          : null;

  function mudar(i: number, campo: keyof Linha, valor: string) {
    setLinhas((ls) => ls.map((l, k) => (k === i ? { ...l, [campo]: valor.replace(campo === 'dias' ? /\D/g : /[^\d,.]/g, '') } : l)));
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!pronto) return;
    setErro(null);
    setOcupado(true);
    // O banco grava o nome a partir das parcelas (o enviado aqui é só o mesmo cálculo).
    const dados = { nome, parcelas };
    const { error } = prazo
      ? await supabase.from('prazos_pagamento').update(dados).eq('id', prazo.id)
      : await supabase.from('prazos_pagamento').insert({ ...dados, ordem: proximaOrdem });
    setOcupado(false);
    if (error) return setErro((error as { code?: string }).code === '23505' ? 'Já existe um prazo igual a este.' : mensagemErro(error));
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
          <div className="campo">
            <span className="rot">Nome (gerado das parcelas)</span>
            <div className={`nome-prazo${nome ? '' : ' vazio'}`} aria-live="polite">
              {nome || 'Preencha as parcelas'}
            </div>
          </div>
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
                      <input
                        className={`inp${diasRuim[i] ? ' invalido' : ''}`}
                        inputMode="numeric"
                        value={l.dias}
                        aria-invalid={diasRuim[i]}
                        aria-label={`Dias da parcela ${i + 1}`}
                        autoFocus={i === 0 && !prazo}
                        onChange={(e) => mudar(i, 'dias', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className={`inp${pctRuim[i] ? ' invalido' : ''}`}
                        inputMode="decimal"
                        value={l.percentual}
                        aria-invalid={pctRuim[i]}
                        aria-label={`Percentual da parcela ${i + 1}`}
                        onChange={(e) => mudar(i, 'percentual', e.target.value)}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ib"
                        onClick={() => setLinhas((ls) => dividir(ls.filter((_, k) => k !== i)))}
                        disabled={linhas.length === 1}
                        aria-label={`Remover parcela ${i + 1}`}
                      >
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
                onClick={() => setLinhas((ls) => dividir([...ls, { dias: String((lerNum(ls[ls.length - 1]?.dias) || 0) + 30), percentual: '' }]))}
                title="Acrescenta uma parcela 30 dias depois da última e redivide os percentuais"
              >
                <Icone nome="plus" tamanho={16} />
                Parcela
              </button>
              <button type="button" className="btn peq" onClick={() => setLinhas(dividir)} title="Antecipado (0 dias) fica como está; o resto é dividido igualmente">
                Dividir igualmente
              </button>
              <span className={`soma-pct${somaOk ? ' ok' : ''}`}>Soma: {fmtPct(soma)}%</span>
            </div>
            <p className="note">0 dias = paga na hora da pré-reserva (sinal/antecipado). Ao incluir ou tirar parcela, os % são redivididos.</p>
          </div>
          {(motivo || erro) && (
            <p className="msg-erro" role="alert">
              {erro ?? motivo}
            </p>
          )}
        </div>
        <div className="m-foot">
          <span className="sp" />
          <button type="button" className="btn" onClick={onFechar} disabled={ocupado}>
            Cancelar
          </button>
          <button type="submit" className="btn pri" disabled={ocupado || !pronto}>
            {ocupado ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </>
  );
}

function l_vazio(s: string): boolean {
  return s.trim() === '';
}
