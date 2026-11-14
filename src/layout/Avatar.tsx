import { useEffect, useState } from 'react';
import type { Usuario } from '../lib/tipos';

/** Foto que o usuário escolheu mostrar: a enviada por ele ou a do Google. */
export function fotoDe(u: Pick<Usuario, 'foto_google' | 'foto_upload' | 'usar_foto_upload'>): string | null {
  return u.usar_foto_upload && u.foto_upload ? u.foto_upload : u.foto_google;
}

export function iniciaisDe(nome: string): string {
  return (
    nome
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((x) => x[0])
      .join('')
      .toUpperCase() || '?'
  );
}

/** Foto redonda; sem foto (ou se ela não carregar), mostra as iniciais. */
export function Avatar({ nome, foto, tamanho = 34 }: { nome: string; foto: string | null; tamanho?: number }) {
  const [falhou, setFalhou] = useState(false);
  useEffect(() => setFalhou(false), [foto]);
  return (
    <span className="av" style={{ width: tamanho, height: tamanho, fontSize: Math.round(tamanho * 0.38) }}>
      {foto && !falhou ? <img src={foto} alt="" referrerPolicy="no-referrer" onError={() => setFalhou(true)} /> : iniciaisDe(nome)}
    </span>
  );
}
