import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSessao } from '../../auth/Sessao';
import { abrirComprovante, enviarComprovante, validarComprovante } from '../../lib/comprovantes';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { partesRestantes, refDe, rotuloDias, vencimentoPrazo } from '../../lib/prazos';
import { supabase } from '../../lib/supabase';
import type { Devolucao, FormaPagamento, Parcela, ParcelaPrazo, PrazoPagamento, RefPrazo, Reserva } from '../../lib/tipos';
import { dataLocal, escreverReais, hojeLocal, lerReais, reais } from './formatos';

const dataBr = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR');
const num = (v: unknown) => Number(v) || 0;

/**
 * Janelas da aba Pagamento abrem por cima de tudo (no body): dentro do card da reserva, que é
 * centralizado com transform, elas ficariam presas ao tamanho dele.
 */
const porCima = (conteudo: ReactNode) => createPortal(conteudo, document.body);

/**
 * Comprovante escolhido: miniatura (imagem) ou ícone de PDF com "Abrir", nome, tamanho,
 * e os botões Trocar e Remover. Sem arquivo, mostra o botão de escolher.
 */
function CampoComprovante({ arquivo, onEscolher, onRemover, opcional }: { arquivo: File | null; onEscolher: (f: File | undefined) => void; onRemover: () => void; opcional: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!arquivo) return setUrl(null);
    const u = URL.createObjectURL(arquivo);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [arquivo]);

  const entrada = (texto: string) => (
    <label className="btn peq arquivo">
      <Icone nome="upload" tamanho={16} />
      {texto}
      <input
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          onEscolher(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </label>
  );

  return (
    <div className="campo">
      <span className="rot">Comprovante{opcional ? ' (opcional)' : ''}</span>
      {arquivo && url ? (
        <div className="comprovante">
          {arquivo.type.startsWith('image/') ? (
            <a href={url} target="_blank" rel="noreferrer" className="comprovante-mini" title="Ver em tamanho real">
              <img src={url} alt={`Prévia de ${arquivo.name}`} />
            </a>
          ) : (
            <a href={url} target="_blank" rel="noreferrer" className="comprovante-mini pdf" title="Abrir o PDF">
              PDF
            </a>
          )}
          <div className="comprovante-tx">
            <strong title={arquivo.name}>{arquivo.name}</strong>
            <span>
              {arquivo.size < 1048576 ? `${Math.max(1, Math.round(arquivo.size / 1024))} KB` : `${(arquivo.size / 1048576).toFixed(1)} MB`} ·{' '}
              <a href={url} target="_blank" rel="noreferrer">
                Abrir
              </a>
            </span>
            <span className="acoes">
              {entrada('Trocar')}
              <button type="button" className="btn peq" onClick={onRemover}>
                <Icone nome="trash" tamanho={16} />
                Remover
              </button>
            </span>
          </div>
        </div>
      ) : (
        <>
          {entrada('Escolher arquivo')}
          <span className="note">PDF ou imagem, até 20 MB.</span>
        </>
      )}
    </div>
  );
}

export const valorFinal = (r: Pick<Reserva, 'valor_total' | 'desconto'>) => Math.max(0, Math.round((num(r.valor_total) - num(r.desconto)) * 100) / 100);

interface Dados {
  parcelas: Parcela[];
  devolucoes: Devolucao[];
  formas: FormaPagamento[];
  prazos: PrazoPagamento[];
}

