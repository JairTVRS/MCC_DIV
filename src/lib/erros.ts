/**
 * Transforma um erro do Supabase (banco, Storage ou rede) numa frase para a tela.
 * As mensagens das regras do banco já vêm em português e passam direto.
 */
export function mensagemErro(e: unknown, padrao = 'Não foi possível concluir. Tente de novo.'): string {
  if (!e) return padrao;
  const err = e as { message?: string; code?: string };
  const msg = (typeof err.message === 'string' ? err.message : String(e)).trim();

  if (err.code === '23505' || /duplicate key/i.test(msg)) return 'Já existe um registro com esse nome.';
  if (err.code === '23514' || /violates check constraint/i.test(msg)) return 'Valor inválido. Confira o que foi digitado.';
  if (/row-level security|permission denied/i.test(msg)) return 'Seu perfil não tem permissão para isso.';
  if (/maximum allowed size|payload too large|too large/i.test(msg)) return 'O arquivo passa do limite de 2 MB.';
  if (/mime type|invalid_mime_type/i.test(msg)) return 'Formato de arquivo não aceito.';
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
  return msg || padrao;
}
