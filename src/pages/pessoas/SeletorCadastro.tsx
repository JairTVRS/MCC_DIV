import { useState, type KeyboardEvent } from 'react';
import { CADASTROS, ehRepetido, type QualCadastro } from '../../lib/cadastros';
import { mensagemErro } from '../../lib/erros';
import { supabase } from '../../lib/supabase';
import type { ItemCadastro } from '../../lib/tipos';

const NOVO = '__novo__';

interface Props {
  qual: QualCadastro;
  itens: ItemCadastro[];
  valor: string;
  /** Pode cadastrar na hora ("+ Novo …"): quem tem a função do cadastro em Configurações. */
  podeIncluir: boolean;
  desabilitado: boolean;
  onMudar: (id: string) => void;
  /** Item cadastrado na hora: entra na lista e já fica escolhido. */
  onIncluido: (item: ItemCadastro) => void;
}

/**
 * Seletor de Movimento/Paróquia no cadastro da pessoa. Lista os ativos (e o atual, se foi desativado).
 * A última opção abre o cadastro rápido, sem sair do formulário; o cadastro completo fica em Configurações.
 * Fica dentro do <form> da pessoa: botões com type="button" e Enter não envia o formulário.
 */
export function SeletorCadastro({ qual, itens, valor, podeIncluir, desabilitado, onMudar, onIncluido }: Props) {
  const cfg = CADASTROS[qual];
  const [incluindo, setIncluindo] = useState(false);
  const [nome, setNome] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const opcoes = itens.filter((i) => i.ativo || i.id === valor);

  async function incluir() {
    const n = nome.trim();
    if (!n) return;
    setOcupado(true);
    setErro(null);
    const ordem = Math.max(0, ...itens.map((i) => i.ordem)) + 1;
    const { data, error } = await supabase.from(cfg.tabela).insert({ nome: n, ordem }).select('id, nome, ativo, ordem').single();
    setOcupado(false);
    if (error) {
      // Já existe com esse nome: escolhe o existente (se estiver ativo) em vez de dar erro.
      const existente = ehRepetido(error) ? itens.find((i) => i.nome.trim().toLowerCase() === n.toLowerCase()) : undefined;
      if (existente?.ativo) {
        onMudar(existente.id);
        return cancelar();
      }
      return setErro(ehRepetido(error) ? `Já existe e está ${cfg.artigo === 'a' ? 'inativa' : 'inativo'}: reative em Configurações > ${cfg.titulo}.` : mensagemErro(error));
    }
    onIncluido(data as ItemCadastro);
    cancelar();
  }

  function cancelar() {
    setIncluindo(false);
    setNome('');
    setErro(null);
  }

  function tecla(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void incluir();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelar();
    }
  }

  return (
    <div className="campo">
      <span className="rot">{cfg.singular} *</span>
      {incluindo ? (
        <div className="incluir-rapido">
          <input className="inp" value={nome} maxLength={80} autoFocus placeholder={cfg.novo} aria-label={cfg.novo} disabled={ocupado} onChange={(e) => setNome(e.target.value)} onKeyDown={tecla} />
          <button type="button" className="btn peq pri" onClick={() => void incluir()} disabled={ocupado || !nome.trim()}>
            {ocupado ? '…' : 'Incluir'}
          </button>
          <button type="button" className="btn peq" onClick={cancelar} disabled={ocupado}>
            Cancelar
          </button>
        </div>
      ) : (
        <select
          className="inp"
          value={valor}
          disabled={desabilitado}
          aria-label={cfg.singular}
          onChange={(e) => (e.target.value === NOVO ? setIncluindo(true) : onMudar(e.target.value))}
        >
          <option value="">Escolha…</option>
          {opcoes.map((i) => (
            <option key={i.id} value={i.id}>
              {i.nome}
              {i.ativo ? '' : cfg.artigo === 'a' ? ' (inativa)' : ' (inativo)'}
            </option>
          ))}
          {podeIncluir && <option value={NOVO}>+ {cfg.novo}…</option>}
        </select>
      )}
      {erro && (
        <span className="msg-erro" role="alert">
          {erro}
        </span>
      )}
    </div>
  );
}
