import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSessao } from '../../auth/Sessao';
import { mensagemErro } from '../../lib/erros';
import { supabase } from '../../lib/supabase';
import type { Parcela, Pessoa, Reserva, StatusCompromisso, StatusPagamento } from '../../lib/tipos';
import { carregarBase, type Contadores } from '../agenda/base';
import { COLUNAS_RESERVA, FormReserva, normalizarReserva, type AbaReserva, type UsuarioCurto } from '../agenda/FormReserva';
import { COMPROMISSO, PAGAMENTO, hojeLocal, reais } from '../agenda/formatos';
import { Tabela, type Coluna } from './Tabela';

type Aba = 'reservas' | 'parcelas';
const STATUS: StatusCompromisso[] = ['cadastrado', 'pre_reserva', 'reservado', 'cancelado'];
const SITUACOES_PG: StatusPagamento[] = ['pendente', 'parcial', 'pago', 'devolvido', 'devolvido_parcial'];
type Situacao = 'a_vencer' | 'vencida' | 'paga' | 'encerrada';
const SITUACAO: Record<Situacao, string> = { a_vencer: 'A vencer', vencida: 'Vencida', paga: 'Paga', encerrada: 'Encerrada (cancelada)' };

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dataBr = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '');
const dataHoraBr = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const diaLocal = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const somaDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T12:00:00`);
  d.setDate(d.getDate() + n);
  return diaLocal(d.toISOString());
};

/** Atalhos de período (datas locais AAAA-MM-DD). */
function atalho(qual: 'mes' | 'proximos' | 'ano' | 'tudo'): { de: string; ate: string } {
  const hoje = hojeLocal();
  const [a, m] = hoje.split('-');
  if (qual === 'mes') {
    const fim = new Date(Number(a), Number(m), 0).getDate();
    return { de: `${a}-${m}-01`, ate: `${a}-${m}-${String(fim).padStart(2, '0')}` };
  }
  if (qual === 'proximos') return { de: hoje, ate: somaDias(hoje, 30) };
  if (qual === 'ano') return { de: `${a}-01-01`, ate: `${a}-12-31` };
  return { de: '', ate: '' };
}

interface LinhaReserva extends Reserva {
  locatario: string;
  locador: string;
  responsavel: string;
  final: number;
  pago: number;
  aReceber: number;
  anexos: number;
  comentarios: number;
  prazo: string;
}
interface LinhaParcela extends Parcela {
  reserva: Reserva;
  locatario: string;
  responsavel: string;
  forma: string;
  situacao: Situacao;
  atraso: number;
}

/** Lista / Relatório: reservas e parcelas com filtros, totais, colunas à escolha e CSV. */
export function Relatorio() {
  const { tem } = useSessao();
  const vePagamento = tem('pagamentos.visualizar');
  const podeExportar = tem('lista.exportar');
  const [aba, setAba] = useState<Aba>('reservas');
  const [reservas, setReservas] = useState<Reserva[] | null>(null);
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [devolvido, setDevolvido] = useState<Map<string, number>>(new Map());
  const [formas, setFormas] = useState<Map<string, string>>(new Map());
  const [prazos, setPrazos] = useState<Map<string, string>>(new Map());
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioCurto[]>([]);
  const [contadores, setContadores] = useState<Contadores>(new Map());
  const [aberta, setAberta] = useState<{ reserva: Reserva; aba: AbaReserva } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [r, base, pa, de, fo, pz] = await Promise.all([
        supabase.from('locacoes').select(COLUNAS_RESERVA).eq('excluido', false).order('inicio'),
        carregarBase(),
        vePagamento
          ? supabase.from('parcelas').select('id, locacao_id, numero, tipo, valor, vencimento, forma_pagamento_id, paga, pago_em, comprovante_id, encerrada').eq('excluido', false)
          : Promise.resolve({ data: [], error: null }),
        vePagamento ? supabase.from('devolucoes').select('locacao_id, valor_devolvido') : Promise.resolve({ data: [], error: null }),
        supabase.from('formas_pagamento').select('id, nome'),
        supabase.from('prazos_pagamento').select('id, nome'),
      ]);
      const falha = r.error ?? pa.error ?? de.error;
      if (falha) throw falha;
      setReservas((r.data ?? []).map(normalizarReserva));
      setPessoas(base.pessoas);
      setUsuarios(base.usuarios);
      setContadores(base.contadores);
      setParcelas(((pa.data ?? []) as Parcela[]).map((p) => ({ ...p, valor: Number(p.valor) })));
      const dev = new Map<string, number>();
      for (const d of (de.data ?? []) as { locacao_id: string; valor_devolvido: number }[]) dev.set(d.locacao_id, (dev.get(d.locacao_id) ?? 0) + Number(d.valor_devolvido));
      setDevolvido(dev);
      setFormas(new Map(((fo.data ?? []) as { id: string; nome: string }[]).map((f) => [f.id, f.nome])));
      setPrazos(new Map(((pz.data ?? []) as { id: string; nome: string }[]).map((f) => [f.id, f.nome])));
      setErro(null);
    } catch (e) {
      setErro(mensagemErro(e));
      setReservas((r) => r ?? []);
    }
  }, [vePagamento]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const nomePessoa = useCallback((id: string) => pessoas.find((p) => p.id === id)?.nome ?? '—', [pessoas]);
  const nomeUsuario = useCallback((id: string | null) => (id ? usuarios.find((u) => u.id === id)?.nome ?? '—' : '—'), [usuarios]);

  const linhasReserva = useMemo<LinhaReserva[]>(() => {
    if (!reservas) return [];
    const recebido = new Map<string, number>();
    for (const p of parcelas) if (p.paga) recebido.set(p.locacao_id, (recebido.get(p.locacao_id) ?? 0) + p.valor);
    return reservas.map((r) => {
      const final = Math.max(0, r.valor_total - r.desconto);
      const pago = Math.round(((recebido.get(r.id) ?? 0) - (devolvido.get(r.id) ?? 0)) * 100) / 100;
      const cancelada = r.status_compromisso === 'cancelado';
      return {
        ...r,
        locatario: nomePessoa(r.locatario_id),
        locador: nomePessoa(r.locador_id),
        responsavel: nomeUsuario(r.responsavel_id),
        final,
        pago,
        aReceber: cancelada ? 0 : Math.max(0, Math.round((final - (recebido.get(r.id) ?? 0)) * 100) / 100),
        anexos: contadores.get(r.id)?.anexos ?? 0,
        comentarios: contadores.get(r.id)?.comentarios ?? 0,
        prazo: r.prazo_id ? prazos.get(r.prazo_id) ?? '' : '',
      };
    });
  }, [reservas, parcelas, devolvido, contadores, prazos, nomePessoa, nomeUsuario]);

  const linhasParcela = useMemo<LinhaParcela[]>(() => {
    if (!reservas) return [];
    const porId = new Map(reservas.map((r) => [r.id, r]));
    const hoje = hojeLocal();
    const lista: LinhaParcela[] = [];
    for (const p of parcelas) {
      const r = porId.get(p.locacao_id);
      if (!r) continue;
      const situacao: Situacao = p.paga ? 'paga' : p.encerrada ? 'encerrada' : p.vencimento < hoje ? 'vencida' : 'a_vencer';
      const atraso = situacao === 'vencida' ? Math.round((new Date(`${hoje}T12:00:00`).getTime() - new Date(`${p.vencimento}T12:00:00`).getTime()) / 86400000) : 0;
      lista.push({
        ...p,
        reserva: r,
        locatario: nomePessoa(r.locatario_id),
        responsavel: nomeUsuario(r.responsavel_id),
        forma: p.forma_pagamento_id ? formas.get(p.forma_pagamento_id) ?? '' : '',
        situacao,
        atraso,
      });
    }
    return lista;
  }, [reservas, parcelas, formas, nomePessoa, nomeUsuario]);

  if (!reservas) return <p className="note">Carregando…</p>;

  return (
    <div className="pagina larga">
      {vePagamento && (
        <div className="tabs" role="tablist" aria-label="Relatórios">
          <button role="tab" aria-selected={aba === 'reservas'} onClick={() => setAba('reservas')}>
            Reservas
          </button>
          <button role="tab" aria-selected={aba === 'parcelas'} onClick={() => setAba('parcelas')}>
            Parcelas
          </button>
        </div>
      )}
      {erro && (
        <p className="msg-erro" role="alert">
          {erro}
        </p>
      )}
      {aba === 'reservas' || !vePagamento ? (
        <RelReservas linhas={linhasReserva} usuarios={usuarios} vePagamento={vePagamento} podeExportar={podeExportar} onAbrir={(r) => setAberta({ reserva: r, aba: 'dados' })} />
      ) : (
        <RelParcelas linhas={linhasParcela} formas={formas} podeExportar={podeExportar} onAbrir={(p) => setAberta({ reserva: p.reserva, aba: 'pagamento' })} />
      )}
      {aberta && (
        <FormReserva
          key={aberta.reserva.id}
          reserva={aberta.reserva}
          abaInicial={aberta.aba}
          pessoas={pessoas}
          usuarios={usuarios}
          onPessoaNova={(p) => setPessoas((ps) => [...ps, p].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')))}
          onFechar={() => setAberta(null)}
          onMudou={() => void carregar()}
        />
      )}
    </div>
  );
}

/** Filtro de período com atalhos. */
function Periodo({ de, ate, onMudar, rotulo }: { de: string; ate: string; onMudar: (de: string, ate: string) => void; rotulo: string }) {
  return (
    <div className="rel-periodo">
      <label className="campo">
        <span className="rot">{rotulo}: de</span>
        <input className="inp" type="date" value={de} max={ate || undefined} onChange={(e) => onMudar(e.target.value, ate)} />
      </label>
      <label className="campo">
        <span className="rot">até</span>
        <input className="inp" type="date" value={ate} min={de || undefined} onChange={(e) => onMudar(de, e.target.value)} />
      </label>
      <div className="chips" role="group" aria-label="Atalhos de período">
        {(
          [
            ['mes', 'Este mês'],
            ['proximos', 'Próximos 30 dias'],
            ['ano', 'Este ano'],
            ['tudo', 'Tudo'],
          ] as const
        ).map(([q, r]) => {
          const p = atalho(q);
          return (
            <button key={q} className="chip" aria-pressed={p.de === de && p.ate === ate} onClick={() => onMudar(p.de, p.ate)}>
              {r}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Chips de marcar vários (nada marcado = todos). */
function Marcar<T extends string>({ opcoes, rotulo, marcados, onMudar, rotuloDe }: { opcoes: T[]; rotulo: string; marcados: T[]; onMudar: (v: T[]) => void; rotuloDe: (v: T) => string }) {
  return (
    <div className="rel-marcar">
      <span className="rot">{rotulo}</span>
      <div className="chips" role="group" aria-label={rotulo}>
        {opcoes.map((o) => (
          <button key={o} className="chip" aria-pressed={marcados.includes(o)} onClick={() => onMudar(marcados.includes(o) ? marcados.filter((x) => x !== o) : [...marcados, o])}>
            {rotuloDe(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

function RelReservas({
  linhas,
  usuarios,
  vePagamento,
  podeExportar,
  onAbrir,
}: {
  linhas: LinhaReserva[];
  usuarios: UsuarioCurto[];
  vePagamento: boolean;
  podeExportar: boolean;
  onAbrir: (r: Reserva) => void;
}) {
  const [periodo, setPeriodo] = useState(() => atalho('tudo'));
  const [status, setStatus] = useState<StatusCompromisso[]>([]);
  const [pagamento, setPagamento] = useState<StatusPagamento[]>([]);
  const [responsavel, setResponsavel] = useState('');
  const [busca, setBusca] = useState('');

  const termo = semAcento(busca.trim());
  const filtradas = linhas.filter((r) => {
    const dia = diaLocal(r.inicio);
    return (
      (!periodo.de || dia >= periodo.de) &&
      (!periodo.ate || dia <= periodo.ate) &&
      (!status.length || status.includes(r.status_compromisso)) &&
      (!pagamento.length || pagamento.includes(r.status_pagamento)) &&
      (!responsavel || r.responsavel_id === responsavel) &&
      (!termo || semAcento(`${r.locatario} ${r.locador} ${r.observacoes ?? ''}`).includes(termo))
    );
  });

  const colunas: Coluna<LinhaReserva>[] = [
    { id: 'inicio', titulo: 'Início', valor: (r) => r.inicio, mostrar: (r) => dataHoraBr(r.inicio), csv: (r) => dataHoraBr(r.inicio), padrao: true },
    { id: 'fim', titulo: 'Fim', valor: (r) => r.fim, mostrar: (r) => dataHoraBr(r.fim), csv: (r) => dataHoraBr(r.fim) },
    { id: 'locatario', titulo: 'Locatário', valor: (r) => r.locatario, padrao: true },
    { id: 'locador', titulo: 'Locador', valor: (r) => r.locador },
    { id: 'responsavel', titulo: 'Responsável', valor: (r) => r.responsavel, padrao: true },
    {
      id: 'status',
      titulo: 'Status',
      valor: (r) => COMPROMISSO[r.status_compromisso].rotulo,
      mostrar: (r) => <span className={`status-chip st-${r.status_compromisso}`}>{COMPROMISSO[r.status_compromisso].rotulo}</span>,
      padrao: true,
    },
    ...(vePagamento
      ? ([
          { id: 'valor', titulo: 'Valor', valor: (r) => r.valor_total, tipo: 'moeda', soma: true },
          { id: 'desconto', titulo: 'Desconto', valor: (r) => r.desconto, tipo: 'moeda', soma: true },
          { id: 'final', titulo: 'Valor final', valor: (r) => r.final, tipo: 'moeda', soma: true, padrao: true },
          { id: 'pago', titulo: 'Recebido', valor: (r) => r.pago, tipo: 'moeda', soma: true, padrao: true },
          { id: 'receber', titulo: 'A receber', valor: (r) => r.aReceber, tipo: 'moeda', soma: true, padrao: true },
          {
            id: 'pagamento',
            titulo: 'Pagamento',
            valor: (r) => PAGAMENTO[r.status_pagamento],
            mostrar: (r) => <span className={`selo pg-${r.status_pagamento}`}>{PAGAMENTO[r.status_pagamento]}</span>,
            padrao: true,
          },
          { id: 'prazo', titulo: 'Prazo', valor: (r) => r.prazo },
          { id: 'motivo_desconto', titulo: 'Motivo do desconto', valor: (r) => r.motivo_desconto },
        ] as Coluna<LinhaReserva>[])
      : []),
    { id: 'anexos', titulo: 'Anexos', valor: (r) => r.anexos, tipo: 'numero' },
    { id: 'comentarios', titulo: 'Comentários', valor: (r) => r.comentarios, tipo: 'numero' },
    { id: 'observacoes', titulo: 'Observações', valor: (r) => r.observacoes },
    { id: 'criado_por', titulo: 'Criado por', valor: (r) => usuarios.find((u) => u.id === r.criado_por)?.nome ?? '' },
    { id: 'criado_em', titulo: 'Criado em', valor: (r) => r.criado_em, mostrar: (r) => dataHoraBr(r.criado_em), csv: (r) => dataHoraBr(r.criado_em) },
    { id: 'alterado_por', titulo: 'Alterado por', valor: (r) => usuarios.find((u) => u.id === r.alterado_por)?.nome ?? '' },
    { id: 'alterado_em', titulo: 'Alterado em', valor: (r) => r.alterado_em, mostrar: (r) => dataHoraBr(r.alterado_em), csv: (r) => dataHoraBr(r.alterado_em) },
  ];

  const responsaveis = usuarios.filter((u) => linhas.some((r) => r.responsavel_id === u.id));

  return (
    <section className="secao">
      <div className="rel-filtros">
        <Periodo rotulo="Data da reserva" de={periodo.de} ate={periodo.ate} onMudar={(de, ate) => setPeriodo({ de, ate })} />
        <Marcar opcoes={STATUS} rotulo="Status" marcados={status} onMudar={setStatus} rotuloDe={(s) => COMPROMISSO[s].rotulo} />
        {vePagamento && <Marcar opcoes={SITUACOES_PG} rotulo="Pagamento" marcados={pagamento} onMudar={setPagamento} rotuloDe={(s) => PAGAMENTO[s]} />}
        <div className="rel-linha">
          <label className="campo">
            <span className="rot">Responsável</span>
            <select className="inp" value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
              <option value="">Todos</option>
              {responsaveis.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="campo rel-busca">
            <span className="rot">Buscar</span>
            <input className="inp" type="search" value={busca} placeholder="Locatário, locador ou observação" onChange={(e) => setBusca(e.target.value)} />
          </label>
        </div>
      </div>
      <Tabela
        colunas={colunas}
        linhas={filtradas}
        chave={(r) => r.id}
        lembrar="rel-colunas-reservas"
        ordemInicial={{ coluna: 'inicio' }}
        onAbrir={onAbrir}
        exportar={podeExportar ? `reservas-${hojeLocal()}.csv` : undefined}
        vazio="Nenhuma reserva com esses filtros."
      />
    </section>
  );
}

function RelParcelas({
  linhas,
  formas,
  podeExportar,
  onAbrir,
}: {
  linhas: LinhaParcela[];
  formas: Map<string, string>;
  podeExportar: boolean;
  onAbrir: (p: LinhaParcela) => void;
}) {
  const [por, setPor] = useState<'vencimento' | 'pagamento'>('vencimento');
  const [periodo, setPeriodo] = useState(() => atalho('mes'));
  const [situacoes, setSituacoes] = useState<Situacao[]>([]);
  const [forma, setForma] = useState('');
  const [busca, setBusca] = useState('');

  const termo = semAcento(busca.trim());
  const filtradas = linhas.filter((p) => {
    const dia = por === 'vencimento' ? p.vencimento : p.pago_em ?? '';
    return (
      (!periodo.de || (dia && dia >= periodo.de)) &&
      (!periodo.ate || (dia && dia <= periodo.ate)) &&
      (!situacoes.length || situacoes.includes(p.situacao)) &&
      (!forma || p.forma_pagamento_id === forma) &&
      (!termo || semAcento(p.locatario).includes(termo))
    );
  });

  const soma = (s: Situacao | null) => filtradas.filter((p) => !s || p.situacao === s).reduce((t, p) => t + p.valor, 0);

  const colunas: Coluna<LinhaParcela>[] = [
    { id: 'vencimento', titulo: 'Vencimento', valor: (p) => p.vencimento, mostrar: (p) => dataBr(p.vencimento), csv: (p) => dataBr(p.vencimento), padrao: true },
    { id: 'locatario', titulo: 'Locatário', valor: (p) => p.locatario, padrao: true },
    { id: 'reserva', titulo: 'Data da reserva', valor: (p) => p.reserva.inicio, mostrar: (p) => dataBr(diaLocal(p.reserva.inicio)), csv: (p) => dataBr(diaLocal(p.reserva.inicio)), padrao: true },
    { id: 'parcela', titulo: 'Parcela', valor: (p) => (p.tipo === 'entrada' ? 'Entrada' : `Parcela ${p.numero}`), padrao: true },
    { id: 'valor', titulo: 'Valor', valor: (p) => p.valor, tipo: 'moeda', soma: true, padrao: true },
    {
      id: 'situacao',
      titulo: 'Situação',
      valor: (p) => SITUACAO[p.situacao],
      mostrar: (p) => <span className={`selo sit-${p.situacao}`}>{SITUACAO[p.situacao]}</span>,
      padrao: true,
    },
    { id: 'atraso', titulo: 'Dias em atraso', valor: (p) => (p.atraso || null), tipo: 'numero', padrao: true },
    { id: 'pago_em', titulo: 'Pago em', valor: (p) => p.pago_em, mostrar: (p) => dataBr(p.pago_em) || '—', csv: (p) => dataBr(p.pago_em), padrao: true },
    { id: 'forma', titulo: 'Forma', valor: (p) => p.forma, padrao: true },
    { id: 'comprovante', titulo: 'Comprovante', valor: (p) => (p.comprovante_id ? 'Sim' : p.paga ? 'Não' : '') },
    { id: 'status', titulo: 'Status da reserva', valor: (p) => COMPROMISSO[p.reserva.status_compromisso].rotulo },
    { id: 'responsavel', titulo: 'Responsável', valor: (p) => p.responsavel },
  ];

  return (
    <section className="secao">
      <div className="rel-resumo">
        <div>
          <span>Total no filtro</span>
          <strong>{reais(soma(null))}</strong>
        </div>
        <div className="ok">
          <span>Recebido</span>
          <strong>{reais(soma('paga'))}</strong>
        </div>
        <div>
          <span>A vencer</span>
          <strong>{reais(soma('a_vencer'))}</strong>
        </div>
        <div className="perigo">
          <span>Vencido</span>
          <strong>{reais(soma('vencida'))}</strong>
        </div>
      </div>
      <div className="rel-filtros">
        <div className="rel-linha">
          <label className="campo">
            <span className="rot">Período por</span>
            <select className="inp" value={por} onChange={(e) => setPor(e.target.value as 'vencimento' | 'pagamento')}>
              <option value="vencimento">Vencimento</option>
              <option value="pagamento">Data do pagamento</option>
            </select>
          </label>
        </div>
        <Periodo rotulo={por === 'vencimento' ? 'Vencimento' : 'Pagamento'} de={periodo.de} ate={periodo.ate} onMudar={(de, ate) => setPeriodo({ de, ate })} />
        <Marcar opcoes={['a_vencer', 'vencida', 'paga', 'encerrada'] as Situacao[]} rotulo="Situação" marcados={situacoes} onMudar={setSituacoes} rotuloDe={(s) => SITUACAO[s]} />
        <div className="rel-linha">
          <label className="campo">
            <span className="rot">Forma</span>
            <select className="inp" value={forma} onChange={(e) => setForma(e.target.value)}>
              <option value="">Todas</option>
              {[...formas.entries()].map(([id, nome]) => (
                <option key={id} value={id}>
                  {nome}
                </option>
              ))}
            </select>
          </label>
          <label className="campo rel-busca">
            <span className="rot">Buscar</span>
            <input className="inp" type="search" value={busca} placeholder="Locatário" onChange={(e) => setBusca(e.target.value)} />
          </label>
        </div>
      </div>
      <Tabela
        colunas={colunas}
        linhas={filtradas}
        chave={(p) => p.id}
        lembrar="rel-colunas-parcelas"
        ordemInicial={{ coluna: 'vencimento' }}
        onAbrir={onAbrir}
        exportar={podeExportar ? `parcelas-${hojeLocal()}.csv` : undefined}
        vazio="Nenhuma parcela com esses filtros."
      />
    </section>
  );
}
