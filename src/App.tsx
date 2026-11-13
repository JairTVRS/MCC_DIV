import { useSessao } from './auth/Sessao';
import { Casca } from './layout/Casca';
import { Acesso } from './pages/Acesso';
import { Entrar } from './pages/Entrar';

export function App() {
  const { carregando, sessao, usuario } = useSessao();
  if (carregando) return <div className="gate" aria-busy="true" />;
  if (!sessao || !usuario) return <Entrar />;
  if (usuario.status_acesso !== 'ativo') return <Acesso />;
  return <Casca />;
}
