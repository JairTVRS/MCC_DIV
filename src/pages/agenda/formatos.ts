import type { StatusCompromisso, StatusPagamento, TipoPessoa } from '../../lib/tipos';

/** Status do compromisso (plano v1.8, item 4). A cor do card vem da classe `st-<status>`. */
export const COMPROMISSO: Record<StatusCompromisso, { rotulo: string; bloqueia: boolean; quando: string }> = {
  cadastrado: { rotulo: 'Cadastrado', bloqueia: false, quando: 'Primeiro contato do interessado; pode haver datas concorrentes.' },
  pre_reserva: { rotulo: 'Pré-reserva', bloqueia: true, quando: 'Orçamento enviado ao cliente; bloqueia a data.' },
  reservado: { rotulo: 'Reservado', bloqueia: true, quando: 'Primeira parcela paga ou venda confirmada; bloqueia a data.' },
  cancelado: { rotulo: 'Cancelado', bloqueia: false, quando: 'Locação desistida; libera a data.' },
};

/** Selo do status de pagamento (calculado pelo banco). Cor pela classe `pg-<status>`. */
export const PAGAMENTO: Record<StatusPagamento, string> = {
  pendente: 'Pendente',
  parcial: 'Parcial',
  pago: 'Pago',
  devolvido: 'Devolvido',
  devolvido_parcial: 'Devolvido parcial',
};

export const TIPO_PESSOA: Record<TipoPessoa, string> = {
  locatario: 'Locatário',
  locador: 'Locador',
  ambos: 'Locatário e locador',
};

export const ehLocatario = (t: TipoPessoa) => t === 'locatario' || t === 'ambos';
export const ehLocador = (t: TipoPessoa) => t === 'locador' || t === 'ambos';

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const reais = (v: number) => moeda.format(v || 0);

/** "1.234,56" → 1234.56 (aceita também "1234.56"). Vazio ou inválido → 0. */
export function lerReais(texto: string): number {
  const limpo = texto.replace(/[^\d,.-]/g, '');
  if (!limpo) return 0;
  const n = limpo.includes(',') ? Number(limpo.replace(/\./g, '').replace(',', '.')) : Number(limpo);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** 1234.5 → "1.234,50" (para o campo de valor). */
export const escreverReais = (v: number) => (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Telefone brasileiro enquanto digita: (37) 99999-9999 ou (37) 3333-4444. */
export function mascaraTelefone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Data e hora locais (fuso do navegador = Brasília) ↔ ISO do banco. */
export function paraIso(data: string, hora: string): string {
  return new Date(`${data}T${hora}:00`).toISOString();
}
export function dataLocal(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function horaLocal(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function hojeLocal(): string {
  return dataLocal(new Date().toISOString());
}

/** "sáb., 05/12/2026 · 00:00 às 23:59" (ou com a data final, se for outro dia). */
export function periodoTexto(inicio: string, fim: string): string {
  const i = new Date(inicio);
  const f = new Date(fim);
  const dia = (d: Date) => d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return dataLocal(inicio) === dataLocal(fim) ? `${dia(i)} · ${hora(i)} às ${hora(f)}` : `${dia(i)} ${hora(i)} até ${dia(f)} ${hora(f)}`;
}
