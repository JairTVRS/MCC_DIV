import { useSessao } from './auth/Sessao';
import { Atualizacao } from './layout/Atualizacao';
import { Casca } from './layout/Casca';
import { Acesso } from './pages/Acesso';
import { Entrar } from './pages/Entrar';

function Tela() {
  const { carregando, sessao, usuario } = useSessao();
  if (carregando) return <div className="gate" aria-busy="true" />;
  if (!sessao || !usuario) return <Entrar />;
  if (usuario.status_acesso !== 'ativo') return <Acesso />;
  return <Casca />;
}

export function App() {
  return (
    <>
      <Tela />
      {/* Versão nova publicada: aviso no canto inferior direito e recarga em 5 segundos, em qualquer tela. */}
      <Atualizacao />
    </>
  );
}
