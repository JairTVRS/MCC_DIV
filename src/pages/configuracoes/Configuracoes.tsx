import { useState } from 'react';
import { useSessao } from '../../auth/Sessao';
import { FormasPagamento } from './FormasPagamento';
import { Geral } from './Geral';
import { Lixeira } from './Lixeira';

type Aba = 'geral' | 'formas' | 'lixeira';

function abaLembrada(): Aba {
  try {
    const a = localStorage.getItem('config-aba');
    if (a === 'geral' || a === 'formas' || a === 'lixeira') return a;
  } catch {
    /* armazenamento indisponível */
  }
  return 'geral';
}

export function Configuracoes() {
  const { pode, temAcao } = useSessao();
  const podeAlterar = pode('configuracoes', 'alterar');
  const abas: { id: Aba; titulo: string }[] = [
    { id: 'geral', titulo: 'Geral' },
    { id: 'formas', titulo: 'Formas de pagamento' },
    ...(temAcao('restaurar_lixeira') ? [{ id: 'lixeira' as const, titulo: 'Lixeira' }] : []),
  ];
  const [escolhida, setEscolhida] = useState<Aba>(abaLembrada);
  const aba = abas.some((a) => a.id === escolhida) ? escolhida : 'geral';

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
        {!podeAlterar && aba !== 'lixeira' && <p className="aviso">Só leitura: seu perfil pode ver, mas não alterar as configurações.</p>}
        {aba === 'geral' && <Geral podeAlterar={podeAlterar} />}
        {aba === 'formas' && <FormasPagamento podeAlterar={podeAlterar} />}
        {aba === 'lixeira' && <Lixeira />}
      </div>
    </div>
  );
}
