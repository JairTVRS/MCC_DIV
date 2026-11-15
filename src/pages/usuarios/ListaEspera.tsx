import { useState } from 'react';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import type { UsuarioAdmin } from '../../lib/tipos';
import { Avatar, fotoDe } from '../../layout/Avatar';
import type { DadosUsuarios } from './Usuarios';
import { dataHora } from './dados';

/** Quem pediu acesso: aprovar escolhendo o grupo, ou recusar com motivo opcional. */
export function ListaEspera({ dados, esperando }: { dados: DadosUsuarios; esperando: UsuarioAdmin[] }) {
  const ordenados = [...esperando].sort((a, b) => a.solicitado_em.localeCompare(b.solicitado_em));

  return (
    <section className="secao">
      <h3>Lista de espera</h3>
      <p className="note">
        Quem entra com o Google pela primeira vez fica aqui, sem acesso a nada. Ao aprovar, escolha o grupo: ele define o que a pessoa pode ver e fazer.
      </p>
      {ordenados.length === 0 ? (
        <p className="vazio">Ninguém esperando aprovação.</p>
      ) : (
        <ul className="cartoes">
          {ordenados.map((u) => (
            <Pedido key={u.id} u={u} dados={dados} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Pedido({ u, dados }: { u: UsuarioAdmin; dados: DadosUsuarios }) {
  const [grupo, setGrupo] = useState('');
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const grupos = dados.grupos.filter((g) => !g.sistema || dados.souAdmin);

  async function decidir(campos: Partial<UsuarioAdmin>) {
    setOcupado(true);
    setErro(null);
    const { error } = await supabase.from('usuarios').update(campos).eq('id', u.id);
    if (error) {
      setErro(mensagemErro(error));
      setOcupado(false);
      return;
    }
    // O alerta do pedido sai como lido pelo próprio banco; aqui só atualiza a tela.
    await dados.recarregar();
  }

  // Recusado que tentou de novo e continua recusado: marca como lido o meu alerta desse pedido.
  async function manterRecusado() {
    setOcupado(true);
    setErro(null);
    const { error } = await supabase.from('notificacoes').update({ lida: true }).eq('tipo', 'pedido_acesso').eq('usuario_solicitante_id', u.id).eq('lida', false);
    if (error) {
      setErro(mensagemErro(error));
      setOcupado(false);
      return;
    }
    await dados.recarregar();
  }

  return (
    <li className="cartao">
      <div className="cartao-topo">
        <Avatar nome={u.nome} foto={fotoDe(u)} tamanho={44} />
        <div className="tx">
          <strong>{u.nome}</strong>
          <span>{u.email}</span>
          <span>Pediu acesso em {dataHora(u.solicitado_em)}</span>
        </div>
        {u.status_acesso === 'recusado' && (
          <span className="tag" title={u.motivo_recusa ? `Motivo da recusa: ${u.motivo_recusa}` : undefined}>
            Recusado, tentou de novo
          </span>
        )}
      </div>

      {recusando ? (
        <div className="cartao-acoes">
          <input className="inp" value={motivo} maxLength={200} placeholder="Motivo (opcional, a pessoa vê na tela de acesso)" aria-label="Motivo da recusa" onChange={(e) => setMotivo(e.target.value)} />
          <button className="btn" onClick={() => setRecusando(false)} disabled={ocupado}>
            Voltar
          </button>
          <button className="btn perigo" onClick={() => void decidir({ status_acesso: 'recusado', motivo_recusa: motivo.trim() || null })} disabled={ocupado}>
            {ocupado ? 'Recusando…' : 'Confirmar recusa'}
          </button>
        </div>
      ) : (
        <div className="cartao-acoes">
          <select className="inp" value={grupo} onChange={(e) => setGrupo(e.target.value)} aria-label={`Grupo para ${u.nome}`}>
            <option value="">Escolha o grupo…</option>
            {grupos.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nome}
              </option>
            ))}
          </select>
          <button className="btn pri" onClick={() => void decidir({ status_acesso: 'ativo', perfil_id: grupo })} disabled={!grupo || ocupado}>
            <Icone nome="check" tamanho={16} />
            {ocupado ? 'Aprovando…' : 'Aprovar'}
          </button>
          {u.status_acesso === 'pendente' ? (
            <button className="btn" onClick={() => setRecusando(true)} disabled={ocupado}>
              Recusar
            </button>
          ) : (
            <button className="btn" onClick={() => void manterRecusado()} disabled={ocupado} title="Tira da lista sem liberar o acesso">
              Manter recusado
            </button>
          )}
        </div>
      )}
      {erro && (
        <p className="msg-erro" role="alert">
          {erro}
        </p>
      )}
    </li>
  );
}
