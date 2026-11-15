import { useCallback, useEffect, useMemo, useState } from 'react';
import { mensagemErro } from '../../lib/erros';
import { supabase } from '../../lib/supabase';
import { agrupar, carregarContexto, TIPOS_REGISTRO, type Contexto, type Evento } from './eventos';
import { ListaEventos } from './JanelaHistorico';

const PAGINA = 300;

/** Início do dia (data local "AAAA-MM-DD") em ISO, para filtrar pelo horário de Brasília do aparelho. */
const inicioDia = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const diaSeguinte = (d: string) => {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + 1);
  return x.toISOString();
};

/** Engrenagem > Histórico: tudo que foi feito no app, com filtros e "carregar mais". */
export function HistoricoGeral() {
  const [ctx, setCtx] = useState<Contexto | null>(null);
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  const [acabou, setAcabou] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [quem, setQuem] = useState('');
  const [tipo, setTipo] = useState('');
  const [busca, setBusca] = useState('');
  const [buscaFeita, setBuscaFeita] = useState('');

  // A busca espera a pessoa parar de digitar.
  useEffect(() => {
    const t = window.setTimeout(() => setBuscaFeita(busca.trim()), 400);
    return () => window.clearTimeout(t);
  }, [busca]);

  useEffect(() => {
    void carregarContexto().then(setCtx);
  }, []);

  const filtros = useMemo(
    () => ({
      p_tabelas: tipo ? TIPOS_REGISTRO.find((t) => t.id === tipo)?.tabelas ?? null : null,
      p_usuario: quem || null,
      p_de: de ? inicioDia(de) : null,
      p_ate: ate ? diaSeguinte(ate) : null,
      p_busca: buscaFeita || null,
    }),
    [tipo, quem, de, ate, buscaFeita],
  );

  const buscar = useCallback(
    async (antes: number | null) => {
      setCarregando(true);
      setErro(null);
      const { data, error } = await supabase.rpc('historico', { ...filtros, p_antes: antes, p_limite: PAGINA });
      setCarregando(false);
      if (error) {
        setErro(mensagemErro(error));
        setEventos((ev) => ev ?? []);
        return;
      }
      const novos = (data ?? []) as Evento[];
      setAcabou(novos.length < PAGINA);
      setEventos((ev) => (antes && ev ? [...ev, ...novos] : novos));
    },
    [filtros],
  );

  useEffect(() => {
    void buscar(null);
  }, [buscar]);

  const grupos = useMemo(() => (eventos && ctx ? agrupar(eventos, ctx) : null), [eventos, ctx]);
  const usuarios = useMemo(() => (ctx ? [...ctx.usuarios.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')) : []), [ctx]);
  const filtrando = !!(de || ate || quem || tipo || buscaFeita);

  return (
    <section className="secao">
      <h3>Histórico geral</h3>
      <p className="note">Tudo que foi incluído, alterado, excluído ou restaurado no app. Registro permanente: ninguém altera nem apaga.</p>

      <div className="hist-filtros">
        <label className="campo">
          <span className="rot">De</span>
          <input className="inp" type="date" value={de} max={ate || undefined} onChange={(e) => setDe(e.target.value)} />
        </label>
        <label className="campo">
          <span className="rot">Até</span>
          <input className="inp" type="date" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} />
        </label>
        <label className="campo">
          <span className="rot">Quem fez</span>
          <select className="inp" value={quem} onChange={(e) => setQuem(e.target.value)}>
            <option value="">Todos</option>
            {usuarios.map(([id, nome]) => (
              <option key={id} value={id}>
                {nome}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span className="rot">Tipo</span>
          <select className="inp" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Todos</option>
            {TIPOS_REGISTRO.map((t) => (
              <option key={t.id} value={t.id}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="campo hist-busca">
          <span className="rot">Buscar</span>
          <input className="inp" type="search" value={busca} placeholder="Nome, valor, texto…" onChange={(e) => setBusca(e.target.value)} />
        </label>
        {filtrando && (
          <button
            className="btn peq hist-limpar"
            onClick={() => {
              setDe('');
              setAte('');
              setQuem('');
              setTipo('');
              setBusca('');
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      {erro && (
        <p className="msg-erro" role="alert">
          {erro}
        </p>
      )}
      {!grupos ? (
        <p className="note">Carregando…</p>
      ) : grupos.length === 0 ? (
        <p className="vazio">{filtrando ? 'Nada encontrado com esses filtros.' : 'Nenhum evento registrado.'}</p>
      ) : (
        <>
          <ListaEventos grupos={grupos} comRegistro onAbrirReserva={(id) => (window.location.hash = `agenda?r=${id}`)} />
          {!acabou && (
            <div className="hist-mais">
              <button className="btn" disabled={carregando} onClick={() => eventos && void buscar(eventos[eventos.length - 1].id)}>
                {carregando ? 'Carregando…' : 'Carregar mais'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
