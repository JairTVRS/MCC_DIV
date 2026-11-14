export type StatusAcesso = 'pendente' | 'ativo' | 'inativo' | 'recusado';
export type Tema = 'sistema' | 'claro' | 'escuro';

export type Modulo =
  | 'reservas'
  | 'pagamentos'
  | 'anexos'
  | 'comentarios'
  | 'pessoas'
  | 'usuarios'
  | 'logs'
  | 'configuracoes';

export type AcaoSensivel =
  | 'marcar_pago'
  | 'registrar_devolucao'
  | 'confirmar_reserva'
  | 'cancelar_reserva'
  | 'ver_log_geral'
  | 'administrar_usuarios'
  | 'restaurar_lixeira';

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

export interface Permissao {
  modulo: Modulo;
  visualizar: boolean;
  incluir: boolean;
  alterar: boolean;
  excluir: boolean;
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
