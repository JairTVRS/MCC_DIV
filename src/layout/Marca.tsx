import type { Configuracoes } from '../lib/tipos';
import { temaEfetivo } from '../lib/tema';

/** Logo do app ou, sem logo cadastrado, o nome do app (ou "Agenda"). */
export function Marca({ config, fundoEscuro }: { config: Configuracoes | null; fundoEscuro?: boolean }) {
  const escuro = fundoEscuro ?? temaEfetivo() === 'escuro';
  const logo = (escuro ? config?.logo_escuro || config?.logo_claro : config?.logo_claro || config?.logo_escuro) || null;
  const nome = config?.nome_app || 'Agenda';
  return logo ? <img src={logo} alt={nome} /> : <span className="nm">{nome}</span>;
}
