import { supabase } from '../../lib/supabase';
import { COMPROMISSO, PAGAMENTO, TIPO_PESSOA, reais } from '../agenda/formatos';

/** Linha do log_eventos (a função historico() devolve também o nome do registro). */
export interface Evento {
  id: number;
  tabela: string;
  registro_id: string | null;
  locacao_id?: string | null;
  usuario_id: string | null;
  acao: string;
  campo: string | null;
  valor_anterior: string | null;
  valor_novo: string | null;
  data_hora: string;
  registro?: string | null;
}

/** Uma gravação: mesma hora, pessoa e registro viram uma linha só. */
export interface GrupoEventos {
  chave: string;
  quando: string;
  quem: string;
  titulo: string;
  /** Nome do registro (no histórico geral, para saber do que se trata). */
  registro: string | null;
  locacaoId: string | null;
  tabela: string;
  linhas: string[];
}

/** Nomes usados para traduzir ids do log em texto. */
export interface Contexto {
  pessoas: Map<string, string>;
  usuarios: Map<string, string>;
  perfis: Map<string, string>;
  formas: Map<string, string>;
  prazos: Map<string, string>;
  funcoes: Map<string, string>;
  parcelas: Map<string, { numero: number; tipo: string; valor: number; vencimento: string }>;
}

export const TIPOS_REGISTRO: { id: string; rotulo: string; tabelas: string[] }[] = [
  { id: 'reservas', rotulo: 'Reservas', tabelas: ['locacoes'] },
  { id: 'pagamentos', rotulo: 'Pagamentos', tabelas: ['parcelas', 'devolucoes'] },
  { id: 'anexos', rotulo: 'Anexos', tabelas: ['anexos'] },
  { id: 'comentarios', rotulo: 'Comentários', tabelas: ['comentarios', 'comentario_mencoes'] },
  { id: 'pessoas', rotulo: 'Pessoas', tabelas: ['pessoas'] },
  { id: 'usuarios', rotulo: 'Usuários e grupos', tabelas: ['usuarios', 'perfis', 'grupo_funcoes'] },
  { id: 'configuracoes', rotulo: 'Configurações', tabelas: ['configuracoes', 'formas_pagamento', 'prazos_pagamento', 'categorias_anexo'] },
];

const NOME_TABELA: Record<string, [string, 'a' | 'o']> = {
  locacoes: ['reserva', 'a'],
  parcelas: ['parcela', 'a'],
  devolucoes: ['devolução', 'a'],
  anexos: ['anexo', 'o'],
  comentarios: ['comentário', 'o'],
  comentario_mencoes: ['menção', 'a'],
  pessoas: ['pessoa', 'a'],
  usuarios: ['usuário', 'o'],
  perfis: ['grupo', 'o'],
  grupo_funcoes: ['permissão', 'a'],
  configuracoes: ['configuração', 'a'],
  formas_pagamento: ['forma de pagamento', 'a'],
  prazos_pagamento: ['prazo de pagamento', 'o'],
  categorias_anexo: ['categoria de anexo', 'a'],
};
const ACAO: Record<string, string> = { criou: 'incluiu', alterou: 'alterou', excluiu: 'excluiu', restaurou: 'restaurou', apagou: 'apagou', liberou: 'liberou', retirou: 'retirou' };

