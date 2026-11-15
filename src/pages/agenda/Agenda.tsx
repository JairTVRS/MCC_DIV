import { useCallback, useEffect, useState } from 'react';
import { useSessao } from '../../auth/Sessao';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import type { Pessoa, Reserva } from '../../lib/tipos';
import { COLUNAS_RESERVA, FormReserva, type UsuarioCurto } from './FormReserva';
import { COMPROMISSO, PAGAMENTO, reais } from './formatos';

type Filtro = 'proximas' | 'anteriores' | 'todas';

/**
 * Agenda provisória (etapa 4): lista das reservas por mês, com a cor do status.
 * As visões de semana, dia e mês com arrastar e soltar chegam nas etapas 5 e 6.
 */
export function Agenda() {
  const { tem } = useSessao();
  const [reservas, setReservas] = useState<Reserva[] | null>(null);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioCurto[]>([]);
  const [filtro, setFiltro] = useState<Filtro>('proximas');
  const [aberta, setAberta] = useState<Reserva | 'nova' | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [r, p, u, g] = await Promise.all([
        supabase.from('locacoes').select(COLUNAS_RESERVA).eq('excluido', false).order('inicio'),
        supabase.from('pessoas').select('id, nome, tipo, telefone, email, documento').eq('excluido', false).order('nome'),
        supabase.from('usuarios').select('id, nome, status_acesso, perfil_id').order('nome'),
        supabase.from('grupo_funcoes').select('perfil_id').eq('funcao', 'reservas.visualizar'),
      ]);
      const falha = r.error ?? p.error ?? u.error ?? g.error;
      if (falha) throw falha;
      const gruposAgenda = new Set((g.data ?? []).map((x: { perfil_id: string }) => x.perfil_id));
      setReservas((r.data ?? []).map((x) => ({ ...(x as Reserva), valor_total: Number((x as Reserva).valor_total) })));
      setPessoas((p.data ?? []) as Pessoa[]);
      setUsuarios(
        (u.data ?? []).map((x: { id: string; nome: string; status_acesso: string; perfil_id: string | null }) => ({
          id: x.id,
          nome: x.nome,
          responsavel: x.status_acesso === 'ativo' && !!x.perfil_id && gruposAgenda.has(x.perfil_id),
        })),
      );
      setErro(null);
    } catch (e) {
      setErro(mensagemErro(e));
      setReservas((r) => r ?? []);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!reservas) return <p className="note">Carregando…</p>;

  const agora = new Date().toISOString();
  const visiveis = reservas
    .filter((r) => (filtro === 'todas' ? true : filtro === 'proximas' ? r.fim >= agora : r.fim < agora))
    .sort((a, b) => (filtro === 'anteriores' ? b.inicio.localeCompare(a.inicio) : a.inicio.localeCompare(b.inicio)));
  const meses = new Map<string, Reserva[]>();
  for (const r of visiveis) {
    const mes = new Date(r.inicio).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    const chave = mes.charAt(0).toUpperCase() + mes.slice(1); // "Novembro de 2026"
    meses.set(chave, [...(meses.get(chave) ?? []), r]);
  }
  const nomePessoa = (id: string) => pessoas.find((p) => p.id === id)?.nome ?? '(pessoa excluída)';
  const nomeUsuario = (id: string) => usuarios.find((u) => u.id === id)?.nome ?? '—';
  const vePagamento = tem('pagamentos.visualizar');

  return (
    <div className="pagina">
      <section className="secao">
        <div className="secao-cab">
          <h3>Reservas</h3>
          {tem('reservas.incluir') && (
            <button className="btn pri" onClick={() => setAberta('nova')}>
              <Icone nome="plus" tamanho={16} />
              Nova reserva
            </button>
          )}
        </div>
        <p className="note">Lista provisória: as visões de mês, semana e dia, com arrastar e soltar, chegam nas próximas etapas.</p>
        <div className="chips" role="group" aria-label="Período">
          {(
            [
              ['proximas', 'Próximas'],
              ['anteriores', 'Anteriores'],
              ['todas', 'Todas'],
            ] as [Filtro, string][]
          ).map(([f, rot]) => (
            <button key={f} className="chip" aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
              {rot}
            </button>
          ))}
        </div>
        {erro && (
          <p className="msg-erro" role="alert">
            {erro}
          </p>
        )}

        {visiveis.length === 0 ? (
          <p className="vazio">{filtro === 'proximas' ? 'Nenhuma reserva pela frente.' : 'Nenhuma reserva aqui.'}</p>
        ) : (
          [...meses.entries()].map(([mes, lista]) => (
            <div key={mes} className="mes">
              <h4 className="mes-titulo">{mes}</h4>
              <ul className="reservas">
                {lista.map((r) => {
                  const ini = new Date(r.inicio);
                  const fim = new Date(r.fim);
                  const hora = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                  const outroDia = ini.toDateString() !== fim.toDateString();
                  return (
                    <li key={r.id}>
                      <button className={`reserva st-${r.status_compromisso}`} onClick={() => setAberta(r)}>
                        <span className="reserva-dia">
                          <strong>{ini.getDate()}</strong>
                          <span>{ini.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}</span>
                        </span>
                        <span className="reserva-tx">
                          <strong className="reserva-nome">{nomePessoa(r.locatario_id)}</strong>
                          <span>
                            {hora(ini)} às {outroDia ? `${fim.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ` : ''}
                            {hora(fim)} · Locador: {nomePessoa(r.locador_id)} · Resp.: {nomeUsuario(r.responsavel_id)}
                          </span>
                        </span>
                        <span className="reserva-lado">
                          <span className={`status-chip st-${r.status_compromisso}`}>{COMPROMISSO[r.status_compromisso].rotulo}</span>
                          {vePagamento && (
                            <span className="reserva-valor">
                              {reais(r.valor_total)} <span className={`selo pg-${r.status_pagamento}`}>{PAGAMENTO[r.status_pagamento]}</span>
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>

      {aberta && (
        <FormReserva
          reserva={aberta === 'nova' ? null : aberta}
          pessoas={pessoas}
          usuarios={usuarios}
          onPessoaNova={(p) => setPessoas((ps) => [...ps, p].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')))}
          onFechar={() => setAberta(null)}
          onMudou={() => void carregar()}
        />
      )}
    </div>
  );
}
