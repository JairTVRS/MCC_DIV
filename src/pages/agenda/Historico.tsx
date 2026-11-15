import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import type { Pessoa } from '../../lib/tipos';
import type { UsuarioCurto } from './FormReserva';
import { COMPROMISSO, PAGAMENTO, TIPO_PESSOA, reais } from './formatos';

interface Evento {
  id: number;
  tabela: string;
  registro_id: string | null;
  usuario_id: string | null;
  acao: string;
  campo: string | null;
  valor_anterior: string | null;
  valor_novo: string | null;
  data_hora: string;
}

interface Grupo {
  chave: string;
  quando: string;
  quem: string;
  titulo: string;
  linhas: string[];
}

const TABELA: Record<string, string> = {
  locacoes: 'Reserva',
  parcelas: 'Parcela',
  devolucoes: 'Devolução',
  anexos: 'Anexo',
  comentarios: 'Comentário',
  comentario_mencoes: 'Menção',
};
const ACAO: Record<string, string> = { criou: 'incluiu', alterou: 'alterou', excluiu: 'excluiu', restaurou: 'restaurou', apagou: 'apagou' };

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
};
const OCULTOS = new Set(['espaco_id', 'locacao_id', 'parcela_id', 'devolucao_id', 'caminho_storage', 'tamanho', 'autor_id', 'editado_em', 'id']);
const MOEDA = new Set(['valor_total', 'desconto', 'valor', 'valor_devolvido', 'valor_retido']);
const DATA_HORA = new Set(['inicio', 'fim', 'pre_reserva_em']);
const DATA = new Set(['vencimento', 'pago_em', 'data']);