const CAMPO: Record<string, string> = {
  locatario_id: 'Locatário',
  locador_id: 'Locador',
  responsavel_id: 'Responsável',
  inicio: 'Início',
  fim: 'Fim',
  status_compromisso: 'Status',
  status_pagamento: 'Pagamento',
  valor_total: 'Valor da locação',
  desconto: 'Desconto',
  motivo_desconto: 'Motivo do desconto',
  observacoes: 'Observações',
  pre_reserva_em: 'Pré-reserva desde',
  prazo_id: 'Prazo de pagamento',
  numero: 'Número',
  tipo: 'Tipo',
  valor: 'Valor',
  vencimento: 'Vencimento',
  forma_pagamento_id: 'Forma',
  paga: 'Paga',
  pago_em: 'Pago em',
  comprovante_id: 'Comprovante',
  encerrada: 'Encerrada',
  substituida: 'Substituída pelo plano',
  valor_devolvido: 'Valor devolvido',
  valor_retido: 'Valor retido',
  data: 'Data',
  motivo: 'Motivo',
  nome_arquivo: 'Arquivo',
  categoria: 'Categoria',
  texto: 'Texto',
  nome: 'Nome',
  telefone: 'Telefone',
  email: 'E-mail',
  documento: 'Documento',
  ativo: 'Ativo',
  status_acesso: 'Acesso',
  perfil_id: 'Grupo',
  motivo_recusa: 'Motivo da recusa',
  usar_foto_upload: 'Foto própria',
  foto_upload: 'Foto',
  descricao: 'Descrição',
  ordem: 'Ordem',
  parcelas: 'Parcelas',
  nome_app: 'Nome do app',
  logo_claro: 'Logo (fundo claro)',
  logo_escuro: 'Logo (fundo escuro)',
  favicon: 'Ícone da aba',
  favicon_proprio: 'Ícone próprio',
  usuario_mencionado_id: 'Marcou',
};
const OCULTOS = new Set([
  'espaco_id', 'locacao_id', 'parcela_id', 'devolucao_id', 'caminho_storage', 'tamanho', 'autor_id', 'editado_em', 'id',
  'decidido_por', 'decidido_em', 'solicitado_em', 'foto_google', 'sistema', 'comentario_id',
]);
const MOEDA = new Set(['valor_total', 'desconto', 'valor', 'valor_devolvido', 'valor_retido']);
const DATA_HORA = new Set(['inicio', 'fim', 'pre_reserva_em']);
const DATA = new Set(['vencimento', 'pago_em', 'data']);
const ACESSO: Record<string, string> = { pendente: 'Pendente', ativo: 'Ativo', inativo: 'Inativo', recusado: 'Recusado' };

const mapa = (linhas: { id: string; nome: string }[] | null) => new Map((linhas ?? []).map((x) => [x.id, x.nome]));

/** Nomes de pessoas, usuários, grupos, formas, prazos e funções para traduzir o log. */
export async function carregarContexto(locacaoId?: string): Promise<Contexto> {
  const [pe, us, pf, fo, pr, fu, pa] = await Promise.all([
    supabase.from('pessoas').select('id, nome'),
    supabase.from('usuarios').select('id, nome'),
    supabase.from('perfis').select('id, nome'),
    supabase.from('formas_pagamento').select('id, nome'),
    supabase.from('prazos_pagamento').select('id, nome'),
    supabase.from('funcoes').select('codigo, rotulo, pai'),
    locacaoId ? supabase.from('parcelas').select('id, numero, tipo, valor, vencimento').eq('locacao_id', locacaoId) : Promise.resolve({ data: [] }),
  ]);
  const funcoes = (fu.data ?? []) as { codigo: string; rotulo: string; pai: string | null }[];
  const rotulo = new Map(funcoes.map((f) => [f.codigo, f.rotulo]));
  return {
    pessoas: mapa(pe.data as { id: string; nome: string }[]),
    usuarios: mapa(us.data as { id: string; nome: string }[]),
    perfis: mapa(pf.data as { id: string; nome: string }[]),
    formas: mapa(fo.data as { id: string; nome: string }[]),
    prazos: mapa(pr.data as { id: string; nome: string }[]),
    // "Agenda > Incluir"
    funcoes: new Map(funcoes.map((f) => [f.codigo, f.pai ? `${rotulo.get(f.pai) ?? f.pai} > ${f.rotulo}` : f.rotulo])),
    parcelas: new Map(((pa.data ?? []) as { id: string; numero: number; tipo: string; valor: number; vencimento: string }[]).map((p) => [p.id, p])),
  };
}

