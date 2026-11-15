import { useCallback, useEffect, useState } from 'react';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import type { ItemLixeira, TabelaLixeira } from '../../lib/tipos';

const TIPOS: Record<TabelaLixeira, string> = {
  locacoes: 'Reserva',
  parcelas: 'Parcela',
  anexos: 'Anexo',
  comentarios: 'Comentário',
  pessoas: 'Pessoa',
};
const PLURAL: Record<TabelaLixeira, string> = {
  locacoes: 'Reservas',
  parcelas: 'Parcelas',
  anexos: 'Anexos',
  comentarios: 'Comentários',
  pessoas: 'Pessoas',
};

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function quando(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Tudo que foi excluído no app, com quem excluiu, quando e o botão Restaurar. */
export function Lixeira() {
  const [itens, setItens] = useState<ItemLixeira[] | null>(null);
  const [filtro, setFiltro] = useState<'todos' | TabelaLixeira>('todos');
  const [restaurando, setRestaurando] = useState<string | null>(null);
  const [erro, setErro] = useState<{ id: string | null; msg: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('listar_lixeira');
    if (error) {
      setErro({ id: null, msg: mensagemErro(error) });
      setItens([]);
      return;
    }
    setItens((data ?? []) as ItemLixeira[]);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function restaurar(item: ItemLixeira) {
    setRestaurando(item.id);
    setErro(null);
    setAviso(null);
    const { error } = await supabase.rpc('restaurar_registro', { p_tabela: item.tabela, p_id: item.id });
    if (error) setErro({ id: item.id, msg: mensagemErro(error) });
    else {
      const feminino = item.tabela === 'locacoes' || item.tabela === 'parcelas' || item.tabela === 'pessoas';
      setAviso(`${TIPOS[item.tabela]} restaurad${feminino ? 'a' : 'o'}: ${item.descricao}`);
      await carregar();
    }
    setRestaurando(null);
  }

  if (!itens) return <p className="note">Carregando…</p>;

  const contagem = itens.reduce<Partial<Record<TabelaLixeira, number>>>((acc, i) => ({ ...acc, [i.tabela]: (acc[i.tabela] ?? 0) + 1 }), {});
  // Se o último item de um tipo foi restaurado, o filtro volta para "Todos".
  const filtroAtivo = filtro !== 'todos' && !contagem[filtro] ? 'todos' : filtro;
  const termo = semAcento(busca.trim());
  const visiveis = itens.filter(
    (i) =>
      (filtroAtivo === 'todos' || i.tabela === filtroAtivo) &&
      (!termo || semAcento(`${i.descricao} ${i.detalhe ?? ''} ${i.excluido_por_nome ?? ''}`).includes(termo)),
  );

  return (
    <section className="secao">
      <h3>Lixeira</h3>
      <p className="note">
        Nada é apagado de verdade: o que foi excluído some do app e fica aqui. Itens excluídos junto com uma reserva voltam com ela. Pessoas não vêm para a lixeira: são inativadas na tela Pessoas.
      </p>

      {itens.length > 0 && (
        <div className="filtros">
        <div className="chips" role="group" aria-label="Filtrar por tipo">
          <button className="chip" aria-pressed={filtroAtivo === 'todos'} onClick={() => setFiltro('todos')}>
            Todos · {itens.length}
          </button>
          {(Object.keys(TIPOS) as TabelaLixeira[])
            .filter((t) => contagem[t])
            .map((t) => (
              <button key={t} className="chip" aria-pressed={filtroAtivo === t} onClick={() => setFiltro(t)}>
                {PLURAL[t]} · {contagem[t]}
              </button>
            ))}
        </div>
          <input className="inp busca" type="search" value={busca} placeholder="Buscar pelo nome, reserva ou quem excluiu" aria-label="Buscar na lixeira" onChange={(e) => setBusca(e.target.value)} />
        </div>
      )}

      {aviso && (
        <p className="msg-ok" role="status">
          {aviso}
        </p>
      )}
      {erro && !erro.id && (
        <p className="msg-erro" role="alert">
          {erro.msg}
        </p>
      )}

      {itens.length === 0 ? (
        <p className="vazio">A lixeira está vazia. O que for excluído no app aparece aqui.</p>
      ) : visiveis.length === 0 ? (
        <p className="vazio">Nada encontrado na lixeira com essa busca.</p>
      ) : (
        <ul className="linhas">
          {visiveis.map((i) => (
            <li key={`${i.tabela}-${i.id}`} className="linha lixo">
              <span className="tag">{TIPOS[i.tabela]}</span>
              <div className="tx">
                <strong>{i.descricao}</strong>
                {i.detalhe && <span>{i.detalhe}</span>}
                <span>
                  Excluído por {i.excluido_por_nome ?? 'sistema'} em {quando(i.excluido_em)}
                </span>
                {erro?.id === i.id && (
                  <span className="msg-erro" role="alert">
                    {erro.msg}
                  </span>
                )}
              </div>
              <button className="btn peq" onClick={() => void restaurar(i)} disabled={restaurando !== null}>
                <Icone nome="restore" tamanho={16} />
                {restaurando === i.id ? 'Restaurando…' : 'Restaurar'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
