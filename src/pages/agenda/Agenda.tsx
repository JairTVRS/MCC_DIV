import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import type FullCalendar from '@fullcalendar/react';
import { useSessao } from '../../auth/Sessao';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import type { ItemCadastro, Pessoa, Reserva, StatusCompromisso } from '../../lib/tipos';
import type { Mudanca, VisaoCalendario } from './Calendario';
import { ConfirmarMudanca } from './ConfirmarMudanca';
import { FiltroMulti, lembrados, lembrar, type OpcaoFiltro } from './FiltroMulti';
import { COLUNAS_RESERVA, FormReserva, normalizarReserva, type AbaReserva, type UsuarioCurto } from './FormReserva';
import { ListaReservas } from './ListaReservas';
import { carregarBase, type Contadores } from './base';
import { COMPROMISSO, dataLocal } from './formatos';

const STATUS: StatusCompromisso[] = ['cadastrado', 'pre_reserva', 'reservado', 'cancelado'];
/** Opção "sem movimento/paróquia" (locatário cadastrado antes da v1.1.0). */
const SEM = '-';

/** Filtros da barra (marcados lembrados no aparelho; nada marcado = todos). */
type Filtros = { status: Set<string>; movimento: Set<string>; paroquia: Set<string> };
const CHAVE: Record<keyof Filtros, string> = { status: 'agenda-filtro-status', movimento: 'agenda-filtro-movimento', paroquia: 'agenda-filtro-paroquia' };

/**
 * Opções de um filtro de cadastro: ativos e os desativados que ainda têm reserva,
 * mais "Sem …" quando há locatário sem o campo. Quantidade = reservas carregadas.
 */
function opcoesCadastro(itens: ItemCadastro[], contagem: Map<string, number>, sem: string): OpcaoFiltro[] {
  const lista: OpcaoFiltro[] = itens.filter((i) => i.ativo || contagem.has(i.id)).map((i) => ({ id: i.id, nome: i.nome, qtd: contagem.get(i.id) ?? 0 }));
  if (contagem.has(SEM)) lista.push({ id: SEM, nome: sem, qtd: contagem.get(SEM) ?? 0 });
  return lista;
}

type Visao = 'mes' | 'semana' | 'dia' | 'lista' | 'dias';
const FC: Record<Exclude<Visao, 'lista'>, VisaoCalendario> = { mes: 'dayGridMonth', semana: 'timeGridWeek', dia: 'timeGridDay', dias: 'listWeek' };
const VISOES_PC: { id: Visao; titulo: string }[] = [
  { id: 'mes', titulo: 'Mês' },
  { id: 'semana', titulo: 'Semana' },
  { id: 'dia', titulo: 'Dia' },
  { id: 'lista', titulo: 'Lista' },
];
const VISOES_CELULAR: { id: Visao; titulo: string }[] = [
  { id: 'dias', titulo: 'Dia por dia' },
  { id: 'mes', titulo: 'Mês' },
];
const CELULAR = '(max-width: 760px)';


/** Pedido para abrir uma reserva vindo da URL (sino): "#agenda?r=<id>&aba=comentarios&c=<comentário>". */
function pedidoDaUrl(): { id: string; aba?: AbaReserva; comentario?: string } | null {
  const [pagina, busca] = window.location.hash.replace('#', '').split('?');
  if (pagina !== 'agenda' || !busca) return null;
  const q = new URLSearchParams(busca);
  const id = q.get('r');
  if (!id) return null;
  return { id, aba: (q.get('aba') as AbaReserva) || undefined, comentario: q.get('c') || undefined };
}

// Se uma versão nova foi publicada com o app aberto, o arquivo antigo do calendário some do servidor:
// em vez de erro, recarrega a página (que já busca a versão nova).
const Calendario = lazy(() =>
  import('./Calendario').catch(() => {
    window.location.reload();
    return new Promise<never>(() => {});
  }),
);

