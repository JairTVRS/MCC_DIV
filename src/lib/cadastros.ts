import { supabase } from './supabase';
import type { ItemCadastro } from './tipos';

/** Colunas da pessoa usadas em todas as telas. */
export const COLUNAS_PESSOA = 'id, nome, tipo, telefone, email, documento, ativo, movimento_id, paroquia_id';

/** Cadastros simples do app: tabela no banco, função da árvore e textos. */
export const CADASTROS = {
  movimentos: {
    tabela: 'movimentos',
    funcao: 'configuracoes.movimentos',
    titulo: 'Movimentos',
    singular: 'Movimento',
    novo: 'Novo movimento',
    artigo: 'o',
    nota: 'Aparecem no cadastro da pessoa (obrigatório). Desativado some do seletor, mas quem já tem continua com ele.',
  },
  paroquias: {
    tabela: 'paroquias',
    funcao: 'configuracoes.paroquias',
    titulo: 'Paróquias',
    singular: 'Paróquia',
    novo: 'Nova paróquia',
    artigo: 'a',
    nota: 'Aparecem no cadastro da pessoa (obrigatório). Desativada some do seletor, mas quem já tem continua com ela.',
  },
} as const;

export type QualCadastro = keyof typeof CADASTROS;

/** Lê um cadastro inteiro (ativos e inativos), na ordem definida em Configurações. */
export async function carregarCadastro(qual: QualCadastro): Promise<ItemCadastro[]> {
  const { data, error } = await supabase.from(CADASTROS[qual].tabela).select('id, nome, ativo, ordem').order('ordem').order('nome');
  if (error) throw error;
  return (data ?? []) as ItemCadastro[];
}

/** Movimentos e paróquias de uma vez. */
export async function carregarMovimentosParoquias(): Promise<{ movimentos: ItemCadastro[]; paroquias: ItemCadastro[] }> {
  const [movimentos, paroquias] = await Promise.all([carregarCadastro('movimentos'), carregarCadastro('paroquias')]);
  return { movimentos, paroquias };
}

/** Mensagem de nome repetido (índice único do banco). */
export const ehRepetido = (e: unknown) => (e as { code?: string } | null)?.code === '23505';
