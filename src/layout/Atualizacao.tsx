import { useEffect, useState } from 'react';
import { Icone } from '../lib/icones';

const SEGUNDOS = 5;
const INTERVALO = 60000; // confere a cada minuto

/**
 * Atualização do app: quando uma versão nova é publicada, mostra no canto inferior direito
 * "Atualizando app em 5… 4… 3… 2… 1…" com a engrenagem girando e recarrega a página.
 * Compara o código do build em execução com o /versao.json publicado (só existe no build).
 */
export function Atualizacao() {
  const [contagem, setContagem] = useState<number | null>(null);

  useEffect(() => {
    if (import.meta.env.DEV) return; // no servidor local o Vite já recarrega sozinho
    let parado = false;
    async function conferir() {
      if (parado || document.visibilityState !== 'visible') return;
      try {
        const r = await fetch(`/versao.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) return;
        const { build } = (await r.json()) as { build?: string };
        if (build && build !== __BUILD_ID__) {
          parado = true;
          setContagem(SEGUNDOS);
        }
      } catch {
        /* sem conexão: tenta de novo depois */
      }
    }
    const t = window.setInterval(() => void conferir(), INTERVALO);
    const aoVoltar = () => void conferir();
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);
    return () => {
      parado = true;
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
    };
  }, []);

  useEffect(() => {
    if (contagem === null) return;
    if (contagem <= 0) {
      window.location.reload();
      return;
    }
    const t = window.setTimeout(() => setContagem((c) => (c === null ? c : c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [contagem]);

  if (contagem === null) return null;
  return (
    <div className="atualizando" role="status" aria-live="polite">
      <span className="gira">
        <Icone nome="gear" tamanho={18} />
      </span>
      Atualizando app em {Math.max(contagem, 1)}…
    </div>
  );
}
