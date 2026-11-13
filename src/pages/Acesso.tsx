import { useEffect } from 'react';
import { useSessao } from '../auth/Sessao';
import { Icone } from '../lib/icones';
import { Marca } from '../layout/Marca';

const TEXTOS = {
  pendente: {
    pill: 'Aguardando aprovação',
    titulo: 'Seu acesso está aguardando aprovação',
    texto: 'Avisamos o administrador. Assim que ele liberar, esta tela abre o app sozinha.',
    cor: 'var(--warn)',
  },
  recusado: {
    pill: 'Acesso negado',
    titulo: 'Seu acesso não foi liberado',
    texto: 'O administrador recusou este pedido. Avisamos que você tentou entrar de novo; se ele liberar, esta tela abre o app sozinha.',
    cor: 'var(--danger)',
  },
  inativo: {
    pill: 'Usuário inativo',
    titulo: 'Seu usuário está inativo',
    texto: 'Fale com o administrador para reativar seu acesso.',
    cor: 'var(--muted)',
  },
} as const;

export function Acesso() {
  const { usuario, config, sair, recarregarUsuario } = useSessao();

  // Confere a cada 10 segundos se o administrador já liberou o acesso.
  useEffect(() => {
    const t = window.setInterval(() => void recarregarUsuario(), 10000);
    return () => window.clearInterval(t);
  }, [recarregarUsuario]);

  if (!usuario || usuario.status_acesso === 'ativo') return null;
  const t = TEXTOS[usuario.status_acesso];
  return (
    <div className="gate">
      <main className="gate-card">
        <div className="gate-brand">
          <Marca config={config} />
        </div>
        <span className="status-pill" style={{ color: t.cor }}>{t.pill}</span>
        <h1>{t.titulo}</h1>
        <p>{t.texto}</p>
        {usuario.status_acesso === 'recusado' && usuario.motivo_recusa && <p>Motivo: {usuario.motivo_recusa}</p>}
        <p className="note">Conta: {usuario.email}</p>
        <button className="btn" onClick={() => void sair()}>
          <Icone nome="out" />
          Sair e usar outra conta
        </button>
      </main>
    </div>
  );
}