/** Visão lembrada por aparelho; padrão: Mês no computador, Dia por dia no celular. */
function visaoLembrada(celular: boolean): Visao {
  const opcoes = celular ? VISOES_CELULAR : VISOES_PC;
  try {
    const v = localStorage.getItem(celular ? 'agenda-visao-celular' : 'agenda-visao');
    if (opcoes.some((o) => o.id === v)) return v as Visao;
  } catch {
    /* armazenamento indisponível */
  }
  return celular ? 'dias' : 'mes';
}

/** Agenda: Mês, Semana e Dia (arrastar no computador/tablet), Lista; no celular, Dia por dia e Mês. */
export function Agenda() {
  const { tem } = useSessao();
  const [reservas, setReservas] = useState<Reserva[] | null>(null);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioCurto[]>([]);
  const [celular, setCelular] = useState(() => window.matchMedia(CELULAR).matches);
  const [visao, setVisao] = useState<Visao>(() => visaoLembrada(window.matchMedia(CELULAR).matches));
  const [titulo, setTitulo] = useState('');
  const [periodo, setPeriodo] = useState<{ inicio: Date; fim: Date }>(() => ({ inicio: new Date(), fim: new Date() }));
  const [aberta, setAberta] = useState<{ reserva: Reserva | null; dia?: string; aba?: AbaReserva; comentario?: string; vez?: number } | null>(null);
  const [contadores, setContadores] = useState<Contadores>(new Map());
  const [mudanca, setMudanca] = useState<Mudanca | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<Filtros>(() => ({ status: lembrados(CHAVE.status), movimento: lembrados(CHAVE.movimento), paroquia: lembrados(CHAVE.paroquia) }));
  const [movimentos, setMovimentos] = useState<ItemCadastro[]>([]);
  const [paroquias, setParoquias] = useState<ItemCadastro[]>([]);
  const cal = useRef<FullCalendar>(null);

  function mudarFiltro(qual: keyof Filtros, novo: Set<string>) {
    setFiltros((f) => ({ ...f, [qual]: novo }));
    lembrar(CHAVE[qual], novo);
  }

  // Ao passar de computador para celular (ou o contrário), troca para a visão daquele aparelho.
  useEffect(() => {
    const m = window.matchMedia(CELULAR);
    const f = () => {
      setCelular(m.matches);
      setVisao(visaoLembrada(m.matches));
    };
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);

  const carregar = useCallback(async () => {
    try {
      const [r, base] = await Promise.all([supabase.from('locacoes').select(COLUNAS_RESERVA).eq('excluido', false).order('inicio'), carregarBase()]);
      if (r.error) throw r.error;
      setContadores(base.contadores);
      setReservas((r.data ?? []).map(normalizarReserva));
      setPessoas(base.pessoas);
      setUsuarios(base.usuarios);
      setMovimentos(base.movimentos);
      setParoquias(base.paroquias);
      setErro(null);
    } catch (e) {
      setErro(mensagemErro(e));
      setReservas((r) => r ?? []);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Veio do sino ("#agenda?r=…"): abre a reserva na aba pedida e limpa a URL.
  const carregou = reservas !== null;
  useEffect(() => {
    if (!carregou) return;
    const abrirPedido = async () => {
      const pedido = pedidoDaUrl();
      if (!pedido) return;
      window.history.replaceState(null, '', '#agenda');
      const { data, error } = await supabase.from('locacoes').select(COLUNAS_RESERVA).eq('id', pedido.id).maybeSingle();
      if (error || !data) return setErro('Essa reserva não existe mais ou você não tem acesso a ela.');
      setAberta({ reserva: normalizarReserva(data), aba: pedido.aba, comentario: pedido.comentario, vez: Date.now() });
    };
    void abrirPedido();
    window.addEventListener('hashchange', abrirPedido);
    return () => window.removeEventListener('hashchange', abrirPedido);
  }, [carregou]);

  // O aviso "Reserva movida" some sozinho.
  useEffect(() => {
    if (!aviso) return;
    const t = window.setTimeout(() => setAviso(null), 4000);
    return () => window.clearTimeout(t);
  }, [aviso]);

  const nomePessoa = useCallback((id: string) => pessoas.find((p) => p.id === id)?.nome ?? '(pessoa excluída)', [pessoas]);
  const nomeUsuario = (id: string) => usuarios.find((u) => u.id === id)?.nome ?? '—';

  function trocarVisao(v: Visao, data?: Date) {
    setVisao(v);
    try {
      localStorage.setItem(celular ? 'agenda-visao-celular' : 'agenda-visao', v);
    } catch {
      /* armazenamento indisponível */
    }
    if (v !== 'lista') cal.current?.getApi().changeView(FC[v], data);
  }

  // "Nova reserva" pelo botão: o dia mostrado na visão Dia; hoje, se estiver no período mostrado; senão, o primeiro dia dele.
  function diaParaNova(): string | undefined {
    if (visao === 'lista') return undefined;
    if (visao === 'dia') return dataLocal(periodo.inicio.toISOString());
    const hoje = new Date();
    return dataLocal((hoje >= periodo.inicio && hoje < periodo.fim ? hoje : periodo.inicio).toISOString());
  }

  if (!reservas) return <p className="note">Carregando…</p>;
  const vePagamento = tem('pagamentos.visualizar');
  const podeIncluir = tem('reservas.incluir');
  const visoes = celular ? VISOES_CELULAR : VISOES_PC;
  const calendario = visao !== 'lista';
  // Movimento e paróquia vêm do locatário da reserva.
  const locatario = new Map(pessoas.map((p) => [p.id, p]));
  const movDe = (r: Reserva) => locatario.get(r.locatario_id)?.movimento_id ?? SEM;
  const parDe = (r: Reserva) => locatario.get(r.locatario_id)?.paroquia_id ?? SEM;
  const contar = (f: (r: Reserva) => string) => {
    const m = new Map<string, number>();
    for (const r of reservas) m.set(f(r), (m.get(f(r)) ?? 0) + 1);
    return m;
  };
  const opcoes: Record<keyof Filtros, OpcaoFiltro[]> = {
    status: STATUS.map((s) => ({ id: s, nome: COMPROMISSO[s].rotulo, qtd: reservas.filter((r) => r.status_compromisso === s).length, classe: `st-${s}` })),
    movimento: opcoesCadastro(movimentos, contar(movDe), 'Sem movimento'),
    paroquia: opcoesCadastro(paroquias, contar(parDe), 'Sem paróquia'),
  };
  // Só valem os marcados que ainda estão entre as opções (cadastro desativado sem reserva some do filtro).
  const ativo = (qual: keyof Filtros) => new Set(opcoes[qual].filter((o) => filtros[qual].has(o.id)).map((o) => o.id));
  const fStatus = ativo('status');
  const fMov = ativo('movimento');
  const fPar = ativo('paroquia');
  // Sem filtro, passa a mesma lista (o calendário não redesenha à toa).
  const visiveis =
    !fStatus.size && !fMov.size && !fPar.size
      ? reservas
      : reservas.filter((r) => (!fStatus.size || fStatus.has(r.status_compromisso)) && (!fMov.size || fMov.has(movDe(r))) && (!fPar.size || fPar.has(parDe(r))));
  const anterior = { mes: 'Mês anterior', semana: 'Semana anterior', dia: 'Dia anterior', dias: 'Semana anterior', lista: '' }[visao];
  const proximo = { mes: 'Próximo mês', semana: 'Próxima semana', dia: 'Próximo dia', dias: 'Próxima semana', lista: '' }[visao];

  return (
    <div className={`pagina agenda${calendario ? ' com-calendario' : ''}`}>
      <div className="agenda-barra">
        {calendario && (
          <div className="agenda-nav">
            <button className="btn peq" onClick={() => cal.current?.getApi().today()}>
              Hoje
            </button>
            <button className="ib" onClick={() => cal.current?.getApi().prev()} aria-label={anterior}>
              <Icone nome="esq" />
            </button>
            <button className="ib" onClick={() => cal.current?.getApi().next()} aria-label={proximo}>
              <Icone nome="dir" />
            </button>
            <h3 className="agenda-titulo">{titulo}</h3>
          </div>
        )}
        <span className="sp" />
        <FiltroMulti rotulo="Status" opcoes={opcoes.status} marcados={filtros.status} bolinha onMudar={(n) => mudarFiltro('status', n)} />
        <FiltroMulti rotulo="Movimento" opcoes={opcoes.movimento} marcados={filtros.movimento} onMudar={(n) => mudarFiltro('movimento', n)} />
        <FiltroMulti rotulo="Paróquia" opcoes={opcoes.paroquia} marcados={filtros.paroquia} onMudar={(n) => mudarFiltro('paroquia', n)} />
        <div className="segmentos" role="group" aria-label="Visão da agenda">
          {visoes.map((v) => (
            <button key={v.id} aria-pressed={visao === v.id} onClick={() => trocarVisao(v.id)}>
              {v.titulo}
            </button>
          ))}
        </div>
        {podeIncluir && (
          <button className="btn pri" onClick={() => setAberta({ reserva: null, dia: diaParaNova() })}>
            <Icone nome="plus" tamanho={16} />
            Nova reserva
          </button>
        )}
      </div>
      {erro && (
        <p className="msg-erro" role="alert">
          {erro}
        </p>
      )}

      {calendario ? (
        <div className={`calendario cal-${visao}`}>
          <Suspense fallback={<p className="note">Carregando calendário…</p>}>
            <Calendario
              key={celular ? 'celular' : 'computador'}
              ref={cal}
              reservas={visiveis}
              visao={FC[visao]}
              dataInicial={periodo.inicio}
              editavel={tem('reservas.alterar') && !celular}
              vePagamento={vePagamento}
              contadores={contadores}
              nomePessoa={nomePessoa}
              onPeriodo={(t, inicio, fim) => {
                setTitulo(t);
                setPeriodo({ inicio, fim });
              }}
              onAbrir={(r) => setAberta({ reserva: r })}
              onDiaVazio={(dia) => podeIncluir && setAberta({ reserva: null, dia: dataLocal(dia.toISOString()) })}
              onIrParaDia={(dia) => trocarVisao(celular ? 'dias' : 'dia', dia)}
              onMudanca={setMudanca}
            />
          </Suspense>
        </div>
      ) : (
        <section className="secao">
          <ListaReservas reservas={visiveis} contadores={contadores} nomePessoa={nomePessoa} nomeUsuario={nomeUsuario} vePagamento={vePagamento} onAbrir={(r) => setAberta({ reserva: r })} />
        </section>
      )}
      {calendario && celular && <p className="note">Toque na reserva para abrir. Arrastar funciona no computador e no tablet.</p>}

      {aberta && (
        <FormReserva
          key={aberta.vez ?? aberta.reserva?.id ?? 'nova'}
          reserva={aberta.reserva}
          diaInicial={aberta.dia}
          abaInicial={aberta.aba}
          comentarioDestaque={aberta.comentario}
          pessoas={pessoas}
          usuarios={usuarios}
          onPessoaNova={(p) => setPessoas((ps) => [...ps, p].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')))}
          onFechar={() => setAberta(null)}
          onMudou={() => void carregar()}
        />
      )}
      {mudanca && (
        <ConfirmarMudanca
          mudanca={mudanca}
          nomeLocatario={nomePessoa(mudanca.reserva.locatario_id)}
          onConcluir={(gravou) => {
            setMudanca(null);
            if (gravou) {
              setAviso(mudanca.tipo === 'mover' ? 'Reserva movida.' : 'Horário alterado.');
              void carregar();
            }
          }}
        />
      )}
      {aviso && (
        <div className="toast" role="status">
          <Icone nome="check" tamanho={16} />
          {aviso}
        </div>
      )}
    </div>
  );
}
