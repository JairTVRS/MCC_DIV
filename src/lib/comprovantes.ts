import { carimbo } from './arquivos';
import { supabase } from './supabase';

export const TIPOS_COMPROVANTE = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
export const LIMITE_COMPROVANTE = 20 * 1024 * 1024;

/** Confere tipo e tamanho do comprovante. Devolve a mensagem de erro ou null. */
export function validarComprovante(arquivo: File): string | null {
  if (!TIPOS_COMPROVANTE.includes(arquivo.type)) return 'Formato não aceito. Use PDF ou imagem (PNG, JPG, WebP).';
  if (arquivo.size > LIMITE_COMPROVANTE) return `O arquivo tem ${(arquivo.size / 1048576).toFixed(1)} MB; o limite é 20 MB.`;
  return null;
}

/**
 * Envia o comprovante (bucket privado "anexos") e cria o anexo ligado à parcela ou à devolução.
 * Devolve o id do anexo. Na etapa 8 ele aparece também na aba Anexos da reserva.
 */
export async function enviarComprovante(locacaoId: string, arquivo: File, ligacao: { parcela_id?: string; devolucao_id?: string }): Promise<string> {
  const nomeSeguro = arquivo.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);
  const caminho = `${locacaoId}/${carimbo()}-${nomeSeguro}`;
  const up = await supabase.storage.from('anexos').upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
  if (up.error) throw up.error;
  const { data, error } = await supabase
    .from('anexos')
    .insert({ locacao_id: locacaoId, ...ligacao, nome_arquivo: arquivo.name, caminho_storage: caminho, categoria: 'Comprovante', tamanho: arquivo.size })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/** Abre o comprovante numa aba nova com um link temporário (o arquivo é privado). */
export async function abrirComprovante(anexoId: string): Promise<void> {
  const aba = window.open('', '_blank'); // abre já no clique, para o navegador não bloquear
  const { data: an, error } = await supabase.from('anexos').select('caminho_storage').eq('id', anexoId).single();
  if (error || !an) {
    aba?.close();
    throw error ?? new Error('Comprovante não encontrado.');
  }
  const link = await supabase.storage.from('anexos').createSignedUrl((an as { caminho_storage: string }).caminho_storage, 120);
  if (link.error || !link.data) {
    aba?.close();
    throw link.error ?? new Error('Não foi possível abrir o comprovante.');
  }
  if (aba) aba.location.href = link.data.signedUrl;
  else window.location.href = link.data.signedUrl;
}
