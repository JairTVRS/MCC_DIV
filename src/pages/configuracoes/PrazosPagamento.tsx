import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { fmtPct, nomePrazo, refDe, resumoPrazo } from '../../lib/prazos';
import { supabase } from '../../lib/supabase';
import type { PrazoPagamento, RefPrazo } from '../../lib/tipos';

type Linha = { dias: string; percentual: string; ref: RefPrazo };

const lerNum = (s: string) => Number(s.replace(',', '.'));

/** Cadastro de prazos de pagamento: parcelas em dias (após a pré-reserva ou antes do evento) e % do valor. */
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
        Cada parcela conta os dias a partir da data em que a reserva entrou em Pré-reserva ou antes do início do evento. Na reserva, as parcelas geradas pelo prazo ainda
        podem ser ajustadas uma a uma.
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
 * Divide 100% entre as parcelas: se a 1ª for entrada (0 dias após a pré-reserva) com um % entre 0 e
 * 100, ela fica como está e o resto é dividido entre as outras; senão (ex.: entrada com 100%, que
 * daria 99,99% + 0,01%), tudo é dividido igualmente. Os centavos vão para a última.
 */
function dividir(linhas: Linha[]): Linha[] {
  if (linhas.length === 0) return linhas;
  const pctEntrada = lerNum(linhas[0].percentual) || 0;
  const temEntrada = linhas.length > 1 && linhas[0].ref === 'reserva' && lerNum(linhas[0].dias) === 0 && pctEntrada > 0 && pctEntrada < 100;
  const mantem = temEntrada ? pctEntrada : null;
  const inicio = mantem === null ? 0 : 1;
  const resto = 100 - (mantem ?? 0);
  const n = linhas.length - inicio;
  const parte = Math.floor((resto / n) * 100) / 100;
  return linhas.map((l, k) =>
    k < inicio ? { ...l, percentual: fmtPct(mantem!) } : { ...l, percentual: fmtPct(k === linhas.length - 1 ? Math.round((resto - parte * (n - 1)) * 100) / 100 : parte) },
  );
}

/** Próxima parcela ao clicar em "+ Parcela": segue o tipo da última (30 dias depois, ou 15 dias mais perto do evento). */
function proxima(ls: Linha[]): Linha {
  const ult = ls[ls.length - 1];
  const d = lerNum(ult?.dias ?? '') || 0;
  if (ult?.ref === 'evento') return { dias: String(Math.max(0, d - 15)), percentual: '', ref: 'evento' };
  return { dias: String(d + 30), percentual: '', ref: 'reserva' };
}

function EditorPrazo(props: { prazo: PrazoPagamento | null; outros: string[]; proximaOrdem: number; onFechar: () => void; onSalvo: () => void }) {
  const { prazo, outros, proximaOrdem, onFechar, onSalvo } = props;
  const [linhas, setLinhas] = useState<Linha[]>(
    prazo ? prazo.parcelas.map((p) => ({ dias: String(p.dias), percentual: fmtPct(p.percentual), ref: refDe(p) })) : [{ dias: '30', percentual: '100', ref: 'reserva' }],
  );
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Conferência linha a linha (mesmas regras do banco): primeiro as parcelas após a pré-reserva,
  // com dias crescentes; depois as antes do evento, com dias decrescentes. % > 0, soma 100%.
  const parcelas = linhas.map((l) => ({ dias: Math.trunc(lerNum(l.dias)), percentual: Math.round(lerNum(l.percentual) * 100) / 100, ref: l.ref }));
  const foraDeOrdem = parcelas.map((p, i) => i > 0 && p.ref === 'reserva' && parcelas[i - 1].ref === 'evento');
  const diasRuim = parcelas.map((p, i) => {
    if (l_vazio(linhas[i].dias) || !Number.isFinite(p.dias) || p.dias < 0 || foraDeOrdem[i]) return true;
    const ant = parcelas[i - 1];
    if (!ant || ant.ref !== p.ref) return false;
    return p.ref === 'reserva' ? p.dias <= ant.dias : p.dias >= ant.dias;
  });
  const pctRuim = parcelas.map((p, i) => l_vazio(linhas[i].percentual) || !(p.percentual > 0));
  const soma = parcelas.reduce((s, p) => s + (p.percentual || 0), 0);
  const somaOk = Math.abs(soma - 100) <= 0.01;
  const linhasOk = !diasRuim.some(Boolean) && !pctRuim.some(Boolean);
  const nome = linhasOk ? nomePrazo(parcelas) : '';
  const repetido = !!nome && outros.some((o) => o.toLowerCase() === nome.toLowerCase());
  const pronto = linhasOk && somaOk && !repetido;
  const motivo = foraDeOrdem.some(Boolean)
    ? 'As parcelas após a pré-reserva vêm primeiro; as antes do evento ficam no fim.'
    : diasRuim.some(Boolean)
      ? 'Após a pré-reserva: dias crescentes (0 = entrada, na hora). Antes do evento: dias decrescentes (ex.: 30 e depois 15; 0 = no dia).'
      : pctRuim.some(Boolean)
        ? 'Cada parcela precisa de um % maior que zero. Use "Dividir igualmente".'
        : !somaOk
          ? `Os percentuais somam ${fmtPct(soma)}%; precisam somar 100%.`
          : repetido
            ? 'Já existe um prazo igual a este.'
            : null;

  function mudar(i: number, campo: 'dias' | 'percentual', valor: string) {
    setLinhas((ls) => ls.map((l, k) => (k === i ? { ...l, [campo]: valor.replace(campo === 'dias' ? /\D/g : /[^\d,.]/g, '') } : l)));
  }
  function mudarRef(i: number, ref: RefPrazo) {
    setLinhas((ls) => ls.map((l, k) => (k === i ? { ...l, ref } : l)));
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
      <form className="modal" role="dialog" aria-modal="true" aria-label={prazo ? 'Editar prazo' : 'Novo prazo'} onSubmit={salvar}>
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
                  <th>Contar</th>
                  <th>Dias</th>
                  <th>% do valor</th>
                  <th aria-label="Remover" />
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>
                      <select className="inp" value={l.ref} aria-label={`De onde contam os dias da parcela ${i + 1}`} onChange={(e) => mudarRef(i, e.target.value as RefPrazo)}>
                        <option value="reserva">após a pré-reserva</option>
                        <option value="evento">antes do evento</option>
                      </select>
                    </td>
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
                onClick={() => setLinhas((ls) => dividir([...ls, proxima(ls)]))}
                title="Acrescenta uma parcela depois da última e redivide os percentuais"
              >
                <Icone nome="plus" tamanho={16} />
                Parcela
              </button>
              <button type="button" className="btn peq" onClick={() => setLinhas(dividir)} title="Entrada (0 dias após a pré-reserva) fica como está; o resto é dividido igualmente">
                Dividir igualmente
              </button>
              <span className={`soma-pct${somaOk ? ' ok' : ''}`}>Soma: {fmtPct(soma)}%</span>
            </div>
            <p className="note">
              Após a pré-reserva: 0 dias = entrada, paga na hora. Antes do evento: os dias contam para trás a partir do início do evento (0 = no dia). Ex.: 30% após a
              pré-reserva com 0 dias + 70% antes do evento com 15 dias. Ao incluir ou tirar parcela, os % são redivididos.
            </p>
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
