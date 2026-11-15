import { useMemo } from 'react';
import type { NoArvore } from '../../lib/tipos';

interface Props {
  nos: NoArvore[];
  marcadas: Set<string>;
  editavel: boolean;
  onChange: (novas: Set<string>) => void;
}

/**
 * Árvore módulo > função com caixas de marcar.
 * Marcar o módulo marca todas as funções dentro dele; com só algumas marcadas, ele fica "meio marcado".
 * Marcar Incluir/Alterar/Excluir (ou outra função) marca junto o Visualizar do mesmo módulo;
 * desmarcar o Visualizar desmarca as outras funções do módulo.
 */
export function ArvorePermissoes({ nos, marcadas, editavel, onChange }: Props) {
  const filhos = useMemo(() => {
    const m = new Map<string | null, NoArvore[]>();
    for (const n of nos) {
      const lista = m.get(n.pai) ?? [];
      lista.push(n);
      m.set(n.pai, lista);
    }
    m.forEach((l) => l.sort((a, b) => a.ordem - b.ordem));
    return m;
  }, [nos]);

  const folhasDe = useMemo(() => {
    const cache = new Map<string, string[]>();
    const calc = (codigo: string): string[] => {
      const c = cache.get(codigo);
      if (c) return c;
      const r = (filhos.get(codigo) ?? []).flatMap((f) => (f.tipo === 'funcao' ? [f.codigo] : calc(f.codigo)));
      cache.set(codigo, r);
      return r;
    };
    return calc;
  }, [filhos]);

  function irmaosFuncao(no: NoArvore): NoArvore[] {
    return (filhos.get(no.pai) ?? []).filter((n) => n.tipo === 'funcao');
  }

  function alternarFuncao(no: NoArvore) {
    const novas = new Set(marcadas);
    const prefixo = no.codigo.split('.')[0];
    const visualizar = irmaosFuncao(no).find((n) => n.codigo === `${prefixo}.visualizar`);
    if (novas.has(no.codigo)) {
      novas.delete(no.codigo);
      if (visualizar && no.codigo === visualizar.codigo) {
        irmaosFuncao(no).forEach((n) => n.codigo.startsWith(`${prefixo}.`) && novas.delete(n.codigo));
      }
    } else {
      novas.add(no.codigo);
      if (visualizar) novas.add(visualizar.codigo);
    }
    onChange(novas);
  }

  function alternarModulo(no: NoArvore) {
    const folhas = folhasDe(no.codigo);
    const todas = folhas.every((f) => marcadas.has(f));
    const novas = new Set(marcadas);
    folhas.forEach((f) => (todas ? novas.delete(f) : novas.add(f)));
    onChange(novas);
  }

  function renderNivel(pai: string | null) {
    const lista = filhos.get(pai) ?? [];
    if (!lista.length) return null;
    return (
      <ul className="arvore-nivel">
        {lista.map((no) => {
          if (no.tipo === 'funcao') {
            return (
              <li key={no.codigo} className="arvore-funcao">
                <label title={no.descricao ?? undefined}>
                  <input type="checkbox" checked={marcadas.has(no.codigo)} disabled={!editavel} onChange={() => alternarFuncao(no)} />
                  <span>{no.rotulo}</span>
                  {no.descricao && <small>{no.descricao}</small>}
                </label>
              </li>
            );
          }
          const folhas = folhasDe(no.codigo);
          const qtd = folhas.filter((f) => marcadas.has(f)).length;
          return (
            <li key={no.codigo} className="arvore-modulo">
              <label className="arvore-cab">
                <input
                  type="checkbox"
                  checked={qtd > 0 && qtd === folhas.length}
                  ref={(el) => {
                    if (el) el.indeterminate = qtd > 0 && qtd < folhas.length;
                  }}
                  disabled={!editavel || folhas.length === 0}
                  onChange={() => alternarModulo(no)}
                />
                <strong>{no.rotulo}</strong>
                <span className="arvore-qtd">
                  {qtd}/{folhas.length}
                </span>
              </label>
              {renderNivel(no.codigo)}
            </li>
          );
        })}
      </ul>
    );
  }

  return <div className="arvore">{renderNivel(null)}</div>;
}
