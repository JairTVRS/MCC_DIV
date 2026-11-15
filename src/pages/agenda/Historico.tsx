import { useMemo } from 'react';
import { JanelaHistorico } from '../historico/JanelaHistorico';

/** Histórico da reserva (relógio do card): tudo que é da reserva, pelo log imutável do banco. */
export function Historico({ locacaoId, onFechar }: { locacaoId: string; onFechar: () => void }) {
  const alvo = useMemo(() => ({ tipo: 'reserva' as const, id: locacaoId }), [locacaoId]);
  return <JanelaHistorico alvo={alvo} onFechar={onFechar} />;
}
