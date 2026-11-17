import { useEffect, useState } from 'react';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { vencimentosQueMudam, type VencimentoQueMuda } from '../../lib/prazos';
import { supabase } from '../../lib/supabase';
import type { Mudanca } from './Calendario';
import { AvisoVencimentos } from './AvisoVencimentos';
import { COMPROMISSO, dataLocal, periodoTexto } from './formatos';

interface Props {
  mudanca: Mudanca;
  nomeLocatario: string;
  onConcluir: (gravou: boolean) => void;
}

/**
 * Pergunta antes de gravar a mudança feita arrastando/esticando; confere conflito e grava.
 * Se o dia do evento mudar, avisa quais vencimentos "antes do evento" o banco vai mover junto.
 */
export function ConfirmarMudanca({ mudanca, nomeLocatario, onConcluir }: Props) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [vencimentos, setVencimentos] = useState<VencimentoQueMuda[]>([]);
  const { reserva, inicio, fim, tipo } = mudanca;
  const novoInicio = inicio.toISOString();
  const novoFim = fim.toISOString();
  const novoDia = dataLocal(novoInicio);

  useEffect(() => {
    if (novoDia === dataLocal(reserva.inicio) || reserva.status_compromisso === 'cancelado') return;
    let vivo = true;
    void vencimentosQueMudam(reserva, novoDia).then((v) => vivo && setVencimentos(v));
    return () => {
      vivo = false;
    };
  }, [reserva, novoDia]);

  function cancelar() {
    mudanca.desfazer();
    onConcluir(false);
  }

  async function confirmar() {
    setOcupado(true);
    setErro(null);
    try {
      if (COMPROMISSO[reserva.status_compromisso].bloqueia) {
        const { data, error } = await supabase.rpc('conflito_reserva', { p_inicio: novoInicio, p_fim: novoFim, p_ignorar: reserva.id });
        if (error) throw error;
        if (data) throw new Error(`Esse horário já está ocupado pela ${data}.`);
      }
      const { error } = await supabase.from('locacoes').update({ inicio: novoInicio, fim: novoFim }).eq('id', reserva.id);
      if (error) throw error;
      onConcluir(true);
    } catch (e) {
      setErro(mensagemErro(e));
      setOcupado(false);
    }
  }

  return (
    <>
      <div className="scrim alto" onClick={ocupado ? undefined : cancelar} />
      <div className="modal estreito alto" role="alertdialog" aria-modal="true" aria-labelledby="titulo-mudanca">
        <div className="m-head">
          <h2 id="titulo-mudanca">{tipo === 'mover' ? 'Mover reserva' : 'Alterar horário'}</h2>
          <button className="ib" onClick={cancelar} aria-label="Cancelar" disabled={ocupado}>
            <Icone nome="x" />
          </button>
        </div>
        <div className="m-body">
          <p className="mudanca-pergunta">
            {tipo === 'mover' ? 'Mover a reserva de ' : 'Alterar o horário da reserva de '}
            <strong>{nomeLocatario}</strong> para:
          </p>
          <p className="mudanca-de-para">
            <span className="note">Antes: {periodoTexto(reserva.inicio, reserva.fim)}</span>
            <strong>{periodoTexto(novoInicio, novoFim)}</strong>
          </p>
          <AvisoVencimentos vencimentos={vencimentos} />
          {erro && (
            <p className="msg-erro" role="alert">
              {erro}
            </p>
          )}
        </div>
        <div className="m-foot">
          <span className="sp" />
          <button className="btn" onClick={cancelar} disabled={ocupado}>
            Cancelar
          </button>
          {!erro && (
            <button className="btn pri" onClick={() => void confirmar()} disabled={ocupado} autoFocus>
              {ocupado ? 'Gravando…' : tipo === 'mover' ? 'Mover' : 'Alterar'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
