import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icone } from '../../lib/icones';
import { reais } from '../agenda/formatos';

export interface Coluna<T> {
  id: string;
  titulo: string;
  /** Valor usado para ordenar, somar e exportar. */
  valor: (r: T) => string | number | null;
  /** Como aparece na tela (padrão: o próprio valor, formatado pelo tipo). */
  mostrar?: (r: T) => ReactNode;
  /** Texto no CSV (padrão: pelo tipo). */
  csv?: (r: T) => string;
  tipo?: 'texto' | 'moeda' | 'numero';
  /** Soma no rodapé. */
  soma?: boolean;
  /** Aparece sem a pessoa escolher. */
  padrao?: boolean;
}

/** Número no formato brasileiro, sem "R$" (o Excel entende como número). */
const numeroBr = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });

/** Baixa um CSV que o Excel em português abre certo: separador ";", vírgula decimal e acentos (BOM UTF-8). */
export function baixarCsv(nomeArquivo: string, cabecalho: string[], linhas: string[][]) {
  const celula = (v: string) => (/[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const texto = [cabecalho, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿', texto], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function lembradas(chave: string, padrao: string[]): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(chave) ?? 'null');
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v;
  } catch {
    /* armazenamento indisponível */
  }
  return padrao;
}

/**
 * Tabela do relatório: escolher colunas (lembradas no aparelho), ordenar clicando no título,
 * somas no rodapé, clique na linha abre o registro e exportação do que está na tela.
 */
export function Tabela<T>({
  colunas,
  linhas,
  chave,
  lembrar,
  ordemInicial,
  onAbrir,
  exportar,
  vazio,
}: {
  colunas: Coluna<T>[];
  linhas: T[];
  chave: (r: T) => string;
  lembrar: string;
  ordemInicial: { coluna: string; desc?: boolean };
  onAbrir?: (r: T) => void;
  /** Nome do arquivo; sem ele, não há botão de exportar. */
  exportar?: string;
  vazio: string;
}) {
  const [visiveisIds, setVisiveisIds] = useState<string[]>(() => lembradas(lembrar, colunas.filter((c) => c.padrao).map((c) => c.id)));
  const [ordem, setOrdem] = useState(ordemInicial);
  const [escolhendo, setEscolhendo] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!escolhendo) return;
    const fora = (e: MouseEvent) => !caixa.current?.contains(e.target as Node) && setEscolhendo(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setEscolhendo(false);
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [escolhendo]);

  // Colunas na ordem definida (não na ordem em que foram marcadas); some a que não existe mais (ex.: sem permissão).
  const visiveis = colunas.filter((c) => visiveisIds.includes(c.id));
  const mostrar = visiveis.length ? visiveis : colunas.filter((c) => c.padrao);

  function alternar(id: string) {
    const novo = visiveisIds.includes(id) ? visiveisIds.filter((x) => x !== id) : [...visiveisIds, id];
    setVisiveisIds(novo);
    try {
      localStorage.setItem(lembrar, JSON.stringify(novo));
    } catch {
      /* armazenamento indisponível */
    }
  }

  const ordenadas = useMemo(() => {
    const col = colunas.find((c) => c.id === ordem.coluna);
    if (!col) return linhas;
    const sinal = ordem.desc ? -1 : 1;
    return [...linhas].sort((a, b) => {
      const va = col.valor(a);
      const vb = col.valor(b);
      if (va === vb) return 0;
      if (va === null || va === '') return 1;
      if (vb === null || vb === '') return -1;
      return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb), 'pt-BR', { numeric: true })) * sinal;
    });
  }, [linhas, colunas, ordem]);

  const texto = (c: Coluna<T>, r: T): string => {
    if (c.csv) return c.csv(r);
    const v = c.valor(r);
    if (v === null) return '';
    if (c.tipo === 'moeda' && typeof v === 'number') return numeroBr(v);
    return String(v);
  };
  const tela = (c: Coluna<T>, r: T): ReactNode => {
    if (c.mostrar) return c.mostrar(r);
    const v = c.valor(r);
    if (v === null || v === '') return '—';
    if (c.tipo === 'moeda' && typeof v === 'number') return reais(v);
    return v;
  };
  const soma = (c: Coluna<T>) => linhas.reduce((s, r) => s + (Number(c.valor(r)) || 0), 0);
  const temSoma = mostrar.some((c) => c.soma);

  function baixar() {
    if (!exportar) return;
    baixarCsv(
      exportar,
      mostrar.map((c) => c.titulo),
      ordenadas.map((r) => mostrar.map((c) => texto(c, r))),
    );
  }

  return (
    <div className="tabela-rel">
      <div className="tabela-barra">
        <span className="note">
          {linhas.length} {linhas.length === 1 ? 'linha' : 'linhas'}
        </span>
        <span className="sp" />
        <div className="multi" ref={caixa}>
          <button className="btn peq" aria-haspopup="listbox" aria-expanded={escolhendo} onClick={() => setEscolhendo((v) => !v)}>
            Colunas <Icone nome="down" tamanho={14} />
          </button>
          {escolhendo && (
            <div className="multi-lista direita" role="listbox" aria-multiselectable="true" aria-label="Colunas visíveis">
              {colunas.map((c) => (
                <label key={c.id} className="multi-opcao">
                  <input type="checkbox" checked={mostrar.includes(c)} onChange={() => alternar(c.id)} />
                  <span className="multi-nome">{c.titulo}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        {exportar && (
          <button className="btn peq" onClick={baixar} disabled={!linhas.length} title="Baixa o que está na tela (filtros e colunas) em CSV, que abre no Excel">
            <Icone nome="upload" tamanho={14} /> Exportar CSV
          </button>
        )}
      </div>
      {linhas.length === 0 ? (
        <p className="vazio">{vazio}</p>
      ) : (
        <div className="tabela-rolagem">
          <table>
            <thead>
              <tr>
                {mostrar.map((c) => (
                  <th key={c.id} className={c.tipo && c.tipo !== 'texto' ? 'num' : undefined} aria-sort={ordem.coluna === c.id ? (ordem.desc ? 'descending' : 'ascending') : undefined}>
                    <button onClick={() => setOrdem((o) => ({ coluna: c.id, desc: o.coluna === c.id ? !o.desc : false }))}>
                      {c.titulo}
                      {ordem.coluna === c.id && <Icone nome={ordem.desc ? 'down' : 'up'} tamanho={12} />}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((r) => (
                <tr key={chave(r)} className={onAbrir ? 'clicavel' : undefined} onClick={onAbrir ? () => onAbrir(r) : undefined}>
                  {mostrar.map((c) => (
                    <td key={c.id} className={c.tipo && c.tipo !== 'texto' ? 'num' : undefined}>
                      {tela(c, r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {temSoma && (
              <tfoot>
                <tr>
                  {mostrar.map((c, i) => (
                    <td key={c.id} className={c.tipo && c.tipo !== 'texto' ? 'num' : undefined}>
                      {c.soma ? (c.tipo === 'moeda' ? reais(soma(c)) : soma(c)) : i === 0 ? 'Total' : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