/** Histórico da reserva (log imutável do banco): inclusões, alterações, exclusões, de tudo que é da reserva. */
export function Historico({ locacaoId, pessoas, usuarios, onFechar }: { locacaoId: string; pessoas: Pessoa[]; usuarios: UsuarioCurto[]; onFechar: () => void }) {
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [ev, pa, fo, pr] = await Promise.all([
        supabase.from('log_eventos').select('id, tabela, registro_id, usuario_id, acao, campo, valor_anterior, valor_novo, data_hora').eq('locacao_id', locacaoId).order('data_hora', { ascending: false }).order('id', { ascending: false }).limit(500),
        supabase.from('parcelas').select('id, numero, tipo, valor, vencimento').eq('locacao_id', locacaoId),
        supabase.from('formas_pagamento').select('id, nome'),
        supabase.from('prazos_pagamento').select('id, nome'),
      ]);
      if (ev.error) {
        setErro(mensagemErro(ev.error));
        setGrupos([]);
        return;
      }
      const parcelas = new Map((pa.data ?? []).map((p: { id: string; numero: number; tipo: string; valor: number; vencimento: string }) => [p.id, p]));
      const formas = new Map((fo.data ?? []).map((f: { id: string; nome: string }) => [f.id, f.nome]));
      const prazos = new Map((pr.data ?? []).map((p: { id: string; nome: string }) => [p.id, p.nome]));
      const pessoa = (id: string) => pessoas.find((p) => p.id === id)?.nome ?? 'pessoa removida';
      const usuario = (id: string | null) => (id ? usuarios.find((u) => u.id === id)?.nome ?? 'usuário' : 'Sistema');
      const dataBr = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');
      const dataHoraBr = (d: string) => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      const quandoCurto = (d: string) => {
        const x = new Date(d);
        return `${x.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })} ${x.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      };

      function valor(campo: string, v: string | null): string {
        if (v === null || v === '') return '—';
        if (campo === 'status_compromisso') return COMPROMISSO[v as keyof typeof COMPROMISSO]?.rotulo ?? v;
        if (campo === 'status_pagamento') return PAGAMENTO[v as keyof typeof PAGAMENTO] ?? v;
        if (campo === 'locatario_id' || campo === 'locador_id') return pessoa(v);
        if (campo === 'responsavel_id') return usuario(v);
        if (campo === 'forma_pagamento_id') return formas.get(v) ?? 'forma removida';
        if (campo === 'prazo_id') return prazos.get(v) ?? 'prazo removido';
        if (campo === 'comprovante_id') return 'anexado';
        if (campo === 'tipo') return v === 'entrada' ? 'Entrada' : v === 'parcela' ? 'Parcela' : TIPO_PESSOA[v as keyof typeof TIPO_PESSOA] ?? v;
        if (v === 'true') return 'Sim';
        if (v === 'false') return 'Não';
        if (MOEDA.has(campo)) return reais(Number(v));
        if (DATA_HORA.has(campo)) return dataHoraBr(v);
        if (DATA.has(campo)) return dataBr(v);
        return v.length > 120 ? `${v.slice(0, 120)}…` : v;
      }

      function nomeRegistro(e: Evento): string {
        if (e.tabela === 'parcelas' && e.registro_id) {
          const p = parcelas.get(e.registro_id);
          if (p) return p.tipo === 'entrada' ? 'Entrada' : `Parcela ${p.numero}`;
        }
        return TABELA[e.tabela] ?? e.tabela;
      }

      // Uma linha por evento; eventos da mesma gravação (mesma hora, pessoa e registro) ficam juntos.
      const lista: Grupo[] = [];
      for (const e of (ev.data ?? []) as Evento[]) {
        if (e.campo && OCULTOS.has(e.campo)) continue;
        const chave = `${e.data_hora}|${e.usuario_id}|${e.tabela}|${e.registro_id}|${e.acao}`;
        let g = lista.find((x) => x.chave === chave);
        if (!g) {
          let titulo = `${ACAO[e.acao] ?? e.acao} ${e.tabela === 'locacoes' ? 'a reserva' : nomeRegistro(e).toLowerCase()}`;
          if (e.acao === 'criou' && e.tabela === 'parcelas' && e.registro_id && parcelas.get(e.registro_id)) {
            const p = parcelas.get(e.registro_id)!;
            titulo += ` (${reais(Number(p.valor))}, vence ${dataBr(p.vencimento)})`;
          }
          g = { chave, quando: quandoCurto(e.data_hora), quem: usuario(e.usuario_id), titulo, linhas: [] };
          lista.push(g);
        }
        if (e.acao === 'alterou' && e.campo) {
          g.linhas.push(`${CAMPO[e.campo] ?? e.campo} ${valor(e.campo, e.valor_anterior)} → ${valor(e.campo, e.valor_novo)}`);
        }
      }
      setGrupos(lista.filter((g) => g.linhas.length > 0 || !g.titulo.startsWith('alterou')));
    })();
  }, [locacaoId, pessoas, usuarios]);

  return createPortal(
    <>
      <div className="scrim alto" onClick={onFechar} />
      <div className="modal alto historico" role="dialog" aria-modal="true" aria-label="Histórico da reserva">
        <div className="m-head">
          <h2>Histórico da reserva</h2>
          <button type="button" className="ib" onClick={onFechar} aria-label="Fechar">
            <Icone nome="x" />
          </button>
        </div>
        <div className="m-body">
          <p className="note">Registro permanente: ninguém altera nem apaga o histórico, nem o administrador.</p>
          {erro && (
            <p className="msg-erro" role="alert">
              {erro}
            </p>
          )}
          {!grupos ? (
            <p className="note">Carregando…</p>
          ) : grupos.length === 0 ? (
            <p className="vazio">Nenhum evento registrado.</p>
          ) : (
            <ol className="eventos">
              {grupos.map((g) => (
                <li key={g.chave}>
                  <span className="ev-quando">{g.quando}</span>
                  <span className="ev-quem">{g.quem}</span>
                  <span className="ev-tx">
                    {g.titulo}
                    {g.linhas.length > 0 && <span className="ev-campos">: {g.linhas.join(' · ')}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
