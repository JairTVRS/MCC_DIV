import { useEffect, useState, type FormEvent } from 'react';
import { useSessao } from '../../auth/Sessao';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import type { Pessoa, Reserva, StatusCompromisso } from '../../lib/tipos';
import { FormPessoa } from '../pessoas/FormPessoa';
import { SeletorPessoa } from './SeletorPessoa';
import { COMPROMISSO, PAGAMENTO, dataLocal, escreverReais, hojeLocal, horaLocal, lerReais, paraIso, reais } from './formatos';

export const COLUNAS_RESERVA =
  'id, locatario_id, locador_id, responsavel_id, inicio, fim, status_compromisso, status_pagamento, valor_total, observacoes, criado_por, criado_em, alterado_por, alterado_em';

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
  { id: 'pagamento', titulo: 'Pagamento', etapa: 'Condições, parcelas e devolução chegam na etapa 7.' },
  { id: 'anexos', titulo: 'Anexos', etapa: 'Contrato, comprovantes e fotos chegam na etapa 8.' },
  { id: 'comentarios', titulo: 'Comentários', etapa: 'Comentários com menções @ chegam na etapa 8.' },
];

/** Formulário da reserva (card). Horário padrão 00:00–23:59 do dia; avisa conflito antes de salvar. */
export function FormReserva({ reserva, diaInicial, pessoas, usuarios, onPessoaNova, onFechar, onMudou }: Props) {
  const { usuario, tem } = useSessao();
  const nova = !reserva;
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
  const [observacoes, setObservacoes] = useState(reserva?.observacoes ?? '');
  const [pago, setPago] = useState(0);
  const [cadastrando, setCadastrando] = useState<{ tipo: 'locatario' | 'locador'; nome: string } | null>(null);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const vePagamento = tem('pagamentos.visualizar');

  // Valor já recebido (parcelas pagas), para o resumo do topo.
  useEffect(() => {
    if (!reserva || !vePagamento) return;
    void supabase
      .from('parcelas')
      .select('valor')
      .eq('locacao_id', reserva.id)
      .eq('paga', true)
      .eq('excluido', false)
      .then(({ data }) => setPago((data ?? []).reduce((s: number, p: { valor: number }) => s + Number(p.valor), 0)));
  }, [reserva, vePagamento]);

  const total = lerReais(valor);
  const pct = total > 0 ? Math.min(100, Math.round((pago / total) * 100)) : 0;
  const nomeUsuario = (id: string | null) => usuarios.find((u) => u.id === id)?.nome ?? '—';
  const responsaveis = usuarios.filter((u) => u.responsavel || u.id === responsavel);

  // Mudar para Reservado ou Cancelado exige a função própria (a não ser que já esteja assim).
  const statusPermitido = (s: StatusCompromisso) =>
    s === reserva?.status_compromisso || (s === 'reservado' ? tem('reservas.confirmar') : s === 'cancelado' ? tem('reservas.cancelar') : true);

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
    const inicio = paraIso(dataIni, horaIni);
    const fim = paraIso(dataFim, horaFim);
    if (fim <= inicio) return setErro('O fim precisa ser depois do início.');

    setOcupado(true);
    try {
      if (COMPROMISSO[status].bloqueia) {
        const { data, error } = await supabase.rpc('conflito_reserva', { p_inicio: inicio, p_fim: fim, p_ignorar: reserva?.id ?? null });
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
        observacoes: observacoes.trim() || null,
      };
      const { error } = nova ? await supabase.from('locacoes').insert(dados) : await supabase.from('locacoes').update(dados).eq('id', reserva.id);
      if (error) {
        if ((error as { code?: string }).code === '23P01') {
          const { data } = await supabase.rpc('conflito_reserva', { p_inicio: inicio, p_fim: fim, p_ignorar: reserva?.id ?? null });
          throw new Error(`Esse horário já está ocupado${data ? ` pela ${data}` : ' por outra pré-reserva ou reserva'}.`);
        }
        throw error;
      }
      onMudou();
      onFechar();
    } catch (e2) {
      setErro(mensagemErro(e2));
    } finally {
      setOcupado(false);
    }
  }

  async function excluir() {
    if (!reserva) return;
    setOcupado(true);
    setErro(null);
    const { error } = await supabase.rpc('excluir_registro', { p_tabela: 'locacoes', p_id: reserva.id });
    setOcupado(false);
    if (error) {
      setConfirmarExclusao(false);
      return setErro(mensagemErro(error));
    }
    onMudou();
    onFechar();
  }

  const desab = !editavel || ocupado;

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
          {ABAS.map((a) => (
            <button type="button" key={a.id} role="tab" aria-selected={aba === a.id} onClick={() => setAba(a.id)}>
              {a.titulo}
            </button>
          ))}
        </div>
        <div className="m-body">
          {aba !== 'dados' ? (
            <p className="vazio">{ABAS.find((a) => a.id === aba)?.etapa}</p>
          ) : (
            <>
              {vePagamento && (
                <div className="resumo-pg">
                  <div className="resumo-linha">
                    <span>
                      <strong>{reais(pago)}</strong> / {reais(total)}
                    </span>
                    <span className="resumo-pct">{pct}% pago</span>
                    {reserva && <span className={`selo pg-${reserva.status_pagamento}`}>{PAGAMENTO[reserva.status_pagamento]}</span>}
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

              <div className="duas-colunas">
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
              </div>

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

              {reserva && (
                <p className="note auditoria">
                  Criada por {nomeUsuario(reserva.criado_por)} em {new Date(reserva.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  {reserva.alterado_em &&
                    ` · alterada por ${nomeUsuario(reserva.alterado_por)} em ${new Date(reserva.alterado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`}
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
            {editavel ? 'Cancelar' : 'Fechar'}
          </button>
          {editavel && (
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
    </>
  );
}
