import { rotuloDias, type VencimentoQueMuda } from '../../lib/prazos';

const dataBr = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR');

/** Aviso de que o banco vai mover os vencimentos "antes do evento" junto com a nova data da reserva. */
export function AvisoVencimentos({ vencimentos }: { vencimentos: VencimentoQueMuda[] }) {
  if (vencimentos.length === 0) return null;
  return (
    <div className="aviso" role="status">
      <strong>
        {vencimentos.length === 1 ? 'O vencimento desta parcela muda junto:' : `Os vencimentos destas ${vencimentos.length} parcelas mudam junto:`}
      </strong>
      <ul className="aviso-lista">
        {vencimentos.map((v) => (
          <li key={v.numero}>
            {v.numero}ª ({rotuloDias(v.dias, 'evento')}): {dataBr(v.de)} → <strong>{dataBr(v.para)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
