import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSessao } from '../../auth/Sessao';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import type { FormaPagamento, Pessoa, Reserva, StatusCompromisso } from '../../lib/tipos';
import { FormPessoa } from '../pessoas/FormPessoa';
import { AbaPagamento, RegistrarDevolucao, valorFinal } from './AbaPagamento';
import { SeletorPessoa } from './SeletorPessoa';
import { COMPROMISSO, PAGAMENTO, dataLocal, escreverReais, hojeLocal, horaLocal, lerReais, paraIso, reais } from './formatos';

export const COLUNAS_RESERVA =
  'id, locatario_id, locador_id, responsavel_id, inicio, fim, status_compromisso, status_pagamento, valor_total, desconto, motivo_desconto, pre_reserva_em, observacoes, criado_por, criado_em, alterado_por, alterado_em';

/** Converte os números que o Supabase devolve como texto. */
export const normalizarReserva = (x: unknown): Reserva => {
  const r = x as Reserva;
  return { ...r, valor_total: Number(r.valor_total) || 0, desconto: Number(r.desconto) || 0 };
};

export interface UsuarioCurto {
  id: string;
  nome: string;
  /** Pode ser responsável: ativo e o grupo vê a agenda. */
  responsavel: boolean;
}

interface Props {
  reserva: Reserva | null; // null = nova
  diaInicial?: string;
  pessoas: Pessoa[];
  usuarios: UsuarioCurto[];
  onPessoaNova: (p: Pessoa) => void;
  onFechar: () => void;
  onMudou: () => void;
}

type Aba = 'dados' | 'pagamento' | 'anexos' | 'comentarios';
const ABAS: { id: Aba; titulo: string; etapa?: string }[] = [
  { id: 'dados', titulo: 'Dados' },
  { id: 'pagamento', titulo: 'Pagamento' },
  { id: 'anexos', titulo: 'Anexos', etapa: 'Contrato, documentos e fotos chegam na etapa 8 (os comprovantes de pagamento já ficam na aba Pagamento).' },
  { id: 'comentarios', titulo: 'Comentários', etapa: 'Comentários com menções @ chegam na etapa 8.' },
];

