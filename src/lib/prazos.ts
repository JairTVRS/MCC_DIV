import { supabase } from './supabase';
import type { ParcelaPrazo, RefPrazo } from './tipos';

/** De onde contam os dias da parcela do prazo (sem o campo = após a pré-reserva, como os prazos antigos). */
export const refDe = (p: { ref?: RefPrazo }): RefPrazo => p.ref ?? 'reserva';

export const fmtPct = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** "na hora" · "30 dias" · "15 dias antes do evento" · "no dia do evento". */
export function rotuloDias(dias: number, ref: RefPrazo): string {
  if (ref === 'evento') return dias === 0 ? 'no dia do evento' : `${dias} dias antes do evento`;
  return dias === 0 ? 'na hora' : `${dias} dias`;
}

/** "na hora · 30% — 15 dias antes do evento · 70%" */
export function resumoPrazo(p: { parcelas: ParcelaPrazo[] }): string {
  return p.parcelas.map((x) => `${rotuloDias(x.dias, refDe(x))} · ${fmtPct(x.percentual)}%`).join(' — ');
}

/**
 * Nome do prazo, espelho das parcelas (mesma regra da função nome_prazo do banco, que é quem grava):
 * "À vista" · "30 dias" · "30/60/90" · "30% entrada + 30/60/90" · "30 dias 40% / 60 dias 60%" ·
 * "30% entrada + 70% 15 dias antes do evento" · "15 dias antes do evento" · "No dia do evento".
 */
export function nomePrazo(parcelas: ParcelaPrazo[]): string {
  const ev = parcelas.filter((p) => refDe(p) === 'evento');
  const r = parcelas.filter((p) => refDe(p) === 'reserva');
  const entrada = r.filter((p) => p.dias === 0).reduce((s, p) => s + p.percentual, 0);
  const resto = r.filter((p) => p.dias > 0);
  const partes: string[] = [];
  if (entrada > 0 && (resto.length > 0 || ev.length > 0)) partes.push(`${fmtPct(entrada)}% entrada`);
  if (resto.length > 0) {
    const pcts = resto.map((p) => p.percentual);
    const comPct = resto.map((p) => `${p.dias} dias ${fmtPct(p.percentual)}%`).join(' / ');
    partes.push(
      ev.length > 0
        ? comPct
        : resto.length === 1
          ? `${resto[0].dias} dias`
          : Math.max(...pcts) - Math.min(...pcts) <= 0.02
            ? resto.map((p) => p.dias).join('/')
            : comPct,
    );
  }
  if (ev.length === 1 && partes.length === 0) {
    partes.push(ev[0].dias === 0 ? 'No dia do evento' : `${ev[0].dias} dias antes do evento`);
  } else {
    for (const p of ev) partes.push(`${fmtPct(p.percentual)}% ${rotuloDias(p.dias, 'evento')}`);
  }
  return partes.length ? partes.join(' + ') : 'À vista';
}

/**
 * Partes do prazo que ainda faltam pagar, na ordem do prazo. As pagas saem pelo tipo: paga "antes do
 * evento" tira uma parte antes do evento; as outras tiram partes após a pré-reserva (mesma regra da
 * função partes_restantes do banco). Assim a parcela "2 dias antes do evento" que vence primeiro não
 * troca de lugar com a "30 dias".
 */
export function partesRestantes(prazo: ParcelaPrazo[], pagas: { dias_antes_evento: number | null }[]): ParcelaPrazo[] {
  const r = prazo.filter((p) => refDe(p) === 'reserva');
  const ev = prazo.filter((p) => refDe(p) === 'evento');
  let pe = pagas.filter((p) => p.dias_antes_evento != null).length;
  let pr = pagas.length - pe;
  // Paga de um tipo sem parte desse tipo sobrando (ex.: trocou de prazo): desconta do outro.
  if (pr > r.length) {
    pe += pr - r.length;
    pr = r.length;
  }
  if (pe > ev.length) {
    pr = Math.min(r.length, pr + pe - ev.length);
    pe = ev.length;
  }
  return [...r.slice(pr), ...ev.slice(pe)];
}

/** Soma dias a uma data AAAA-MM-DD (calendário local). */
export function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split('-').map(Number);
  const r = new Date(a, m - 1, d + dias);
  return `${r.getFullYear()}-${String(r.getMonth() + 1).padStart(2, '0')}-${String(r.getDate()).padStart(2, '0')}`;
}

/**
 * Vencimento de uma parcela do prazo. Após a pré-reserva: data base + dias.
 * Antes do evento: data do evento - dias, nunca antes da data base ("ajustada" = caiu na data base).
 */
export function vencimentoPrazo(dias: number, ref: RefPrazo, dataBase: string, dataEvento: string): { vencimento: string; ajustada: boolean } {
  if (ref === 'reserva') return { vencimento: somarDias(dataBase, dias), ajustada: false };
  const v = somarDias(dataEvento, -dias);
  return v < dataBase ? { vencimento: dataBase, ajustada: true } : { vencimento: v, ajustada: false };
}

export interface VencimentoQueMuda {
  numero: number;
  dias: number;
  de: string;
  para: string;
}

/**
 * Parcelas em aberto "antes do evento" que o banco vai mover se o evento passar para `novoDia`
 * (mesma regra do gatilho vencimentos_evento: dia do evento - dias, nunca antes da pré-reserva).
 */
export async function vencimentosQueMudam(reserva: { id: string; pre_reserva_em: string | null }, novoDia: string): Promise<VencimentoQueMuda[]> {
  const { data, error } = await supabase
    .from('parcelas')
    .select('numero, vencimento, dias_antes_evento')
    .eq('locacao_id', reserva.id)
    .eq('paga', false)
    .eq('encerrada', false)
    .eq('excluido', false)
    .not('dias_antes_evento', 'is', null)
    .order('numero');
  if (error || !data) return [];
  const base = reserva.pre_reserva_em ? diaLocal(reserva.pre_reserva_em) : null;
  return (data as { numero: number; vencimento: string; dias_antes_evento: number }[])
    .map((p) => {
      const calc = somarDias(novoDia, -p.dias_antes_evento);
      return { numero: p.numero, dias: p.dias_antes_evento, de: p.vencimento, para: base && calc < base ? base : calc };
    })
    .filter((p) => p.de !== p.para);
}

function diaLocal(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
