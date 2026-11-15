import { useState } from 'react';
import { useSessao } from '../../auth/Sessao';
import { FormasPagamento } from './FormasPagamento';
import { Geral } from './Geral';
import { Lixeira } from './Lixeira';
import { PrazosPagamento } from './PrazosPagamento';

type Aba = 'geral' | 'formas' | 'prazos' | 'lixeira';
const ABAS: Aba[] = ['geral', 'formas', 'prazos', 'lixeira'];

function abaLembrada(): Aba {
  try {
    const a = localStorage.getItem('config-aba');
    if (ABAS.includes(a as Aba)) return a as Aba;
  } catch {
    /* armazenamento indisponível */
  }
  return 'geral';
}

/** Engrenagem: cada aba segue a sua função na árvore (Configurações > Nome, logo e ícone / Formas / Prazos / Lixeira). */
export function Configuracoes() {
  const { tem } = useSessao();
  const abas: { id: Aba; titulo: string }[] = [
    { id: 'geral', titulo: 'Geral' },
    { id: 'formas', titulo: 'Formas de pagamento' },
    { id: 'prazos', titulo: 'Prazos de pagamento' },
    ...(tem('configuracoes.lixeira') ? [{ id: 'lixeira' as const, titulo: 'Lixeira' }] : []),
  ];
  const [escolhida, setEscolhida] = useState<Aba>(abaLembrada);
  const aba = abas.some((a) => a.id === escolhida) ? escolhida : 'geral';
  const podeAlterar = {
    geral: tem('configuracoes.nome_logo'),
    formas: tem('configuracoes.formas_pagamento'),
    prazos: tem('configuracoes.prazos'),
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
    <div className="pagina">
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
        {aba === 'lixeira' && <Lixeira />}
      </div>
    </div>
  );
}
