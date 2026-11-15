export type StatusAcesso = 'pendente' | 'ativo' | 'inativo' | 'recusado';
export type Tema = 'sistema' | 'claro' | 'escuro';

/** Código de uma função da árvore de permissões (tabela "funcoes"), ex.: 'reservas.visualizar'. */
export type CodigoFuncao = string;

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  status_acesso: StatusAcesso;
  perfil_id: string | null;
  foto_google: string | null;
  foto_upload: string | null;
  usar_foto_upload: boolean;
  tema_preferido: Tema;
  ultima_versao_vista: string | null;
  motivo_recusa: string | null;
}

export interface Configuracoes {
  nome_app: string | null;
  logo_claro: string | null;
  logo_escuro: string | null;
  favicon: string | null;
  /** true: ícone enviado à parte; false: gerado a partir do logo. */
  favicon_proprio: boolean;
}

/** Grupo de usuários (no banco: tabela "perfis"). */
export interface Grupo {
  id: string;
  nome: string;
  descricao: string | null;
  sistema: boolean;
}

/** Nó da árvore de permissões: módulo (só agrupa) ou função (o que se libera). */
export interface NoArvore {
  codigo: string;
  pai: string | null;
  tipo: 'modulo' | 'funcao';
  rotulo: string;
  descricao: string | null;
  ordem: number;
}

/** Usuário como aparece na administração (lista de espera e lista de usuários). */
export interface UsuarioAdmin {
  id: string;
  nome: string;
  email: string;
  status_acesso: StatusAcesso;
  perfil_id: string | null;
  foto_google: string | null;
  foto_upload: string | null;
  usar_foto_upload: boolean;
  motivo_recusa: string | null;
  solicitado_em: string;
  decidido_em: string | null;
  decidido_por: string | null;
}

export type TipoPessoa = 'locatario' | 'locador' | 'ambos';

export interface Pessoa {
  id: string;
  nome: string;
  tipo: TipoPessoa;
  telefone: string | null;
  email: string | null;
  documento: string | null;
}

export type StatusCompromisso = 'cadastrado' | 'pre_reserva' | 'reservado' | 'cancelado';
export type StatusPagamento = 'pendente' | 'parcial' | 'pago' | 'devolvido' | 'devolvido_parcial';

export interface Reserva {
  id: string;
  locatario_id: string;
  locador_id: string;
  responsavel_id: string;
  inicio: string;
  fim: string;
  status_compromisso: StatusCompromisso;
  status_pagamento: StatusPagamento;
  valor_total: number;
  /** Desconto em R$ (até o valor total). Valor final = valor_total - desconto. */
  desconto: number;
  motivo_desconto: string | null;
  /** Quando entrou em Pré-reserva: data base dos prazos de pagamento. */
  pre_reserva_em: string | null;
  /** Prazo de pagamento usado no plano de parcelas. */
  prazo_id: string | null;
  observacoes: string | null;
  criado_por: string | null;
  criado_em: string;
  alterado_por: string | null;
  alterado_em: string | null;
}

/** Prazo de pagamento cadastrado: parcelas em dias (a partir da pré-reserva) e % do valor. */
export interface PrazoPagamento {
  id: string;
  nome: string;
  parcelas: { dias: number; percentual: number }[];
  ativo: boolean;
  ordem: number;
}

export interface Parcela {
  id: string;
  locacao_id: string;
  numero: number;
  tipo: 'entrada' | 'parcela';
  valor: number;
  vencimento: string; // AAAA-MM-DD
  forma_pagamento_id: string | null;
  paga: boolean;
  pago_em: string | null;
  comprovante_id: string | null;
  encerrada: boolean;
}

export interface Devolucao {
  id: string;
  locacao_id: string;
  valor_devolvido: number;
  valor_retido: number;
  data: string;
  forma_pagamento_id: string | null;
  motivo: string | null;
  comprovante_id: string | null;
  registrado_em: string;
}

export interface FormaPagamento {
  id: string;
  nome: string;
  ativo: boolean;
  ordem: number;
}

export type TabelaLixeira = 'locacoes' | 'parcelas' | 'anexos' | 'comentarios' | 'pessoas';

export interface ItemLixeira {
  tabela: TabelaLixeira;
  id: string;
  descricao: string;
  detalhe: string | null;
  excluido_por_nome: string | null;
  excluido_em: string | null;
}

export interface UsuarioOnline {
  id: string;
  nome: string;
  foto: string | null;
}

export interface VersaoApp {
  numero: string;
  data_publicacao: string;
  itens: string[];
}
