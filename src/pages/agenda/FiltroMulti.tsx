import { useEffect, useRef, useState } from 'react';
import { Icone } from '../../lib/icones';

export interface OpcaoFiltro {
  id: string;
  nome: string;
  qtd: number;
  /** Classe extra da opção (ex.: "st-reservado" para a bolinha da cor do status). */
  classe?: string;
}

/** Lê do aparelho os itens marcados de um filtro. */
export function lembrados(chave: string): Set<string> {
  try {
    const s = JSON.parse(localStorage.getItem(chave) ?? '[]');
    if (Array.isArray(s)) return new Set(s.filter((x): x is string => typeof x === 'string'));
  } catch {
    /* armazenamento indisponível */
  }
  return new Set();
}

/** Guarda no aparelho os itens marcados de um filtro. */
export function lembrar(chave: string, marcados: Set<string>) {
  try {
    localStorage.setItem(chave, JSON.stringify([...marcados]));
  } catch {
    /* armazenamento indisponível */
  }
}

/**
 * Campo multiseleção da barra da agenda: lista com caixas de marcar; nada marcado = todos.
 * Marcados que não estão mais entre as opções (ex.: cadastro desativado) são ignorados.
 */
export function FiltroMulti({
  rotulo,
  opcoes,
  marcados,
  bolinha,
  onMudar,
}: {
  rotulo: string;
  opcoes: OpcaoFiltro[];
  marcados: Set<string>;
  /** Mostra a bolinha colorida (filtro de status). */
  bolinha?: boolean;
  onMudar: (novo: Set<string>) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => !caixa.current?.contains(e.target as Node) && setAberto(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);

  const validos = opcoes.filter((o) => marcados.has(o.id));

  function alternar(id: string) {
    const novo = new Set(validos.map((o) => o.id));
    if (novo.has(id)) novo.delete(id);
    else novo.add(id);
    onMudar(novo.size === opcoes.length ? new Set() : novo); // todos marcados = o mesmo que nenhum
  }

  const resumo = validos.length === 0 ? 'Todos' : validos.map((o) => o.nome).join(', ');

  return (
    <div className="multi" ref={caixa}>
      <button className={`multi-campo${validos.length ? ' filtrando' : ''}`} aria-haspopup="listbox" aria-expanded={aberto} onClick={() => setAberto((v) => !v)}>
        <span className="multi-rot">{rotulo}:</span>
        <span className="multi-valor">{resumo}</span>
        <Icone nome="down" tamanho={16} />
      </button>
      {aberto && (
        <div className="multi-lista rolavel" role="listbox" aria-multiselectable="true" aria-label={`${rotulo} da agenda`}>
          {opcoes.length === 0 && <p className="note">Nada cadastrado ainda.</p>}
          {opcoes.map((o) => (
            <label key={o.id} className={`multi-opcao${o.classe ? ` ${o.classe}` : ''}`}>
              <input type="checkbox" checked={marcados.has(o.id)} onChange={() => alternar(o.id)} />
              {bolinha && <span className="bolinha" aria-hidden="true" />}
              <span className="multi-nome">{o.nome}</span>
              <span className="multi-qtd">{o.qtd}</span>
            </label>
          ))}
          <div className="multi-rodape">
            <span className="note">{validos.length === 0 ? 'Nada marcado: mostra todos.' : `${validos.length} marcado(s).`}</span>
            <button className="btn peq" onClick={() => onMudar(new Set())} disabled={validos.length === 0}>
              Limpar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