/** Aba Pagamento da reserva: plano de parcelas pelo prazo, pagamentos com comprovante e devolução. */
export function AbaPagamento({ reserva, onMudou }: { reserva: Reserva; onMudou: () => void }) {
  const { tem } = useSessao();
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [plano, setPlano] = useState(false);
  const [pagando, setPagando] = useState<Parcela | null>(null);
  const [anexando, setAnexando] = useState<Parcela | null>(null);
  const [desfazendo, setDesfazendo] = useState<string | null>(null);
  const [devolvendo, setDevolvendo] = useState(false);

  const carregar = useCallback(async () => {
    const [p, d, f, z] = await Promise.all([
      supabase.from('parcelas').select('id, locacao_id, numero, tipo, valor, vencimento, forma_pagamento_id, paga, pago_em, comprovante_id, encerrada, dias_antes_evento').eq('locacao_id', reserva.id).eq('excluido', false).order('numero'),
      supabase.from('devolucoes').select('id, locacao_id, valor_devolvido, valor_retido, data, forma_pagamento_id, motivo, comprovante_id, registrado_em').eq('locacao_id', reserva.id).order('registrado_em'),
      supabase.from('formas_pagamento').select('id, nome, ativo, ordem').order('ordem').order('nome'),
      supabase.from('prazos_pagamento').select('id, nome, parcelas, ativo, ordem').order('ordem').order('nome'),
    ]);
    const falha = p.error ?? d.error ?? f.error ?? z.error;
    if (falha) setErro(mensagemErro(falha));
    setDados({
      parcelas: (p.data ?? []).map((x) => ({ ...(x as Parcela), valor: num((x as Parcela).valor) })),
      devolucoes: (d.data ?? []).map((x) => ({ ...(x as Devolucao), valor_devolvido: num((x as Devolucao).valor_devolvido), valor_retido: num((x as Devolucao).valor_retido) })),
      formas: (f.data ?? []) as FormaPagamento[],
      prazos: (z.data ?? []) as PrazoPagamento[],
    });
  }, [reserva.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function aoMudar() {
    await carregar();
    onMudou();
  }

  if (!dados) return <p className="note">Carregando…</p>;

  const { parcelas, devolucoes, formas } = dados;
  const hoje = hojeLocal();
  const final = valorFinal(reserva);
  const pago = parcelas.filter((p) => p.paga).reduce((s, p) => s + p.valor, 0);
  const devolvido = devolucoes.reduce((s, d) => s + d.valor_devolvido, 0);
  const emAberto = parcelas.filter((p) => !p.paga && !p.encerrada).reduce((s, p) => s + p.valor, 0);
  const semPlano = Math.round((final - pago - emAberto) * 100) / 100;
  const cancelada = reserva.status_compromisso === 'cancelado';
  const nomeForma = (id: string | null) => formas.find((f) => f.id === id)?.nome ?? '—';
  const podePlano = tem('pagamentos.incluir') && tem('pagamentos.alterar') && !cancelada;
  const podePagar = tem('pagamentos.marcar_pago') && !cancelada;
  const podeDevolver = tem('pagamentos.registrar_devolucao') && cancelada && pago - devolvido > 0.004;

  async function desfazer(p: Parcela) {
    setErro(null);
    const { error } = await supabase.from('parcelas').update({ paga: false, comprovante_id: null }).eq('id', p.id);
    setDesfazendo(null);
    if (error) return setErro(mensagemErro(error));
    await aoMudar();
  }

  return (
    <div className="pg">
      <div className="pg-numeros">
        <div>
          <span className="rot">Valor final</span>
          <strong>{reais(final)}</strong>
          {num(reserva.desconto) > 0 && <span className="note">com {reais(num(reserva.desconto))} de desconto</span>}
        </div>
        <div>
          <span className="rot">Pago</span>
          <strong className="ok">{reais(pago)}</strong>
        </div>
        <div>
          <span className="rot">Em aberto</span>
          <strong>{reais(emAberto)}</strong>
        </div>
        {devolvido > 0 && (
          <div>
            <span className="rot">Devolvido</span>
            <strong>{reais(devolvido)}</strong>
          </div>
        )}
      </div>

      {!cancelada && (reserva.status_compromisso === 'cadastrado' || reserva.status_compromisso === 'pre_reserva') && podePagar && (
        <p className="aviso">Ao registrar o primeiro pagamento, a reserva passa sozinha para Reservado e a data fica bloqueada.</p>
      )}
      {cancelada && <p className="aviso">Reserva cancelada: as parcelas em aberto foram encerradas e não recebem pagamento.</p>}
      {!cancelada && Math.abs(semPlano) > 0.004 && parcelas.length > 0 && (
        <p className="aviso">
          {semPlano > 0 ? `Faltam ${reais(semPlano)} no plano para fechar o valor final.` : `O plano passa ${reais(-semPlano)} do valor final.`}
        </p>
      )}

      <div className="secao-cab">
        <h4 className="pg-titulo">
          Parcelas
          {reserva.prazo_id && <span className="pg-prazo">· {dados.prazos.find((p) => p.id === reserva.prazo_id)?.nome ?? 'prazo removido'}</span>}
        </h4>
        {podePlano && (
          <button type="button" className="btn peq" onClick={() => setPlano(true)}>
            <Icone nome="edit" tamanho={16} />
            {parcelas.some((p) => !p.paga && !p.encerrada) ? 'Editar plano' : 'Montar plano pelo prazo'}
          </button>
        )}
      </div>

      {parcelas.length === 0 ? (
        <p className="vazio">{final > 0 ? 'Nenhuma parcela ainda. Monte o plano pelo prazo de pagamento.' : 'Defina o valor da locação na aba Dados para montar o pagamento.'}</p>
      ) : (
        <ul className="parcelas">
          {parcelas.map((p) => {
            const vencida = !p.paga && !p.encerrada && p.vencimento < hoje;
            const sit = p.paga ? `Paga em ${dataBr(p.pago_em ?? p.vencimento)}` : p.encerrada ? 'Encerrada' : vencida ? 'Vencida' : 'Em aberto';
            return (
              <li key={p.id} className={`parcela${p.paga ? ' paga' : ''}${vencida ? ' vencida' : ''}${p.encerrada ? ' encerrada' : ''}`}>
                <span className="parcela-n">{p.tipo === 'entrada' ? 'Entrada' : `${p.numero}ª`}</span>
                <span className="parcela-tx">
                  <strong>{reais(p.valor)}</strong>
                  <span>
                    Vence {dataBr(p.vencimento)} · {nomeForma(p.forma_pagamento_id)}
                  </span>
                </span>
                <span className="parcela-sit">{sit}</span>
                <span className="parcela-acoes">
                  {p.comprovante_id && (
                    <button type="button" className="btn peq" onClick={() => void abrirComprovante(p.comprovante_id!).catch((e) => setErro(mensagemErro(e)))} title="Ver comprovante">
                      <Icone nome="list" tamanho={16} />
                      Comprovante
                    </button>
                  )}
                  {p.paga && !p.comprovante_id && podePagar && (
                    <button type="button" className="btn peq" onClick={() => setAnexando(p)}>
                      <Icone nome="upload" tamanho={16} />
                      Anexar comprovante
                    </button>
                  )}
                  {!p.paga && !p.encerrada && podePagar && (
                    <button type="button" className="btn peq pri" onClick={() => setPagando(p)}>
                      <Icone nome="check" tamanho={16} />
                      Registrar pagamento
                    </button>
                  )}
                  {p.paga && podePagar &&
                    (desfazendo === p.id ? (
                      <>
                        <button type="button" className="btn peq" onClick={() => setDesfazendo(null)}>
                          Voltar
                        </button>
                        <button type="button" className="btn peq perigo" onClick={() => void desfazer(p)}>
                          Confirmar
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn peq" onClick={() => setDesfazendo(p.id)} title="Estorno: a parcela volta a ficar em aberto">
                        Desfazer
                      </button>
                    ))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {desfazendo && pago - (parcelas.find((p) => p.id === desfazendo)?.valor ?? 0) <= 0.004 && reserva.status_compromisso === 'reservado' && (
        <p className="aviso">Sem nenhum valor pago, a reserva volta para Cadastrado e a data é liberada.</p>
      )}

      {(devolucoes.length > 0 || podeDevolver) && (
        <>
          <div className="secao-cab">
            <h4 className="pg-titulo">Devolução</h4>
            {podeDevolver && (
              <button type="button" className="btn peq" onClick={() => setDevolvendo(true)}>
                Registrar devolução
              </button>
            )}
          </div>
          {devolucoes.length === 0 ? (
            <p className="vazio">Reserva cancelada com {reais(pago)} recebidos e nenhuma devolução registrada.</p>
          ) : (
            <ul className="parcelas">
              {devolucoes.map((d) => (
                <li key={d.id} className="parcela">
                  <span className="parcela-n">{dataBr(d.data)}</span>
                  <span className="parcela-tx">
                    <strong>Devolvido {reais(d.valor_devolvido)}</strong>
                    <span>
                      Retido {reais(d.valor_retido)} · {nomeForma(d.forma_pagamento_id)}
                      {d.motivo ? ` · ${d.motivo}` : ''}
                    </span>
                  </span>
                  <span className="parcela-acoes">
                    {d.comprovante_id && (
                      <button type="button" className="btn peq" onClick={() => void abrirComprovante(d.comprovante_id!).catch((e) => setErro(mensagemErro(e)))}>
                        <Icone nome="list" tamanho={16} />
                        Comprovante
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {erro && (
        <p className="msg-erro" role="alert">
          {erro}
        </p>
      )}

      {plano &&
        porCima(
          <EditorPlano reserva={reserva} parcelas={parcelas} prazos={dados.prazos} formas={formas.filter((f) => f.ativo)} onFechar={() => setPlano(false)} onSalvo={() => { setPlano(false); void aoMudar(); }} />,
        )}
      {(pagando || anexando) &&
        porCima(
        <RegistrarPagamento
          parcela={(pagando ?? anexando)!}
          soComprovante={!!anexando}
          formas={formas.filter((f) => f.ativo || f.id === (pagando ?? anexando)!.forma_pagamento_id)}
          avisoReservado={reserva.status_compromisso === 'cadastrado' || reserva.status_compromisso === 'pre_reserva'}
          onFechar={() => { setPagando(null); setAnexando(null); }}
          onSalvo={() => { setPagando(null); setAnexando(null); void aoMudar(); }}
        />,
        )}
      {devolvendo &&
        porCima(
          <RegistrarDevolucao reservaId={reserva.id} recebido={pago - devolvido} formas={formas.filter((f) => f.ativo)} onFechar={() => setDevolvendo(false)} onSalvo={() => { setDevolvendo(false); void aoMudar(); }} />,
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Plano de parcelas: sempre pelo prazo cadastrado. A quantidade de parcelas é a do prazo
// (menos as já pagas); vencimento, forma e valor são ajustáveis, e a última fecha o total sozinha.
// ---------------------------------------------------------------------------------------------
interface LinhaPlano {
  id: string | null;
  valor: string;
  vencimento: string;
  forma: string;
  tipo: 'entrada' | 'parcela';
  dias: number;
  /** De onde contam os dias: após a data base ou antes do evento. */
  ref: RefPrazo;
  /** "Antes do evento" que cairia antes da data base: ficou na data base. */
  ajustada: boolean;
}

function EditorPlano(props: { reserva: Reserva; parcelas: Parcela[]; prazos: PrazoPagamento[]; formas: FormaPagamento[]; onFechar: () => void; onSalvo: () => void }) {
  const { reserva, parcelas, prazos, formas, onFechar, onSalvo } = props;
  const opcoes = prazos.filter((p) => p.ativo || p.id === reserva.prazo_id);
  const pagas = parcelas.filter((p) => p.paga);
  const abertas = parcelas.filter((p) => !p.paga && !p.encerrada);
  const pago = pagas.reduce((s, p) => s + p.valor, 0);
  const aParcelar = Math.max(0, Math.round((valorFinal(reserva) - pago) * 100) / 100);
  const prazoInicial = opcoes.find((p) => p.id === reserva.prazo_id) ?? opcoes[0];
  const [prazoId, setPrazoId] = useState(prazoInicial?.id ?? '');
  const [base, setBase] = useState(reserva.pre_reserva_em ? dataLocal(reserva.pre_reserva_em) : hojeLocal());
  const dataEvento = dataLocal(reserva.inicio);
  const [formaPadrao, setFormaPadrao] = useState(abertas[0]?.forma_pagamento_id ?? formas[0]?.id ?? '');
  const [linhas, setLinhas] = useState<LinhaPlano[]>(() => {
    // Plano já salvo com este prazo: abre com as parcelas em aberto como estão.
    if (prazoInicial && reserva.prazo_id === prazoInicial.id) {
      const salvas = casarSalvas(partesRestantes(prazoInicial.parcelas, pagas));
      if (salvas) return salvas;
    }
    return gerar(prazoInicial, base, formaPadrao);
  });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const prazo = opcoes.find((p) => p.id === prazoId);
  const restantes = prazo ? prazo.parcelas.length - pagas.length : 0;

  /**
   * Põe as parcelas em aberto na ordem do prazo, casando pelo tipo: as que contam do evento com as
   * partes "antes do evento", as outras com as partes após a pré-reserva (cada grupo por vencimento).
   * Assim a "2 dias antes do evento" que vence antes da "30 dias" não troca de lugar com ela.
   */
  function casarSalvas(partes: ParcelaPrazo[]): LinhaPlano[] | null {
    if (partes.length === 0 || abertas.length !== partes.length) return null;
    const porVencimento = (a: Parcela, b: Parcela) => a.vencimento.localeCompare(b.vencimento) || a.numero - b.numero;
    const doEvento = abertas.filter((p) => p.dias_antes_evento != null).sort(porVencimento);
    const outras = abertas.filter((p) => p.dias_antes_evento == null).sort(porVencimento);
    const linhasSalvas: LinhaPlano[] = [];
    for (const x of partes) {
      const ref = refDe(x);
      const p = (ref === 'evento' ? doEvento : outras).shift();
      if (!p) return null;
      linhasSalvas.push({ id: p.id, valor: escreverReais(p.valor), vencimento: p.vencimento, forma: p.forma_pagamento_id ?? '', tipo: p.tipo, dias: x.dias, ref, ajustada: false });
    }
    return linhasSalvas;
  }

  // Parcelas do prazo que ainda faltam pagar; o valor a parcelar é repartido pelos % delas.
  function gerar(p: PrazoPagamento | undefined, dataBase: string, forma: string): LinhaPlano[] {
    if (!p || aParcelar <= 0) return [];
    const partes = partesRestantes(p.parcelas, pagas);
    const somaPct = partes.reduce((s, x) => s + x.percentual, 0);
    let usado = 0;
    return partes.map((x, i) => {
      const ultima = i === partes.length - 1;
      const valor = ultima ? Math.round((aParcelar - usado) * 100) / 100 : Math.floor(((aParcelar * x.percentual) / somaPct) * 100) / 100;
      usado += valor;
      const ref = refDe(x);
      return {
        id: abertas[i]?.id ?? null,
        valor: escreverReais(valor),
        ...vencimentoPrazo(x.dias, ref, dataBase, dataEvento),
        forma,
        tipo: x.dias === 0 && ref === 'reserva' && pagas.length + i === 0 ? 'entrada' : 'parcela',
        dias: x.dias,
        ref,
      };
    });
  }

  function trocarPrazo(id: string) {
    setPrazoId(id);
    setLinhas(gerar(opcoes.find((p) => p.id === id), base, formaPadrao));
  }
  function trocarBase(d: string) {
    setBase(d);
    if (d) setLinhas((ls) => ls.map((l) => ({ ...l, ...vencimentoPrazo(l.dias, l.ref, d, dataEvento) })));
  }
  function trocarForma(f: string) {
    setFormaPadrao(f);
    setLinhas((ls) => ls.map((l) => ({ ...l, forma: f })));
  }

  // Ao mudar o valor de uma parcela, a última recalcula para fechar o total.
  function mudarValor(i: number, texto: string) {
    setLinhas((ls) => {
      const novas = ls.map((l, k) => (k === i ? { ...l, valor: texto.replace(/[^\d.,]/g, '') } : l));
      const ultima = novas.length - 1;
      if (ultima > 0 && i !== ultima) {
        const outras = novas.slice(0, ultima).reduce((s, l) => s + lerReais(l.valor), 0);
        novas[ultima] = { ...novas[ultima], valor: escreverReais(Math.round((aParcelar - outras) * 100) / 100) };
      }
      return novas;
    });
  }
  function mudar(i: number, campo: 'vencimento' | 'forma', valor: string) {
    setLinhas((ls) => ls.map((l, k) => (k === i ? { ...l, [campo]: valor, ajustada: campo === 'vencimento' ? false : l.ajustada } : l)));
  }
  const temEvento = linhas.some((l) => l.ref === 'evento');
  const ajustadas = linhas.filter((l) => l.ajustada);

  const soma = Math.round(linhas.reduce((s, l) => s + lerReais(l.valor), 0) * 100) / 100;
  const algumZero = linhas.some((l) => lerReais(l.valor) <= 0);
  const fecha = Math.abs(soma - aParcelar) <= 0.004;
  const problema = !opcoes.length
    ? 'Cadastre um prazo em Configurações > Prazos de pagamento.'
    : aParcelar <= 0
      ? 'Nada a parcelar: o valor final já está pago (ou a reserva não tem valor).'
      : restantes <= 0
        ? `O prazo "${prazo?.nome}" tem ${prazo?.parcelas.length} parcela(s) e ${pagas.length} já foram pagas. Escolha um prazo com mais parcelas.`
        : algumZero
          ? 'Os valores passam o total: cada parcela precisa de valor maior que zero.'
          : linhas.some((l) => !l.vencimento)
            ? 'Preencha o vencimento de todas as parcelas.'
            : !fecha
              ? `As parcelas somam ${reais(soma)}; precisam fechar ${reais(aParcelar)}.`
              : null;

  async function salvar() {
    if (problema || !prazoId) return;
    setErro(null);
    setOcupado(true);
    const plano = linhas.map((l) => ({ id: l.id, valor: lerReais(l.valor), vencimento: l.vencimento, forma_pagamento_id: l.forma || null, tipo: l.tipo }));
    const { error } = await supabase.rpc('salvar_parcelas', { p_locacao: reserva.id, p_prazo: prazoId, p_parcelas: plano });
    setOcupado(false);
    if (error) return setErro(mensagemErro(error));
    onSalvo();
  }

  return (
    <>
      <div className="scrim alto" onClick={ocupado ? undefined : onFechar} />
      <div className="modal plano alto" role="dialog" aria-modal="true" aria-label="Plano de pagamento">
        <div className="m-head">
          <h2>Plano de pagamento</h2>
          <button type="button" className="ib" onClick={onFechar} aria-label="Fechar" disabled={ocupado}>
            <Icone nome="x" />
          </button>
        </div>
        <div className="m-body">
          <p className="note">
            A parcelar: <strong>{reais(aParcelar)}</strong> (valor final {reais(valorFinal(reserva))}
            {pago > 0 ? ` − ${reais(pago)} já pagos` : ''}). A quantidade de parcelas segue o prazo; parcelas pagas não mudam.
          </p>
          <div className="plano-gerar">
            <label className="campo">
              <span className="rot">Prazo</span>
              <select className="inp" value={prazoId} onChange={(e) => trocarPrazo(e.target.value)} disabled={!opcoes.length}>
                {opcoes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
                {!opcoes.length && <option value="">Nenhum prazo cadastrado</option>}
              </select>
            </label>
            <label className="campo">
              <span className="rot">Data base</span>
              <input className="inp" type="date" value={base} onChange={(e) => trocarBase(e.target.value)} />
            </label>
            <label className="campo">
              <span className="rot">Forma de pagamento</span>
              <select className="inp" value={formaPadrao} onChange={(e) => trocarForma(e.target.value)}>
                {formas.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn" onClick={() => setLinhas(gerar(prazo, base, formaPadrao))} disabled={!prazo || aParcelar <= 0} title="Volta os valores e vencimentos ao que o prazo calcula">
              Refazer pelo prazo
            </button>
            <p className="note plano-dica">
              {reserva.pre_reserva_em
                ? `Data base = dia em que a reserva entrou em Pré-reserva (${new Date(reserva.pre_reserva_em).toLocaleDateString('pt-BR')}); os dias do prazo contam a partir dela.`
                : 'A reserva ainda não é Pré-reserva: a data base começa em hoje. Os dias do prazo contam a partir dela.'}
              {temEvento && ` Parcelas "antes do evento" contam do início do evento (${dataBr(dataEvento)}) e acompanham se a data da reserva mudar.`}
            </p>
          </div>

          {pagas.length > 0 && (
            <p className="note">
              Já pagas (não mudam): {pagas.map((p) => `${p.numero}ª ${reais(p.valor)}`).join(' · ')}
            </p>
          )}

          {linhas.length > 0 && (
            <table className="tabela-plano">
              <thead>
                <tr>
                  <th>Parcela</th>
                  <th>Vencimento</th>
                  <th>Valor (R$)</th>
                  <th>Forma</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => {
                  const ultima = i === linhas.length - 1 && linhas.length > 1;
                  return (
                    <tr key={i}>
                      <td className="plano-n">
                        {l.tipo === 'entrada' ? 'Entrada' : `${pagas.length + i + 1}ª`}
                        <span>{rotuloDias(l.dias, l.ref)}</span>
                      </td>
                      <td>
                        <input className="inp" type="date" value={l.vencimento} aria-label={`Vencimento da parcela ${i + 1}`} onChange={(e) => mudar(i, 'vencimento', e.target.value)} />
                      </td>
                      <td>
                        <input
                          className={`inp${lerReais(l.valor) <= 0 ? ' invalido' : ''}`}
                          inputMode="decimal"
                          value={l.valor}
                          readOnly={ultima}
                          title={ultima ? 'Calculada sozinha para fechar o total' : undefined}
                          aria-label={`Valor da parcela ${i + 1}`}
                          onChange={(e) => mudarValor(i, e.target.value)}
                          onBlur={() => !ultima && mudarValor(i, escreverReais(lerReais(l.valor)))}
                        />
                      </td>
                      <td>
                        <select className="inp" value={l.forma} aria-label={`Forma da parcela ${i + 1}`} onChange={(e) => mudar(i, 'forma', e.target.value)}>
                          <option value="">—</option>
                          {formas.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.nome}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {linhas.length > 1 && <p className="note">A última parcela é calculada sozinha para fechar o total.</p>}
          {ajustadas.length > 0 && (
            <p className="aviso">
              {ajustadas.map((l) => rotuloDias(l.dias, l.ref)).join(', ')}: essa data fica antes da data base ({dataBr(base)}), então o vencimento ficou na data base.
              Confira ou ajuste à mão.
            </p>
          )}
          {(problema || erro) && (
            <p className="msg-erro" role="alert">
              {erro ?? problema}
            </p>
          )}
        </div>
        <div className="m-foot">
          {/* Soma sempre à vista, junto do Salvar. */}
          <span className={`soma-pct plano-soma${!problema ? ' ok' : ''}`}>
            {linhas.length} {linhas.length === 1 ? 'parcela' : 'parcelas'}
            {prazo ? ` de ${prazo.parcelas.length} do prazo` : ''} · {reais(soma)}
            {fecha && linhas.length ? ' · fecha o valor' : ''}
          </span>
          <span className="sp" />
          <button type="button" className="btn" onClick={onFechar} disabled={ocupado}>
            Cancelar
          </button>
          <button type="button" className="btn pri" onClick={() => void salvar()} disabled={ocupado || !!problema}>
            {ocupado ? 'Salvando…' : 'Salvar plano'}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Registrar pagamento (ou só anexar o comprovante de uma parcela já paga)
// ---------------------------------------------------------------------------------------------
function RegistrarPagamento(props: {
  parcela: Parcela;
  soComprovante: boolean;
  formas: FormaPagamento[];
  avisoReservado: boolean;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const { parcela, soComprovante, formas, avisoReservado, onFechar, onSalvo } = props;
  const [data, setData] = useState(hojeLocal());
  const [forma, setForma] = useState(parcela.forma_pagamento_id ?? formas[0]?.id ?? '');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function escolher(f: File | undefined) {
    if (!f) return;
    const problema = validarComprovante(f);
    if (problema) return setErro(problema);
    setErro(null);
    setArquivo(f);
  }

  async function salvar() {
    setOcupado(true);
    setErro(null);
    try {
      if (!soComprovante) {
        // Primeiro o pagamento (pode ser recusado por conflito de data); depois o comprovante.
        const { error } = await supabase.from('parcelas').update({ paga: true, pago_em: data, forma_pagamento_id: forma || null }).eq('id', parcela.id);
        if (error) throw error;
      }
      if (arquivo) {
        try {
          const anexo = await enviarComprovante(parcela.locacao_id, arquivo, { parcela_id: parcela.id });
          const { error } = await supabase.from('parcelas').update({ comprovante_id: anexo }).eq('id', parcela.id);
          if (error) throw error;
        } catch (e) {
          throw new Error(`${soComprovante ? '' : 'Pagamento registrado, mas '}o comprovante não foi enviado: ${mensagemErro(e)}`);
        }
      }
      onSalvo();
    } catch (e) {
      setErro(mensagemErro(e));
      setOcupado(false);
    }
  }

  return (
    <>
      <div className="scrim alto" onClick={ocupado ? undefined : onFechar} />
      <div className="modal estreito alto" role="dialog" aria-modal="true" aria-label={soComprovante ? 'Anexar comprovante' : 'Registrar pagamento'}>
        <div className="m-head">
          <h2>{soComprovante ? 'Anexar comprovante' : 'Registrar pagamento'}</h2>
          <button type="button" className="ib" onClick={onFechar} aria-label="Fechar" disabled={ocupado}>
            <Icone nome="x" />
          </button>
        </div>
        <div className="m-body">
          <p className="mudanca-de-para">
            <strong>
              {parcela.tipo === 'entrada' ? 'Entrada' : `${parcela.numero}ª parcela`} · {reais(parcela.valor)}
            </strong>
            <span className="note">Vencimento {dataBr(parcela.vencimento)}</span>
          </p>
          {!soComprovante && (
            <div className="duas-colunas">
              <label className="campo">
                <span className="rot">Data do pagamento</span>
                <input className="inp" type="date" value={data} max={hojeLocal()} onChange={(e) => setData(e.target.value)} />
              </label>
              <label className="campo">
                <span className="rot">Forma</span>
                <select className="inp" value={forma} onChange={(e) => setForma(e.target.value)}>
                  <option value="">—</option>
                  {formas.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.nome}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <CampoComprovante arquivo={arquivo} onEscolher={escolher} onRemover={() => setArquivo(null)} opcional={!soComprovante} />
          {!soComprovante && avisoReservado && <p className="aviso">Com este pagamento a reserva passa para Reservado e a data fica bloqueada.</p>}
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
          <button type="button" className="btn pri" onClick={() => void salvar()} disabled={ocupado || (soComprovante && !arquivo)}>
            {ocupado ? 'Gravando…' : soComprovante ? 'Anexar' : 'Registrar pagamento'}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Devolução no cancelamento: total ou parcial (a diferença fica retida), com comprovante
// ---------------------------------------------------------------------------------------------
export function RegistrarDevolucao(props: { reservaId: string; recebido: number; formas: FormaPagamento[]; aviso?: string; onFechar: () => void; onSalvo: () => void }) {
  const { reservaId, recebido, formas, aviso, onFechar, onSalvo } = props;
  const [valor, setValor] = useState(escreverReais(recebido));
  const [data, setData] = useState(hojeLocal());
  const [forma, setForma] = useState(formas[0]?.id ?? '');
  const [motivo, setMotivo] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const devolver = lerReais(valor);
  const retido = Math.max(0, Math.round((recebido - devolver) * 100) / 100);

  function escolher(f: File | undefined) {
    if (!f) return;
    const problema = validarComprovante(f);
    if (problema) return setErro(problema);
    setErro(null);
    setArquivo(f);
  }

  async function salvar() {
    setErro(null);
    if (devolver < 0 || devolver > recebido + 0.004) return setErro(`O valor devolvido vai de R$ 0,00 a ${reais(recebido)}.`);
    setOcupado(true);
    try {
      const { data: dev, error } = await supabase
        .from('devolucoes')
        .insert({ locacao_id: reservaId, valor_devolvido: devolver, data, forma_pagamento_id: forma || null, motivo: motivo.trim() || null })
        .select('id')
        .single();
      if (error) throw error;
      if (arquivo) {
        try {
          const anexo = await enviarComprovante(reservaId, arquivo, { devolucao_id: (dev as { id: string }).id });
          const r = await supabase.from('devolucoes').update({ comprovante_id: anexo }).eq('id', (dev as { id: string }).id);
          if (r.error) throw r.error;
        } catch (e) {
          throw new Error(`Devolução registrada, mas o comprovante não foi enviado: ${mensagemErro(e)}`);
        }
      }
      onSalvo();
    } catch (e) {
      setErro(mensagemErro(e));
      setOcupado(false);
    }
  }

  return (
    <>
      <div className="scrim alto" onClick={ocupado ? undefined : onFechar} />
      <div className="modal estreito alto" role="dialog" aria-modal="true" aria-label="Registrar devolução">
        <div className="m-head">
          <h2>Registrar devolução</h2>
          <button type="button" className="ib" onClick={onFechar} aria-label="Fechar" disabled={ocupado}>
            <Icone nome="x" />
          </button>
        </div>
        <div className="m-body">
          {aviso && <p className="aviso">{aviso}</p>}
          <p className="note">Recebido: {reais(recebido)}. Devolva tudo ou parte; o que não for devolvido fica registrado como retido.</p>
          <div className="duas-colunas">
            <label className="campo">
              <span className="rot">Valor devolvido (R$)</span>
              <input className="inp" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ''))} onBlur={() => setValor(escreverReais(lerReais(valor)))} />
              <span className="note">Retido: {reais(retido)}</span>
            </label>
            <label className="campo">
              <span className="rot">Data</span>
              <input className="inp" type="date" value={data} onChange={(e) => setData(e.target.value)} />
            </label>
          </div>
          <label className="campo">
            <span className="rot">Forma</span>
            <select className="inp" value={forma} onChange={(e) => setForma(e.target.value)}>
              <option value="">—</option>
              {formas.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span className="rot">Motivo</span>
            <input className="inp" value={motivo} maxLength={300} placeholder="Ex.: desistência com retenção contratual" onChange={(e) => setMotivo(e.target.value)} />
          </label>
          <CampoComprovante arquivo={arquivo} onEscolher={escolher} onRemover={() => setArquivo(null)} opcional />
          {erro && (
            <p className="msg-erro" role="alert">
              {erro}
            </p>
          )}
        </div>
        <div className="m-foot">
          <span className="sp" />
          <button type="button" className="btn" onClick={onFechar} disabled={ocupado}>
            Registrar depois
          </button>
          <button type="button" className="btn pri" onClick={() => void salvar()} disabled={ocupado}>
            {ocupado ? 'Gravando…' : 'Registrar devolução'}
          </button>
        </div>
      </div>
    </>
  );
}
