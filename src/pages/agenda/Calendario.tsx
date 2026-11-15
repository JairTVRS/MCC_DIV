import { forwardRef, useMemo } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import ptBr from '@fullcalendar/core/locales/pt-br';
import type { DatesSetArg, EventContentArg, EventDropArg, EventInput } from '@fullcalendar/core';
import type { DateClickArg, EventResizeDoneArg } from '@fullcalendar/interaction';
import type { Reserva } from '../../lib/tipos';
import { COMPROMISSO, PAGAMENTO } from './formatos';

/** Mês, semana, dia (computador/tablet) e dia por dia (celular, plano v1.8 item 6). */
export type VisaoCalendario = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listWeek';

/** Mudança feita arrastando ou esticando um card; `desfazer` devolve o card ao lugar. */
export interface Mudanca {
  reserva: Reserva;
  inicio: Date;
  fim: Date;
  tipo: 'mover' | 'esticar';
  desfazer: () => void;
}

interface Props {
  reservas: Reserva[];
  visao: VisaoCalendario;
  dataInicial: Date;
  editavel: boolean;
  vePagamento: boolean;
  nomePessoa: (id: string) => string;
  onPeriodo: (titulo: string, inicio: Date, fim: Date) => void;
  onAbrir: (r: Reserva) => void;
  onDiaVazio: (dia: Date) => void;
  onIrParaDia: (dia: Date) => void;
  onMudanca: (m: Mudanca) => void;
}

const hora = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const diaMes = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

/**
 * Agenda em calendário (FullCalendar):
 * - Mês: dias do mês sem grade de horas; arrastar para outro dia mantém o horário.
 * - Semana e Dia: grade de 00:00 a 24:00 sem eixo de horas (o horário vai escrito no card);
 *   arrastar muda dia/horário e esticar muda o fim, em passos de 15 minutos.
 * - Dia por dia (celular): reservas da semana, um bloco por dia, sem arrastar.
 * Pré-reserva e reservado não se sobrepõem.
 */
export const Calendario = forwardRef<FullCalendar, Props>(function Calendario(props, ref) {
  const { reservas, visao, dataInicial, editavel, vePagamento, nomePessoa, onPeriodo, onAbrir, onDiaVazio, onIrParaDia, onMudanca } = props;

  const eventos = useMemo<EventInput[]>(
    () =>
      reservas.map((r) => ({
        id: r.id,
        title: nomePessoa(r.locatario_id),
        start: r.inicio,
        end: r.fim,
        classNames: [`ev-${r.status_compromisso}`],
        extendedProps: { reserva: r },
      })),
    [reservas, nomePessoa],
  );

  function conteudo(arg: EventContentArg) {
    const r = arg.event.extendedProps.reserva as Reserva;
    const ini = new Date(r.inicio);
    const fim = new Date(r.fim);
    const mesmoDia = ini.toDateString() === fim.toDateString();
    const status = COMPROMISSO[r.status_compromisso].rotulo;
    const selo = vePagamento && <span className={`selo pg-${r.status_pagamento}`}>{PAGAMENTO[r.status_pagamento]}</span>;

    // Mês: uma linha (hora de início + locatário); o resto aparece ao passar o mouse.
    if (arg.view.type === 'dayGridMonth') {
      return (
        <div className="ev ev-linha" title={`${arg.event.title} · ${mesmoDia ? `${hora(ini)}–${hora(fim)}` : `${diaMes(ini)} ${hora(ini)} – ${diaMes(fim)} ${hora(fim)}`} · ${status}`}>
          {arg.isStart && <span className="ev-hora">{hora(ini)}</span>}
          <strong className="ev-nome">{arg.event.title}</strong>
        </div>
      );
    }
    // Dia por dia (celular): nome, status e pagamento (o horário fica na coluna da esquerda).
    if (arg.view.type === 'listWeek') {
      return (
        <div className="ev ev-lista">
          <strong className="ev-nome">{arg.event.title}</strong>
          <span className="ev-status">
            <span className={`status-chip st-${r.status_compromisso}`}>{status}</span>
            {selo}
          </span>
        </div>
      );
    }
    const horario = mesmoDia ? `${hora(ini)}–${hora(fim)}` : `${diaMes(ini)} ${hora(ini)} – ${diaMes(fim)} ${hora(fim)}`;
    return (
      <div className="ev">
        <span className="ev-hora">{horario}</span>
        <strong className="ev-nome">{arg.event.title}</strong>
        <span className="ev-status">
          {status}
          {selo}
        </span>
      </div>
    );
  }

  function aoMudar(info: EventDropArg | EventResizeDoneArg, tipo: Mudanca['tipo']) {
    const { start, end } = info.event;
    if (!start || !end) return info.revert();
    onMudanca({ reserva: info.event.extendedProps.reserva as Reserva, inicio: start, fim: end, tipo, desfazer: info.revert });
  }

  return (
    <FullCalendar
      ref={ref}
      plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
      locale={ptBr}
      initialView={visao}
      initialDate={dataInicial}
      headerToolbar={false}
      firstDay={0}
      height="100%"
      events={eventos}
      eventContent={conteudo}
      nowIndicator
      navLinks
      navLinkDayClick={(dia) => onIrParaDia(dia)}
      editable={editavel}
      eventResizableFromStart={false}
      views={{
        dayGridMonth: {
          eventDisplay: 'block',
          dayMaxEvents: 3,
          eventDurationEditable: false, // no mês, só arrastar entre dias (o horário fica)
          fixedWeekCount: false,
        },
        timeGrid: {
          allDaySlot: false,
          slotMinTime: '00:00:00',
          slotMaxTime: '24:00:00',
          slotDuration: '01:00:00',
          snapDuration: '00:15:00',
          scrollTime: '08:00:00',
          slotLabelContent: () => '',
          dayHeaderFormat: { weekday: 'short', day: '2-digit', month: '2-digit' },
          eventDurationEditable: editavel,
        },
        listWeek: {
          noEventsContent: 'Nenhuma reserva nesta semana.',
          listDayFormat: { weekday: 'long', day: '2-digit', month: 'long' },
          listDaySideFormat: false,
        },
      }}
      // Pré-reserva e reservado não podem ficar um sobre o outro (o banco confere de novo ao gravar).
      eventOverlap={(parado, movendo) => {
        const bloqueia = (s: unknown) => COMPROMISSO[(s as Reserva).status_compromisso].bloqueia;
        return !(bloqueia(parado.extendedProps.reserva) && bloqueia(movendo?.extendedProps.reserva));
      }}
      eventClick={(info) => onAbrir(info.event.extendedProps.reserva as Reserva)}
      dateClick={(info: DateClickArg) => onDiaVazio(info.date)}
      eventDrop={(info) => aoMudar(info, 'mover')}
      eventResize={(info) => aoMudar(info, 'esticar')}
      datesSet={(arg: DatesSetArg) => onPeriodo(arg.view.title, arg.view.currentStart, arg.view.currentEnd)}
    />
  );
});

// Carregado sob demanda pela Agenda (o FullCalendar só baixa quando uma visão de calendário abre).
export default Calendario;
