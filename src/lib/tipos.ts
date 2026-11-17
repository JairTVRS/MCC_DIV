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
  /** Inativa não entra em reserva nova; as antigas e o histórico continuam (v1.0.0). */
  ativo: boolean;
  /** Obrigatórios em cadastro novo (v1.1.0); pessoas antigas podem estar em branco até serem editadas. */
  movimento_id: string | null;
  paroquia_id: string | null;
}

/** Item de um cadastro simples (Movimentos, Paróquias). */
export interface ItemCadastro {
  id: string;
  nome: string;
  ativo: boolean;
  ordem: number;
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

/** De onde contam os dias da parcela do prazo: após a pré-reserva ou antes do início do evento. */
export type RefPrazo = 'reserva' | 'evento';
export interface ParcelaPrazo {
  dias: number;
  percentual: number;
  /** Sem o campo = 'reserva' (prazos antigos). */
  ref?: RefPrazo;
}

/** Prazo de pagamento cadastrado: parcelas em dias (após a pré-reserva ou antes do evento) e % do valor. */
export interface PrazoPagamento {
  id: string;
  nome: string;
  parcelas: ParcelaPrazo[];
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
  /** Parcela que conta do evento: dias antes do início (acompanha se a data da reserva mudar). */
  dias_antes_evento: number | null;
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

export interface CategoriaAnexo {
  id: string;
  nome: string;
  ativo: boolean;
  ordem: number;
  /** Usada pelo sistema (Comprovante): não pode ser renomeada nem desativada. */
  sistema: boolean;
}

export interface Anexo {
  id: string;
  locacao_id: string;
  parcela_id: string | null;
  devolucao_id: string | null;
  nome_arquivo: string;
  caminho_storage: string;
  categoria: string;
  tamanho: number;
  enviado_por: string | null;
  enviado_em: string;
}

export interface Comentario {
  id: string;
  locacao_id: string;
  texto: string;
  autor_id: string;
  criado_em: string;
  editado_em: string | null;
}

export interface Notificacao {
  id: string;
  tipo: 'mencao' | 'pedido_acesso' | 'vencimento' | 'atraso';
  lida: boolean;
  criado_em: string;
  locacao_id: string | null;
  comentario_id: string | null;
  titulo: string;
  detalhe: string | null;
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
