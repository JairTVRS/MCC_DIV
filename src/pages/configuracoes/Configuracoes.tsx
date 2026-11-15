import { useState } from 'react';
import { useSessao } from '../../auth/Sessao';
import { HistoricoGeral } from '../historico/HistoricoGeral';
import { CategoriasAnexo } from './CategoriasAnexo';
import { FormasPagamento } from './FormasPagamento';
import { Geral } from './Geral';
import { Lixeira } from './Lixeira';
import { PrazosPagamento } from './PrazosPagamento';

type Aba = 'geral' | 'formas' | 'prazos' | 'categorias' | 'historico' | 'lixeira';
const ABAS: Aba[] = ['geral', 'formas', 'prazos', 'categorias', 'historico', 'lixeira'];

function abaLembrada(): Aba {
  try {
    const a = localStorage.getItem('config-aba');
    if (ABAS.includes(a as Aba)) return a as Aba;
  } catch {
    /* armazenamento indisponível */
  }
  return 'geral';
}

/** Quem vê a engrenagem: quem tem Configurações > Visualizar, a lixeira ou o histórico geral. */
export function veEngrenagem(tem: (f: string) => boolean): boolean {
  return tem('configuracoes.visualizar') || tem('configuracoes.lixeira') || tem('logs.geral');
}

/** Engrenagem: cada aba segue a sua função na árvore. */
export function Configuracoes() {
  const { tem } = useSessao();
  const veConfig = tem('configuracoes.visualizar');
  const abas: { id: Aba; titulo: string }[] = [
    ...(veConfig
      ? [
          { id: 'geral' as const, titulo: 'Geral' },
          { id: 'formas' as const, titulo: 'Formas de pagamento' },
          { id: 'prazos' as const, titulo: 'Prazos de pagamento' },
          { id: 'categorias' as const, titulo: 'Categorias de anexo' },
        ]
      : []),
    ...(tem('logs.geral') ? [{ id: 'historico' as const, titulo: 'Histórico' }] : []),
    ...(tem('configuracoes.lixeira') ? [{ id: 'lixeira' as const, titulo: 'Lixeira' }] : []),
  ];
  const [escolhida, setEscolhida] = useState<Aba>(abaLembrada);
  const aba = abas.some((a) => a.id === escolhida) ? escolhida : abas[0]?.id ?? 'geral';
  const podeAlterar = {
    geral: tem('configuracoes.nome_logo'),
    formas: tem('configuracoes.formas_pagamento'),
    prazos: tem('configuracoes.prazos'),
    categorias: tem('configuracoes.categorias_anexo'),
    historico: true,
    lixeira: true,
  }[aba];

  function trocar(a: Aba) {
    setEscolhida(a);
    try {
      localStorage.setItem('config-aba', a);
    } catch {
      /* armazenamento indisponível */
    }
  }

  return (
    <div className={`pagina${aba === 'historico' ? ' larga' : ''}`}>
      <div className="tabs" role="tablist" aria-label="Seções das configurações">
        {abas.map((a) => (
          <button key={a.id} role="tab" id={`aba-${a.id}`} aria-selected={aba === a.id} aria-controls={`painel-${a.id}`} onClick={() => trocar(a.id)}>
            {a.titulo}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`painel-${aba}`} aria-labelledby={`aba-${aba}`}>
        {!podeAlterar && <p className="aviso">Só leitura: seu grupo pode ver, mas não alterar esta seção.</p>}
        {aba === 'geral' && <Geral podeAlterar={podeAlterar} />}
        {aba === 'formas' && <FormasPagamento podeAlterar={podeAlterar} />}
        {aba === 'prazos' && <PrazosPagamento podeAlterar={podeAlterar} />}
        {aba === 'categorias' && <CategoriasAnexo podeAlterar={podeAlterar} />}
        {aba === 'historico' && <HistoricoGeral />}
        {aba === 'lixeira' && <Lixeira />}
      </div>
    </div>
  );
}
