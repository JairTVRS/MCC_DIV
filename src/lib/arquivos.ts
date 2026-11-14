import { supabase } from './supabase';

export type Bucket = 'marca' | 'avatares';

export const DOIS_MB = 2 * 1024 * 1024;

/** Sufixo curto e único para cada envio: um nome novo evita que o navegador mostre a imagem antiga do cache. */
export function carimbo(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function extensao(tipo: string): string {
  if (tipo === 'image/svg+xml') return 'svg';
  if (tipo === 'image/jpeg') return 'jpg';
  return tipo.replace('image/', '');
}

/** Confere tipo e tamanho antes de enviar. Devolve a mensagem de erro ou null. */
export function validarImagem(arquivo: File, tipos: string[], limite: number): string | null {
  if (!tipos.includes(arquivo.type)) {
    const nomes = tipos.map((t) => extensao(t).toUpperCase()).join(', ');
    return `Formato não aceito. Use ${nomes}.`;
  }
  if (arquivo.size > limite) return `O arquivo tem ${(arquivo.size / 1048576).toFixed(1)} MB; o limite é ${Math.round(limite / 1048576)} MB.`;
  return null;
}

/** Envia o arquivo ao Storage e devolve o endereço público. */
export async function enviarArquivo(bucket: Bucket, caminho: string, arquivo: Blob, tipo: string): Promise<string> {
  const { error } = await supabase.storage.from(bucket).upload(caminho, arquivo, { contentType: tipo, cacheControl: '31536000', upsert: false });
  if (error) throw error;
  return supabase.storage.from(bucket).getPublicUrl(caminho).data.publicUrl;
}

export function caminhoDaUrl(bucket: Bucket, url: string): string | null {
  const marca = `/storage/v1/object/public/${bucket}/`;
  const i = url.indexOf(marca);
  return i < 0 ? null : decodeURIComponent(url.slice(i + marca.length).split('?')[0]);
}

/** Apaga arquivos que deixaram de ser usados. Falha aqui não atrapalha o usuário: só fica registrada no console. */
export async function removerArquivos(bucket: Bucket, urls: (string | null | undefined)[]): Promise<void> {
  const caminhos = urls.map((u) => (u ? caminhoDaUrl(bucket, u) : null)).filter((c): c is string => !!c);
  if (caminhos.length === 0) return;
  const { error } = await supabase.storage.from(bucket).remove(caminhos);
  if (error) console.warn('[Agenda] Não foi possível apagar arquivo antigo:', error.message);
}

export function carregarImagem(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, falha) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => ok(img);
    img.onerror = () => falha(new Error('Não foi possível abrir a imagem.'));
    img.src = src;
  });
}

export function canvasParaBlob(canvas: HTMLCanvasElement, tipo: string, qualidade?: number): Promise<Blob> {
  return new Promise((ok, falha) => {
    canvas.toBlob((b) => (b ? ok(b) : falha(new Error('Não foi possível gerar a imagem.'))), tipo, qualidade);
  });
}

/** Ícone da aba: o logo centralizado num quadrado de 64×64 px, em PNG. */
export async function gerarFavicon(src: string): Promise<Blob> {
  const img = await carregarImagem(src);
  const lado = 64;
  const w = img.naturalWidth || lado;
  const h = img.naturalHeight || lado;
  const escala = Math.min(lado / w, lado / h);
  const canvas = document.createElement('canvas');
  canvas.width = lado;
  canvas.height = lado;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Navegador sem suporte a desenho de imagens.');
  const dw = w * escala;
  const dh = h * escala;
  ctx.drawImage(img, (lado - dw) / 2, (lado - dh) / 2, dw, dh);
  return canvasParaBlob(canvas, 'image/png');
}
