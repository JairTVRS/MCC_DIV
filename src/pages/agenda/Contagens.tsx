import { Icone } from '../../lib/icones';

/** Clipe (anexos) e balão (comentários) com a quantidade, no card da reserva. Nada aparece quando é zero. */
export function Contagens({ anexos = 0, comentarios = 0 }: { anexos?: number; comentarios?: number }) {
  if (!anexos && !comentarios) return null;
  return (
    <span className="contagens">
      {anexos > 0 && (
        <span title={`${anexos} anexo${anexos > 1 ? 's' : ''}`} aria-label={`${anexos} anexo${anexos > 1 ? 's' : ''}`}>
          <Icone nome="clipe" tamanho={12} />
          {anexos}
        </span>
      )}
      {comentarios > 0 && (
        <span title={`${comentarios} comentário${comentarios > 1 ? 's' : ''}`} aria-label={`${comentarios} comentário${comentarios > 1 ? 's' : ''}`}>
          <Icone nome="balao" tamanho={12} />
          {comentarios}
        </span>
      )}
    </span>
  );
}
