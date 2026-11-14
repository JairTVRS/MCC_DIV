import { useState } from 'react';
import { useSessao } from '../auth/Sessao';
import { GoogleG } from '../lib/icones';
import { Marca } from '../layout/Marca';
import { APP_VERSION } from '../version';

export function Entrar() {
  const { config, erro, entrarComGoogle } = useSessao();
  const [abrindo, setAbrindo] = useState(false);
  return (
    <div className="gate">
      <main className="gate-card">
        <div className="gate-brand">
          <Marca config={config} />
        </div>
        <h1>Agenda de locações</h1>
        <p>Entre com sua conta Google. No primeiro acesso, um administrador precisa liberar sua entrada.</p>
        {erro && <p className="err" role="alert">{erro}</p>}
        <button
          className="btn google"
          disabled={abrindo}
          onClick={async () => {
            setAbrindo(true);
            await entrarComGoogle();
            setAbrindo(false);
          }}
        >
          <GoogleG />
          {abrindo ? 'Abrindo o Google…' : 'Entrar com Google'}
        </button>
        <span className="foot">
          {APP_VERSION} · <a href="/privacidade">Política de privacidade</a>
        </span>
      </main>
    </div>
  );
}
