import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import type FullCalendar from '@fullcalendar/react';
import { useSessao } from '../../auth/Sessao';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import type { Pessoa, Reserva } from '../../lib/tipos';
import type { Mudanca, VisaoCalendario } from './Calendario';
import { ConfirmarMudanca } from './ConfirmarMudanca';
import { COLUNAS_RESERVA, FormReserva, type UsuarioCurto } from './FormReserva';
import { ListaReservas } from './ListaReservas';
import { dataLocal } from './formatos';

type Visao = 'semana' | 'dia' | 'lista';
const VISOES: { id: Visao; titulo: string }[] = [
  { id: 'semana', titulo: 'Semana' },
  { id: 'dia', titulo: 'Dia' },
  { id: 'lista', titulo: 'Lista' },
];
const CELULAR = '(max-width: 760px)';
// Se uma versão nova foi publicada com o app aberto, o arquivo antigo do calendário some do servidor:
// em vez de erro, recarrega a página (que já busca a versão nova).
const Calendario = lazy(() =>
  import('./Calendario').catch(() => {
    window.location.reload();
    return new Promise<never>(() => {});
  }),
);

function visaoLembrada(): Visao {
  try {
    const v = localStorage.getItem('agenda-visao');
    if (v === 'semana' || v === 'dia' || v === 'lista') return v;
  } catch {
    /* armazenamento indisponível */
  }
  return window.matchMedia(CELULAR).matches ? 'lista' : 'semana';
}

/** Agenda: visões Semana e Dia (arrastar e esticar no computador/tablet) e Lista. A visão de mês chega na etapa 6. */
export function Agenda() {
  const { tem } = useSessao();
  const [reservas, setReservas] = useState<Reserva[] | null>(null);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioCurto[]>([]);
  const [visao, setVisao] = useState<Visao>(visaoLembrada);
  const [titulo, setTitulo] = useState('');
  const [dataAtual, setDataAtual] = useState<Date>(() => new Date());
  const [celular, setCelular] = useState(() => window.matchMedia(CELULAR).matches);
  const [aberta, setAberta] = useState<{ reserva: Reserva | null; dia?: string } | null>(null);
  const [mudanca, setMudanca] = useState<Mudanca | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const cal = useRef<FullCalendar>(null);

  useEffect(() => {
    const m = window.matchMedia(CELULAR);
    const f = () => setCelular(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);

  const carregar = useCallback(async () => {
    try {
      const [r, p, u, g] = await Promise.all([
        supabase.from('locacoes').select(COLUNAS_RESERVA).eq('excluido', false).order('inicio'),
        supabase.from('pessoas').select('id, nome, tipo, telefone, email, documento').eq('excluido', false).order('nome'),
        supabase.from('usuarios').select('id, nome, status_acesso, perfil_id').order('nome'),
        supabase.from('grupo_funcoes').select('perfil_id').eq('funcao', 'reservas.visualizar'),
      ]);
      const falha = r.error ?? p.error ?? u.error ?? g.error;
      if (falha) throw falha;
      const gruposAgenda = new Set((g.data ?? []).map((x: { perfil_id: string }) => x.perfil_id));
      setReservas((r.data ?? []).map((x) => ({ ...(x as Reserva), valor_total: Number((x as Reserva).valor_total) })));
      setPessoas((p.data ?? []) as Pessoa[]);
      setUsuarios(
        (u.data ?? []).map((x: { id: string; nome: string; status_acesso: string; perfil_id: string | null }) => ({
          id: x.id,
          nome: x.nome,
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

  // O aviso "Reserva movida" some sozinho.
  useEffect(() => {
    if (!aviso) return;
    const t = window.setTimeout(() => setAviso(null), 4000);
    return () => window.clearTimeout(t);
  }, [aviso]);

  const nomePessoa = useCallback((id: string) => pessoas.find((p) => p.id === id)?.nome ?? '(pessoa excluída)', [pessoas]);
  const nomeUsuario = (id: string) => usuarios.find((u) => u.id === id)?.nome ?? '—';

  function trocarVisao(v: Visao) {
    setVisao(v);
    try {
      localStorage.setItem('agenda-visao', v);
    } catch {
      /* armazenamento indisponível */
    }
    if (v !== 'lista') cal.current?.getApi().changeView(v === 'semana' ? 'timeGridWeek' : 'timeGridDay');
  }

  // "Nova reserva" pelo botão: o dia mostrado (visão Dia), hoje se estiver na semana mostrada, senão o domingo da semana.
  function diaParaNova(): string | undefined {
    if (visao === 'lista') return undefined;
    if (visao === 'dia') return dataLocal(dataAtual.toISOString());
    const hoje = new Date();
    const fimSemana = new Date(dataAtual.getTime() + 7 * 86400000);
    return dataLocal((hoje >= dataAtual && hoje < fimSemana ? hoje : dataAtual).toISOString());
  }

  if (!reservas) return <p className="note">Carregando…</p>;
  const vePagamento = tem('pagamentos.visualizar');
  const podeIncluir = tem('reservas.incluir');
  const calendario = visao !== 'lista';
  const visaoCal: VisaoCalendario = visao === 'dia' ? 'timeGridDay' : 'timeGridWeek';

  return (
    <div className={`pagina agenda${calendario ? ' com-calendario' : ''}`}>
      <div className="agenda-barra">
        {calendario && (
          <div className="agenda-nav">
            <button className="btn peq" onClick={() => cal.current?.getApi().today()}>
              Hoje
            </button>
            <button className="ib" onClick={() => cal.current?.getApi().prev()} aria-label={visao === 'dia' ? 'Dia anterior' : 'Semana anterior'}>
              <Icone nome="esq" />
            </button>
            <button className="ib" onClick={() => cal.current?.getApi().next()} aria-label={visao === 'dia' ? 'Próximo dia' : 'Próxima semana'}>
              <Icone nome="dir" />
            </button>
            <h3 className="agenda-titulo">{titulo}</h3>
          </div>
        )}
        <span className="sp" />
        <div className="segmentos" role="group" aria-label="Visão da agenda">
          {VISOES.map((v) => (
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
        <div className="calendario">
          <Suspense fallback={<p className="note">Carregando calendário…</p>}>
          <Calendario
            ref={cal}
            reservas={reservas}
            visao={visaoCal}
            dataInicial={dataAtual}
            editavel={tem('reservas.alterar') && !celular}
            vePagamento={vePagamento}
            nomePessoa={nomePessoa}
            onPeriodo={(t, inicio) => {
              setTitulo(t);
              setDataAtual(inicio);
            }}
            onAbrir={(r) => setAberta({ reserva: r })}
            onDiaVazio={(dia) => podeIncluir && setAberta({ reserva: null, dia: dataLocal(dia.toISOString()) })}
            onMudanca={setMudanca}
          />
          </Suspense>
        </div>
      ) : (
        <section className="secao">
          <ListaReservas reservas={reservas} nomePessoa={nomePessoa} nomeUsuario={nomeUsuario} vePagamento={vePagamento} onAbrir={(r) => setAberta({ reserva: r })} />
        </section>
      )}
      {calendario && celular && <p className="note">No celular, toque na reserva para abrir. Arrastar e esticar funcionam no computador e no tablet.</p>}

      {aberta && (
        <FormReserva
          reserva={aberta.reserva}
          diaInicial={aberta.dia}
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
