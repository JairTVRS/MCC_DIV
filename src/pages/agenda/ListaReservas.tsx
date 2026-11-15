import { useState } from 'react';
import type { Reserva } from '../../lib/tipos';
import { COMPROMISSO, PAGAMENTO, reais } from './formatos';

type Filtro = 'proximas' | 'anteriores' | 'todas';

interface Props {
  reservas: Reserva[];
  nomePessoa: (id: string) => string;
  nomeUsuario: (id: string) => string;
  vePagamento: boolean;
  onAbrir: (r: Reserva) => void;
}

/** Visão em lista: reservas por mês, com a cor do status (Próximas / Anteriores / Todas). */
export function ListaReservas({ reservas, nomePessoa, nomeUsuario, vePagamento, onAbrir }: Props) {
  const [filtro, setFiltro] = useState<Filtro>('proximas');
  const agora = new Date().toISOString();
  const visiveis = reservas
    .filter((r) => (filtro === 'todas' ? true : filtro === 'proximas' ? r.fim >= agora : r.fim < agora))
    .sort((a, b) => (filtro === 'anteriores' ? b.inicio.localeCompare(a.inicio) : a.inicio.localeCompare(b.inicio)));
  const meses = new Map<string, Reserva[]>();
  for (const r of visiveis) {
    const mes = new Date(r.inicio).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    const chave = mes.charAt(0).toUpperCase() + mes.slice(1); // "Novembro de 2026"
    meses.set(chave, [...(meses.get(chave) ?? []), r]);
  }

  return (
    <>
      <div className="chips" role="group" aria-label="Período">
        {(
          [
            ['proximas', 'Próximas'],
            ['anteriores', 'Anteriores'],
            ['todas', 'Todas'],
          ] as [Filtro, string][]
        ).map(([f, rot]) => (
          <button key={f} className="chip" aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
            {rot}
          </button>
        ))}
      </div>
      {visiveis.length === 0 ? (
        <p className="vazio">{filtro === 'proximas' ? 'Nenhuma reserva pela frente.' : 'Nenhuma reserva aqui.'}</p>
      ) : (
        [...meses.entries()].map(([mes, lista]) => (
          <div key={mes} className="mes">
            <h4 className="mes-titulo">{mes}</h4>
            <ul className="reservas">
              {lista.map((r) => {
                const ini = new Date(r.inicio);
                const fim = new Date(r.fim);
                const hora = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                const outroDia = ini.toDateString() !== fim.toDateString();
                return (
                  <li key={r.id}>
                    <button className={`reserva st-${r.status_compromisso}`} onClick={() => onAbrir(r)}>
                      <span className="reserva-dia">
                        <strong>{ini.getDate()}</strong>
                        <span>{ini.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}</span>
                      </span>
                      <span className="reserva-tx">
                        <strong className="reserva-nome">{nomePessoa(r.locatario_id)}</strong>
                        <span>
                          {hora(ini)} às {outroDia ? `${fim.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ` : ''}
                          {hora(fim)} · Locador: {nomePessoa(r.locador_id)} · Resp.: {nomeUsuario(r.responsavel_id)}
                        </span>
                      </span>
                      <span className="reserva-lado">
                        <span className={`status-chip st-${r.status_compromisso}`}>{COMPROMISSO[r.status_compromisso].rotulo}</span>
                        {vePagamento && (
                          <span className="reserva-valor">
                            {reais(r.valor_total - r.desconto)} <span className={`selo pg-${r.status_pagamento}`}>{PAGAMENTO[r.status_pagamento]}</span>
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </>
  );
}
