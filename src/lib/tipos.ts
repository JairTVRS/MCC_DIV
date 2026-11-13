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
}

export interface Permissao {
  modulo: Modulo;
  visualizar: boolean;
  incluir: boolean;
  alterar: boolean;
  excluir: boolean;
}

export interface VersaoApp {
  numero: string;
  data_publicacao: string;
  itens: string[];
}
