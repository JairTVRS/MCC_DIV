import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import type FullCalendar from '@fullcalendar/react';
import { useSessao } from '../../auth/Sessao';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import type { Pessoa, Reserva, StatusCompromisso } from '../../lib/tipos';
import type { Mudanca, VisaoCalendario } from './Calendario';
import { ConfirmarMudanca } from './ConfirmarMudanca';
import { COLUNAS_RESERVA, FormReserva, normalizarReserva, type AbaReserva, type UsuarioCurto } from './FormReserva';
import { ListaReservas } from './ListaReservas';
import { COMPROMISSO, dataLocal } from './formatos';

const STATUS: StatusCompromisso[] = ['cadastrado', 'pre_reserva', 'reservado', 'cancelado'];

/** Status escolhidos no filtro, lembrados no aparelho. Nenhum escolhido = mostra todos. */
function statusLembrados(): Set<StatusCompromisso> {
  try {
    const s = JSON.parse(localStorage.getItem('agenda-filtro-status') ?? '[]');
    if (Array.isArray(s)) return new Set(s.filter((x): x is StatusCompromisso => STATUS.includes(x)));
  } catch {
    /* armazenamento indisponível */
  }
  return new Set();
}

/** Campo multiseleção de status: lista com caixas de marcar; nada marcado = todos. */
function FiltroStatus({ escolhidos, contagem, onMudar }: { escolhidos: Set<StatusCompromisso>; contagem: (s: StatusCompromisso) => number; onMudar: (novo: Set<StatusCompromisso>) => void }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => !caixa.current?.contains(e.target as Node) && setAberto(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  function alternar(s: StatusCompromisso) {
    const novo = new Set(escolhidos);
    if (novo.has(s)) novo.delete(s);
    else novo.add(s);
    onMudar(novo.size === STATUS.length ? new Set() : novo); // todos marcados = o mesmo que nenhum
  }

  const resumo = escolhidos.size === 0 ? 'Todos' : STATUS.filter((s) => escolhidos.has(s)).map((s) => COMPROMISSO[s].rotulo).join(', ');

  return (
    <div className="multi" ref={caixa}>
      <button className={`multi-campo${escolhidos.size ? ' filtrando' : ''}`} aria-haspopup="listbox" aria-expanded={aberto} onClick={() => setAberto((v) => !v)}>
        <span className="multi-rot">Status:</span>
        <span className="multi-valor">{resumo}</span>
        <Icone nome="down" tamanho={16} />
      </button>
      {aberto && (
        <div className="multi-lista" role="listbox" aria-multiselectable="true" aria-label="Status da agenda">
          {STATUS.map((s) => (
            <label key={s} className={`multi-opcao st-${s}`}>
              <input type="checkbox" checked={escolhidos.has(s)} onChange={() => alternar(s)} />
              <span className="bolinha" aria-hidden="true" />
              <span className="multi-nome">{COMPROMISSO[s].rotulo}</span>
              <span className="multi-qtd">{contagem(s)}</span>
            </label>
          ))}
          <div className="multi-rodape">
            <span className="note">{escolhidos.size === 0 ? 'Nada marcado: mostra todos.' : `${escolhidos.size} marcado(s).`}</span>
            <button className="btn peq" onClick={() => onMudar(new Set())} disabled={escolhidos.size === 0}>
              Limpar
            </button>
          </div>
        </div>
      )}
    </div>
  );
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

/** Quantos anexos e comentários cada reserva tem (ícones no card). */
export type Contadores = Map<string, { anexos: number; comentarios: number }>;

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
  const [filtroStatus, setFiltroStatus] = useState<Set<StatusCompromisso>>(statusLembrados);
  const cal = useRef<FullCalendar>(null);

  function mudarFiltro(novo: Set<StatusCompromisso>) {
    setFiltroStatus(novo);
    try {
      localStorage.setItem('agenda-filtro-status', JSON.stringify([...novo]));
    } catch {
      /* armazenamento indisponível */
    }
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
      const [r, p, u, g, c] = await Promise.all([
        supabase.from('locacoes').select(COLUNAS_RESERVA).eq('excluido', false).order('inicio'),
        supabase.from('pessoas').select('id, nome, tipo, telefone, email, documento').eq('excluido', false).order('nome'),
        supabase.from('usuarios').select('id, nome, status_acesso, perfil_id, foto_google, foto_upload, usar_foto_upload').order('nome'),
        supabase.from('grupo_funcoes').select('perfil_id').eq('funcao', 'reservas.visualizar'),
        supabase.rpc('contadores_reservas'),
      ]);
      const falha = r.error ?? p.error ?? u.error ?? g.error;
      if (falha) throw falha;
      // Contadores são só enfeite do card: se falharem (ex.: migração 015 ainda não rodou), a agenda segue sem eles.
      setContadores(
        new Map(((c.data ?? []) as { locacao_id: string; anexos: number; comentarios: number }[]).map((x) => [x.locacao_id, { anexos: Number(x.anexos), comentarios: Number(x.comentarios) }])),
      );
      const gruposAgenda = new Set((g.data ?? []).map((x: { perfil_id: string }) => x.perfil_id));
      setReservas((r.data ?? []).map(normalizarReserva));
      setPessoas((p.data ?? []) as Pessoa[]);
      setUsuarios(
        (u.data ?? []).map((x: { id: string; nome: string; status_acesso: string; perfil_id: string | null; foto_google: string | null; foto_upload: string | null; usar_foto_upload: boolean }) => ({
          id: x.id,
          nome: x.nome,
          foto: x.usar_foto_upload && x.foto_upload ? x.foto_upload : x.foto_google,
          responsavel: x.status_acesso === 'ativo' && !!x.perfil_id && gruposAgenda.has(x.perfil_id),
        })),
      );
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
  const visiveis = filtroStatus.size === 0 ? reservas : reservas.filter((r) => filtroStatus.has(r.status_compromisso));
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
        <FiltroStatus escolhidos={filtroStatus} contagem={(s) => reservas.filter((r) => r.status_compromisso === s).length} onMudar={mudarFiltro} />
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
