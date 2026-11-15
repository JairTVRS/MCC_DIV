import { useCallback, useEffect, useState } from 'react';
import { useSessao } from '../../auth/Sessao';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import type { Pessoa } from '../../lib/tipos';
import { TIPO_PESSOA, ehLocador, ehLocatario } from '../agenda/formatos';
import { FormPessoa } from './FormPessoa';

type Filtro = 'todos' | 'locatario' | 'locador';
type Situacao = 'ativas' | 'inativas' | 'todas';
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Cadastro de locatários e locadores, com busca, filtro por tipo e por situação (ativas/inativas). */
export function Pessoas() {
  const { tem } = useSessao();
  const [pessoas, setPessoas] = useState<Pessoa[] | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [situacao, setSituacao] = useState<Situacao>('ativas');
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<Pessoa | 'nova' | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('pessoas').select('id, nome, tipo, telefone, email, documento, ativo').eq('excluido', false).order('nome');
    if (error) setErro(mensagemErro(error));
    setPessoas((data ?? []) as Pessoa[]);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!pessoas) return <p className="note">Carregando…</p>;

  const termo = semAcento(busca.trim());
  const naSituacao = pessoas.filter((p) => situacao === 'todas' || (situacao === 'ativas' ? p.ativo : !p.ativo));
  const doTipo = (p: Pessoa, f: Filtro) => f === 'todos' || (f === 'locatario' ? ehLocatario(p.tipo) : ehLocador(p.tipo));
  const qtd = (f: Filtro) => naSituacao.filter((p) => doTipo(p, f)).length;
  const qtdSit = (s: Situacao) => pessoas.filter((p) => s === 'todas' || (s === 'ativas' ? p.ativo : !p.ativo)).length;
  const visiveis = naSituacao.filter((p) => doTipo(p, filtro) && (!termo || semAcento(`${p.nome} ${p.telefone ?? ''} ${p.email ?? ''} ${p.documento ?? ''}`).includes(termo)));

  async function aoSalvar() {
    setAberta(null);
    await carregar();
  }

  return (
    <div className="pagina">
      <section className="secao">
        <div className="secao-cab">
          <h3>Pessoas</h3>
          {tem('pessoas.incluir') && (
            <button className="btn pri" onClick={() => setAberta('nova')}>
              <Icone nome="plus" tamanho={16} />
              Nova pessoa
            </button>
          )}
        </div>
        <div className="filtros">
          <div className="chips" role="group" aria-label="Filtrar por tipo">
            {(['todos', 'locatario', 'locador'] as Filtro[]).map((f) => (
              <button key={f} className="chip" aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
                {f === 'todos' ? 'Todos' : f === 'locatario' ? 'Locatários' : 'Locadores'} · {qtd(f)}
              </button>
            ))}
          </div>
          <div className="chips" role="group" aria-label="Filtrar por situação">
            {(['ativas', 'inativas', 'todas'] as Situacao[]).map((s) => (
              <button key={s} className="chip" aria-pressed={situacao === s} onClick={() => setSituacao(s)}>
                {s === 'ativas' ? 'Ativas' : s === 'inativas' ? 'Inativas' : 'Todas'} · {qtdSit(s)}
              </button>
            ))}
          </div>
          <input className="inp busca" type="search" value={busca} placeholder="Buscar por nome, telefone, e-mail ou documento" aria-label="Buscar pessoa" onChange={(e) => setBusca(e.target.value)} />
        </div>
        {erro && (
          <p className="msg-erro" role="alert">
            {erro}
          </p>
        )}
        {visiveis.length === 0 ? (
          <p className="vazio">{pessoas.length === 0 ? 'Nenhuma pessoa cadastrada ainda.' : 'Nenhuma pessoa encontrada.'}</p>
        ) : (
          <ul className="linhas">
            {visiveis.map((p) => (
              <li key={p.id}>
                <button className={`linha clicavel${p.ativo ? '' : ' inativa'}`} onClick={() => setAberta(p)}>
                  <span className="tx">
                    <strong>{p.nome}</strong>
                    <span>{[p.telefone, p.email].filter(Boolean).join(' · ') || 'Sem contato'}</span>
                  </span>
                  {!p.ativo && <span className="tag">Inativa</span>}
                  <span className="tag">{TIPO_PESSOA[p.tipo]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {aberta && <FormPessoa pessoa={aberta === 'nova' ? null : aberta} onFechar={() => setAberta(null)} onSalvo={() => void aoSalvar()} />}
    </div>
  );
}
