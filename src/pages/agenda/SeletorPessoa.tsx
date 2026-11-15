import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import type { Pessoa } from '../../lib/tipos';
import { ehLocador, ehLocatario } from './formatos';

interface Props {
  rotulo: string;
  tipo: 'locatario' | 'locador';
  pessoas: Pessoa[];
  valor: string | null;
  desabilitado?: boolean;
  podeCadastrar: boolean;
  onChange: (id: string) => void;
  onCadastrar: (nomeDigitado: string) => void;
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Campo com busca para escolher locatário ou locador; se não achar, oferece cadastrar com o nome digitado. */
export function SeletorPessoa({ rotulo, tipo, pessoas, valor, desabilitado, podeCadastrar, onChange, onCadastrar }: Props) {
  const id = useId();
  const escolhida = pessoas.find((p) => p.id === valor) ?? null;
  const [texto, setTexto] = useState<string | null>(null); // null = mostrando a escolhida
  const [aberto, setAberto] = useState(false);
  const [destaque, setDestaque] = useState(0);

  const candidatos = useMemo(() => pessoas.filter((p) => (tipo === 'locatario' ? ehLocatario(p.tipo) : ehLocador(p.tipo))), [pessoas, tipo]);
  const termo = semAcento((texto ?? '').trim());
  const opcoes = candidatos.filter((p) => !termo || semAcento(`${p.nome} ${p.telefone ?? ''} ${p.documento ?? ''}`).includes(termo)).slice(0, 8);
  const mostrarCadastro = podeCadastrar && (texto ?? '').trim().length > 0;
  const total = opcoes.length + (mostrarCadastro ? 1 : 0);

  function escolher(i: number) {
    if (i < opcoes.length) onChange(opcoes[i].id);
    else if (mostrarCadastro) onCadastrar((texto ?? '').trim());
    setTexto(null);
    setAberto(false);
  }

  function aoTeclar(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAberto(true);
      setDestaque((d) => Math.min(total - 1, d + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setDestaque((d) => Math.max(0, d - 1));
    } else if (e.key === 'Enter' && aberto && total > 0) {
      e.preventDefault();
      escolher(destaque);
    } else if (e.key === 'Escape') {
      setTexto(null);
      setAberto(false);
    }
  }

  return (
    <div className="campo seletor">
      <label className="rot" htmlFor={id}>
        {rotulo}
      </label>
      <input
        id={id}
        className="inp"
        role="combobox"
        aria-expanded={aberto}
        aria-controls={`${id}-lista`}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={desabilitado}
        placeholder={`Buscar ${tipo === 'locatario' ? 'locatário' : 'locador'}…`}
        value={texto ?? escolhida?.nome ?? ''}
        onFocus={(e) => {
          e.target.select();
          setAberto(true);
          setDestaque(0);
        }}
        onChange={(e) => {
          setTexto(e.target.value);
          setAberto(true);
          setDestaque(0);
        }}
        onBlur={() => window.setTimeout(() => { setAberto(false); setTexto(null); }, 150)}
        onKeyDown={aoTeclar}
      />
      {aberto && !desabilitado && (
        <ul className="seletor-lista" id={`${id}-lista`} role="listbox">
          {opcoes.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === destaque} className={i === destaque ? 'ativo' : undefined} onMouseDown={(e) => { e.preventDefault(); escolher(i); }}>
              <strong>{p.nome}</strong>
              {(p.telefone || p.documento) && <span>{[p.telefone, p.documento].filter(Boolean).join(' · ')}</span>}
            </li>
          ))}
          {mostrarCadastro && (
            <li role="option" aria-selected={destaque === opcoes.length} className={`novo${destaque === opcoes.length ? ' ativo' : ''}`} onMouseDown={(e) => { e.preventDefault(); escolher(opcoes.length); }}>
              + Cadastrar “{(texto ?? '').trim()}”
            </li>
          )}
          {total === 0 && <li className="vazio-lista">{candidatos.length ? 'Ninguém encontrado.' : 'Nenhuma pessoa cadastrada com esse tipo.'}</li>}
        </ul>
      )}
    </div>
  );
}