const dataBr = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');
const dataHoraBr = (d: string) => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const quandoCurto = (d: string) => {
  const x = new Date(d);
  return `${x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })} ${x.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
};

function valor(ctx: Contexto, campo: string, v: string | null): string {
  if (v === null || v === '') return '—';
  if (campo === 'status_compromisso') return COMPROMISSO[v as keyof typeof COMPROMISSO]?.rotulo ?? v;
  if (campo === 'status_pagamento') return PAGAMENTO[v as keyof typeof PAGAMENTO] ?? v;
  if (campo === 'status_acesso') return ACESSO[v] ?? v;
  if (campo === 'locatario_id' || campo === 'locador_id') return ctx.pessoas.get(v) ?? 'pessoa';
  if (campo === 'responsavel_id' || campo === 'usuario_mencionado_id') return ctx.usuarios.get(v) ?? 'usuário';
  if (campo === 'perfil_id') return ctx.perfis.get(v) ?? 'grupo removido';
  if (campo === 'forma_pagamento_id') return ctx.formas.get(v) ?? 'forma removida';
  if (campo === 'prazo_id') return ctx.prazos.get(v) ?? 'prazo removido';
  if (campo === 'comprovante_id') return 'anexado';
  if (campo === 'foto_upload' || campo.startsWith('logo_') || campo === 'favicon') return 'imagem';
  if (campo === 'parcelas') return 'alteradas';
  if (campo === 'tipo') return v === 'entrada' ? 'Entrada' : v === 'parcela' ? 'Parcela' : TIPO_PESSOA[v as keyof typeof TIPO_PESSOA] ?? v;
  if (v === 'true') return 'Sim';
  if (v === 'false') return 'Não';
  if (MOEDA.has(campo)) return reais(Number(v));
  if (DATA_HORA.has(campo)) return dataHoraBr(v);
  if (DATA.has(campo)) return dataBr(v);
  return v.length > 120 ? `${v.slice(0, 120)}…` : v;
}

function nomeRegistro(ctx: Contexto, e: Evento): string {
  if (e.tabela === 'parcelas' && e.registro_id) {
    const p = ctx.parcelas.get(e.registro_id);
    if (p) return p.tipo === 'entrada' ? 'a entrada' : `a parcela ${p.numero}`;
  }
  const [nome, g] = NOME_TABELA[e.tabela] ?? [e.tabela, 'o'];
  return `${g} ${nome}`;
}

/**
 * Agrupa os eventos (mais novos primeiro) numa linha por gravação.
 * `comRegistro`: mostra de qual reserva/pessoa/usuário é (histórico geral).
 */
export function agrupar(eventos: Evento[], ctx: Contexto): GrupoEventos[] {
  const lista: GrupoEventos[] = [];
  const porChave = new Map<string, GrupoEventos>();
  for (const e of eventos) {
    if (e.campo && OCULTOS.has(e.campo)) continue;
    // Parcela nasce com número 0 e o banco renumera em seguida: detalhe interno, não aparece.
    if (e.campo === 'numero' && e.valor_anterior === '0') continue;
    const chave = `${e.data_hora}|${e.usuario_id}|${e.tabela}|${e.registro_id}|${e.acao}`;
    let g = porChave.get(chave);
    if (!g) {
      let titulo: string;
      if (e.tabela === 'grupo_funcoes') {
        const f = e.valor_novo ?? e.valor_anterior ?? '';
        titulo = `${ACAO[e.acao] ?? e.acao} ${ctx.funcoes.get(f) ?? f}`;
      } else if (e.tabela === 'comentario_mencoes') {
        titulo = 'marcou alguém num comentário';
      } else {
        titulo = `${ACAO[e.acao] ?? e.acao} ${nomeRegistro(ctx, e)}`;
        if (e.acao === 'criou' && e.tabela === 'parcelas' && e.registro_id && ctx.parcelas.get(e.registro_id)) {
          const p = ctx.parcelas.get(e.registro_id)!;
          titulo += ` (${reais(Number(p.valor))}, vence ${dataBr(p.vencimento)})`;
        }
      }
      g = {
        chave,
        quando: quandoCurto(e.data_hora),
        quem: e.usuario_id ? ctx.usuarios.get(e.usuario_id) ?? 'usuário' : 'Sistema',
        titulo,
        registro: e.registro ?? null,
        locacaoId: e.locacao_id ?? null,
        tabela: e.tabela,
        linhas: [],
      };
      porChave.set(chave, g);
      lista.push(g);
    }
    if (e.acao === 'alterou' && e.campo) {
      g.linhas.push(`${CAMPO[e.campo] ?? e.campo} ${valor(ctx, e.campo, e.valor_anterior)} → ${valor(ctx, e.campo, e.valor_novo)}`);
    }
  }
  // "alterou" sem nenhum campo visível (só detalhes internos) não aparece.
  return lista.filter((g) => g.linhas.length > 0 || !g.titulo.startsWith('alterou'));
}