/** Formulário da reserva (card). Horário padrão 00:00–23:59 do dia; avisa conflito antes de salvar. */
export function FormReserva({ reserva, diaInicial, pessoas, usuarios, onPessoaNova, onFechar, onMudou }: Props) {
  const { usuario, tem } = useSessao();
  const [atual, setAtual] = useState<Reserva | null>(reserva);
  const nova = !atual;
  const editavel = nova ? tem('reservas.incluir') : tem('reservas.alterar');
  const dia = diaInicial ?? hojeLocal();
  const [aba, setAba] = useState<Aba>('dados');
  const [locatario, setLocatario] = useState<string | null>(reserva?.locatario_id ?? null);
  const [locador, setLocador] = useState<string | null>(reserva?.locador_id ?? null);
  const [responsavel, setResponsavel] = useState<string>(reserva?.responsavel_id ?? usuario?.id ?? '');
  const [dataIni, setDataIni] = useState(reserva ? dataLocal(reserva.inicio) : dia);
  const [horaIni, setHoraIni] = useState(reserva ? horaLocal(reserva.inicio) : '00:00');
  const [dataFim, setDataFim] = useState(reserva ? dataLocal(reserva.fim) : dia);
  const [horaFim, setHoraFim] = useState(reserva ? horaLocal(reserva.fim) : '23:59');
  const [status, setStatus] = useState<StatusCompromisso>(reserva?.status_compromisso ?? 'cadastrado');
  const [valor, setValor] = useState(reserva ? escreverReais(reserva.valor_total) : '');
  const [desconto, setDesconto] = useState(reserva && reserva.desconto > 0 ? escreverReais(reserva.desconto) : '');
  const [motivoDesconto, setMotivoDesconto] = useState(reserva?.motivo_desconto ?? '');
  const [observacoes, setObservacoes] = useState(reserva?.observacoes ?? '');
  const [pago, setPago] = useState(0);
  const [versaoPg, setVersaoPg] = useState(0);
  const [cadastrando, setCadastrando] = useState<{ tipo: 'locatario' | 'locador'; nome: string } | null>(null);
  const [devolucao, setDevolucao] = useState<{ recebido: number; formas: FormaPagamento[] } | null>(null);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const vePagamento = tem('pagamentos.visualizar');
  const podeDesconto = tem('pagamentos.desconto');

  // Valor já recebido (parcelas pagas menos devolvido), para o resumo do topo e para o cancelamento.
  useEffect(() => {
    if (!atual || !vePagamento) return;
    void Promise.all([
      supabase.from('parcelas').select('valor').eq('locacao_id', atual.id).eq('paga', true).eq('excluido', false),
      supabase.from('devolucoes').select('valor_devolvido').eq('locacao_id', atual.id),
    ]).then(([p, d]) => {
      const recebido = (p.data ?? []).reduce((s: number, x: { valor: number }) => s + Number(x.valor), 0);
      const devolvido = (d.data ?? []).reduce((s: number, x: { valor_devolvido: number }) => s + Number(x.valor_devolvido), 0);
      setPago(Math.round((recebido - devolvido) * 100) / 100);
    });
  }, [atual, vePagamento, versaoPg]);

  // Pagamento registrado/desfeito pode mudar o status (Reservado automático): relê a reserva.
  const recarregarAtual = useCallback(async () => {
    if (!atual) return;
    const { data } = await supabase.from('locacoes').select(COLUNAS_RESERVA).eq('id', atual.id).single();
    if (data) {
      const r = normalizarReserva(data);
      setAtual(r);
      setStatus(r.status_compromisso);
    }
    setVersaoPg((v) => v + 1);
    onMudou();
  }, [atual, onMudou]);

  const total = lerReais(valor);
  const valorDesconto = lerReais(desconto);
  const final = valorFinal({ valor_total: total, desconto: valorDesconto });
  const pct = final > 0 ? Math.min(100, Math.round((pago / final) * 100)) : total > 0 ? 100 : 0;
  const nomeUsuario = (id: string | null) => usuarios.find((u) => u.id === id)?.nome ?? '—';
  const responsaveis = usuarios.filter((u) => u.responsavel || u.id === responsavel);

  // Mudar para Reservado ou Cancelado exige a função própria (a não ser que já esteja assim).
  const statusPermitido = (s: StatusCompromisso) =>
    s === atual?.status_compromisso || (s === 'reservado' ? tem('reservas.confirmar') : s === 'cancelado' ? tem('reservas.cancelar') : true);

  // Ao mudar o início, o fim acompanha se estava no mesmo dia.
  function mudarDataIni(v: string) {
    if (dataFim === dataIni || dataFim < v) setDataFim(v);
    setDataIni(v);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!locatario) return setErro('Escolha o locatário.');
    if (!locador) return setErro('Escolha o locador.');
    if (!dataIni || !horaIni || !dataFim || !horaFim) return setErro('Preencha início e fim.');
    if (valorDesconto > total) return setErro('O desconto não pode ser maior que o valor da locação.');
    const inicio = paraIso(dataIni, horaIni);
    const fim = paraIso(dataFim, horaFim);
    if (fim <= inicio) return setErro('O fim precisa ser depois do início.');
    const cancelando = status === 'cancelado' && atual?.status_compromisso !== 'cancelado';

    setOcupado(true);
    try {
      if (COMPROMISSO[status].bloqueia) {
        const { data, error } = await supabase.rpc('conflito_reserva', { p_inicio: inicio, p_fim: fim, p_ignorar: atual?.id ?? null });
        if (error) throw error;
        if (data) throw new Error(`Esse horário já está ocupado pela ${data}. Escolha outro horário ou deixe como Cadastrado.`);
      }
      const dados = {
        locatario_id: locatario,
        locador_id: locador,
        responsavel_id: responsavel,
        inicio,
        fim,
        status_compromisso: status,
        valor_total: total,
        desconto: valorDesconto,
        motivo_desconto: valorDesconto > 0 ? motivoDesconto.trim() || null : null,
        observacoes: observacoes.trim() || null,
      };
      const { error } = atual ? await supabase.from('locacoes').update(dados).eq('id', atual.id) : await supabase.from('locacoes').insert(dados);
      if (error) {
        if ((error as { code?: string }).code === '23P01') {
          const { data } = await supabase.rpc('conflito_reserva', { p_inicio: inicio, p_fim: fim, p_ignorar: atual?.id ?? null });
          throw new Error(`Esse horário já está ocupado${data ? ` pela ${data}` : ' por outra pré-reserva ou reserva'}.`);
        }
        throw error;
      }
      onMudou();
      // Cancelou com valor recebido: pede o registro da devolução (plano v1.8, item 5).
      if (cancelando && pago > 0.004 && tem('pagamentos.registrar_devolucao')) {
        const { data: formas } = await supabase.from('formas_pagamento').select('id, nome, ativo, ordem').eq('ativo', true).order('ordem');
        setDevolucao({ recebido: pago, formas: (formas ?? []) as FormaPagamento[] });
        setOcupado(false);
        return;
      }
      onFechar();
    } catch (e2) {
      setErro(mensagemErro(e2));
    } finally {
      setOcupado(false);
    }
  }

  async function excluir() {
    if (!atual) return;
    setOcupado(true);
    setErro(null);
    const { error } = await supabase.rpc('excluir_registro', { p_tabela: 'locacoes', p_id: atual.id });
    setOcupado(false);
    if (error) {
      setConfirmarExclusao(false);
      return setErro(mensagemErro(error));
    }
    onMudou();
    onFechar();
  }

  const desab = !editavel || ocupado;
  const emDados = aba === 'dados';

  return (
    <>
      <div className="scrim" onClick={ocupado ? undefined : onFechar} />
      <form className="modal largo" role="dialog" aria-modal="true" aria-label={nova ? 'Nova reserva' : 'Reserva'} onSubmit={salvar}>
        <div className="m-head">
          <h2>{nova ? 'Nova reserva' : 'Reserva'}</h2>
          <span className={`status-chip st-${status}`}>{COMPROMISSO[status].rotulo}</span>
          <button type="button" className="ib" onClick={onFechar} aria-label="Fechar" disabled={ocupado}>
            <Icone nome="x" />
          </button>
        </div>
        <div className="tabs tabs-modal" role="tablist">
          {ABAS.filter((a) => a.id !== 'pagamento' || vePagamento).map((a) => (
            <button type="button" key={a.id} role="tab" aria-selected={aba === a.id} onClick={() => setAba(a.id)}>
              {a.titulo}
            </button>
          ))}
        </div>
        <div className="m-body">
          {aba === 'pagamento' ? (
            atual ? (
              <AbaPagamento reserva={atual} onMudou={() => void recarregarAtual()} />
            ) : (
              <p className="vazio">Salve a reserva para montar o plano de pagamento.</p>
            )
          ) : !emDados ? (
            <p className="vazio">{ABAS.find((a) => a.id === aba)?.etapa}</p>
          ) : (
            <>
              {vePagamento && (
                <div className="resumo-pg">
                  <div className="resumo-linha">
                    <span>
                      <strong>{reais(pago)}</strong> / {reais(final)}
                    </span>
                    <span className="resumo-pct">{pct}% pago</span>
                    {atual && <span className={`selo pg-${atual.status_pagamento}`}>{PAGAMENTO[atual.status_pagamento]}</span>}
                  </div>
                  <div className="barra" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Percentual pago">
                    <span style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )}

              <div className="duas-colunas">
                <SeletorPessoa
                  rotulo="Locatário *"
                  tipo="locatario"
                  pessoas={pessoas}
                  valor={locatario}
                  desabilitado={desab}
                  podeCadastrar={tem('pessoas.incluir')}
                  onChange={setLocatario}
                  onCadastrar={(nome) => setCadastrando({ tipo: 'locatario', nome })}
                />
                <SeletorPessoa
                  rotulo="Locador *"
                  tipo="locador"
                  pessoas={pessoas}
                  valor={locador}
                  desabilitado={desab}
                  podeCadastrar={tem('pessoas.incluir')}
                  onChange={setLocador}
                  onCadastrar={(nome) => setCadastrando({ tipo: 'locador', nome })}
                />
              </div>

              <div className="periodo">
                <label className="campo">
                  <span className="rot">Início *</span>
                  <span className="data-hora">
                    <input className="inp" type="date" value={dataIni} disabled={desab} onChange={(e) => mudarDataIni(e.target.value)} />
                    <input className="inp" type="time" value={horaIni} disabled={desab} onChange={(e) => setHoraIni(e.target.value)} />
                  </span>
                </label>
                <label className="campo">
                  <span className="rot">Fim *</span>
                  <span className="data-hora">
                    <input className="inp" type="date" value={dataFim} min={dataIni} disabled={desab} onChange={(e) => setDataFim(e.target.value)} />
                    <input className="inp" type="time" value={horaFim} disabled={desab} onChange={(e) => setHoraFim(e.target.value)} />
                  </span>
                </label>
              </div>

              <label className="campo">
                <span className="rot">Status do compromisso</span>
                <select className="inp" value={status} disabled={desab} onChange={(e) => setStatus(e.target.value as StatusCompromisso)}>
                  {(Object.keys(COMPROMISSO) as StatusCompromisso[]).map((s) => (
                    <option key={s} value={s} disabled={!statusPermitido(s)}>
                      {COMPROMISSO[s].rotulo}
                      {!statusPermitido(s) ? ' (sem permissão)' : ''}
                    </option>
                  ))}
                </select>
                <span className="note">{COMPROMISSO[status].quando}</span>
              </label>

              <div className="valores">
                <label className="campo">
                  <span className="rot">Valor da locação (R$)</span>
                  <input
                    className="inp"
                    inputMode="decimal"
                    value={valor}
                    placeholder="0,00"
                    disabled={desab}
                    onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ''))}
                    onBlur={() => valor && setValor(escreverReais(lerReais(valor)))}
                  />
                </label>
                {(podeDesconto || valorDesconto > 0) && (
                  <label className="campo">
                    <span className="rot">Desconto (R$)</span>
                    <input
                      className="inp"
                      inputMode="decimal"
                      value={desconto}
                      placeholder="0,00"
                      disabled={desab || !podeDesconto}
                      onChange={(e) => setDesconto(e.target.value.replace(/[^\d.,]/g, ''))}
                      onBlur={() => desconto && setDesconto(escreverReais(lerReais(desconto)))}
                    />
                    {total > 0 && valorDesconto > 0 && <span className="note">{Math.round((valorDesconto / total) * 1000) / 10}% do valor</span>}
                  </label>
                )}
                <div className="campo">
                  <span className="rot">Valor final</span>
                  <span className={`valor-final${valorDesconto > total ? ' erro' : ''}`}>{reais(final)}</span>
                </div>
              </div>
              {valorDesconto > 0 && (
                <label className="campo">
                  <span className="rot">Motivo do desconto</span>
                  <input className="inp" value={motivoDesconto} maxLength={300} placeholder="Ex.: cliente antigo, cortesia, negociação" disabled={desab || !podeDesconto} onChange={(e) => setMotivoDesconto(e.target.value)} />
                </label>
              )}

              <label className="campo">
                <span className="rot">Responsável</span>
                <select className="inp" value={responsavel} disabled={desab} onChange={(e) => setResponsavel(e.target.value)}>
                  {responsaveis.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nome}
                      {u.id === usuario?.id ? ' (você)' : ''}
                    </option>
                  ))}
                </select>
                <span className="note">Recebe os alertas desta reserva.</span>
              </label>

              <label className="campo">
                <span className="rot">Observações</span>
                <textarea className="inp" rows={3} value={observacoes} maxLength={2000} disabled={desab} onChange={(e) => setObservacoes(e.target.value)} />
              </label>

              {atual && (
                <p className="note auditoria">
                  Criada por {nomeUsuario(atual.criado_por)} em {new Date(atual.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  {atual.alterado_em &&
                    ` · alterada por ${nomeUsuario(atual.alterado_por)} em ${new Date(atual.alterado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`}
                  {atual.pre_reserva_em && ` · pré-reserva desde ${new Date(atual.pre_reserva_em).toLocaleDateString('pt-BR')}`}
                </p>
              )}
              {!editavel && <p className="note">Só leitura: seu grupo não pode {nova ? 'incluir' : 'alterar'} reservas.</p>}
            </>
          )}
          {erro && (
            <p className="msg-erro" role="alert">
              {erro}
            </p>
          )}
        </div>
        <div className="m-foot">
          {!nova && tem('reservas.excluir') &&
            (confirmarExclusao ? (
              <>
                <button type="button" className="btn" onClick={() => setConfirmarExclusao(false)} disabled={ocupado}>
                  Voltar
                </button>
                <button type="button" className="btn perigo" onClick={() => void excluir()} disabled={ocupado}>
                  Confirmar exclusão
                </button>
              </>
            ) : (
              <button type="button" className="btn" onClick={() => setConfirmarExclusao(true)} disabled={ocupado} title="Vai para a lixeira e libera a data">
                <Icone nome="trash" tamanho={16} />
                Excluir
              </button>
            ))}
          <span className="sp" />
          <button type="button" className="btn" onClick={onFechar} disabled={ocupado}>
            {editavel && emDados ? 'Cancelar' : 'Fechar'}
          </button>
          {editavel && emDados && (
            <button type="submit" className="btn pri" disabled={ocupado}>
              {ocupado ? 'Salvando…' : 'Salvar'}
            </button>
          )}
        </div>
      </form>

      {cadastrando && (
        <FormPessoa
          nomeInicial={cadastrando.nome}
          tipoInicial={cadastrando.tipo}
          onFechar={() => setCadastrando(null)}
          onSalvo={(p) => {
            onPessoaNova(p);
            if (cadastrando.tipo === 'locatario') setLocatario(p.id);
            else setLocador(p.id);
            setCadastrando(null);
          }}
        />
      )}
      {devolucao && atual && (
        <RegistrarDevolucao
          reservaId={atual.id}
          recebido={devolucao.recebido}
          formas={devolucao.formas}
          aviso={`Reserva cancelada com ${reais(devolucao.recebido)} recebidos. Registre a devolução (total ou parcial).`}
          onFechar={onFechar}
          onSalvo={() => {
            onMudou();
            onFechar();
          }}
        />
      )}
    </>
  );
}
