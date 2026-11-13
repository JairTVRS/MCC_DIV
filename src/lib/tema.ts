import type { Tema } from './tipos';

export function aplicarTema(tema: Tema) {
  const root = document.documentElement;
  if (tema === 'claro') root.setAttribute('data-theme', 'light');
  else if (tema === 'escuro') root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
  try {
    localStorage.setItem('tema', tema);
  } catch {
    /* armazenamento indisponível: o tema vale só nesta sessão */
  }
}

export function temaEfetivo(): 'claro' | 'escuro' {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark') return 'escuro';
  if (attr === 'light') return 'claro';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
}
