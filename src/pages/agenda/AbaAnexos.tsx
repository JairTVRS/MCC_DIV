import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useSessao } from '../../auth/Sessao';
import { carimbo } from '../../lib/arquivos';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';
import type { Anexo, CategoriaAnexo, Reserva } from '../../lib/tipos';
import type { UsuarioCurto } from './FormReserva';

// Plano v1.8, item 10: PDF, imagens, Word e Excel, até 20 MB cada (o bucket "anexos" aceita esses tipos).
const TIPOS = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
const LIMITE = 20 * 1024 * 1024;
const COLUNAS = 'id, locacao_id, parcela_id, devolucao_id, nome_arquivo, caminho_storage, categoria, tamanho, enviado_por, enviado_em';

const tamanho = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
const ehImagem = (nome: string) => /\.(png|jpe?g|webp)$/i.test(nome);
const extensao = (nome: string) => (nome.split('.').pop() ?? '').toUpperCase().slice(0, 4);

/** Aba Anexos da reserva: enviar (arrastando ou clicando) com categoria, ver com miniatura, abrir, trocar categoria e excluir. */
export function AbaAnexos({ reserva, usuarios, onMudou }: { reserva: Reserva; usuarios: UsuarioCurto[]; onMudou: () => void }) {
  const { tem } = useSessao();
  const [anexos, setAnexos] = useState<Anexo[] | null>(null);
  const [categorias, setCategorias] = useState<CategoriaAnexo[]>([]);
  const [parcelas, setParcelas] = useState<Map<string, string>>(new Map());
  const [miniaturas, setMiniaturas] = useState<Map<string, string>>(new Map());
  const [categoriaEnvio, setCategoriaEnvio] = useState('');
  const [enviando, setEnviando] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [excluindo, setExcluindo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  const podeIncluir = tem('anexos.incluir');
  const podeAlterar = tem('anexos.alterar');
  const podeExcluir = tem('anexos.excluir');

  const carregar = useCallback(async () => {
    const [a, c, p] = await Promise.all([
      supabase.from('anexos').select(COLUNAS).eq('locacao_id', reserva.id).eq('excluido', false).order('enviado_em', { ascending: false }),
      supabase.from('categorias_anexo').select('id, nome, ativo, ordem, sistema').order('ordem').order('nome'),
      supabase.from('parcelas').select('id, numero, tipo').eq('locacao_id', reserva.id),
    ]);
    if (a.error) setErro(mensagemErro(a.error));
    const lista = (a.data ?? []) as Anexo[];
    setAnexos(lista);
    const cats = (c.data ?? []) as CategoriaAnexo[];
    setCategorias(cats);
    setCategoriaEnvio((atual) => atual || cats.find((x) => x.ativo && !x.sistema)?.nome || '');
    setParcelas(new Map((p.data ?? []).map((x: { id: string; numero: number; tipo: string }) => [x.id, x.tipo === 'entrada' ? 'Entrada' : `Parcela ${x.numero}`])));
    // Miniaturas das imagens: links temporários (o arquivo é privado).
    const imagens = lista.filter((x) => ehImagem(x.nome_arquivo));
    if (imagens.length) {
      const { data } = await supabase.storage.from('anexos').createSignedUrls(imagens.map((x) => x.caminho_storage), 600);
      setMiniaturas(new Map((data ?? []).map((d, i) => [imagens[i].id, d.signedUrl ?? ''])));
    } else setMiniaturas(new Map());
  }, [reserva.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Arquivo solto fora da área não pode abrir no navegador (sairia do app).
  useEffect(() => {
    const barrar = (e: globalThis.DragEvent) => e.preventDefault();
    window.addEventListener('dragover', barrar);
    window.addEventListener('drop', barrar);
    return () => {
      window.removeEventListener('dragover', barrar);
      window.removeEventListener('drop', barrar);
    };
  }, []);

  async function enviar(arquivos: File[]) {
    if (!arquivos.length) return;
    setErro(null);
    const ruins = arquivos.filter((f) => !TIPOS.includes(f.type) || f.size > LIMITE);
    if (ruins.length) {
      setErro(`${ruins.map((f) => f.name).join(', ')}: use PDF, imagem, Word ou Excel de até 20 MB.`);
    }
    for (const f of arquivos.filter((x) => !ruins.includes(x))) {
      setEnviando(f.name);
      try {
        const nomeSeguro = f.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);
        const caminho = `${reserva.id}/${carimbo()}-${nomeSeguro}`;
        const up = await supabase.storage.from('anexos').upload(caminho, f, { contentType: f.type, upsert: false });
        if (up.error) throw up.error;
        const { error } = await supabase.from('anexos').insert({ locacao_id: reserva.id, nome_arquivo: f.name, caminho_storage: caminho, categoria: categoriaEnvio, tamanho: f.size });
        if (error) throw error;
      } catch (e) {
        setErro(`${f.name}: ${mensagemErro(e)}`);
      }
    }
    setEnviando(null);
    await carregar();
    onMudou();
  }

  async function abrir(a: Anexo) {
    const aba = window.open('', '_blank');
    const { data, error } = await supabase.storage.from('anexos').createSignedUrl(a.caminho_storage, 120);
    if (error || !data) {
      aba?.close();
      return setErro(mensagemErro(error));
    }
    if (aba) aba.location.href = data.signedUrl;
    else window.location.href = data.signedUrl;
  }

  async function trocarCategoria(a: Anexo, categoria: string) {
    setErro(null);
    const { error } = await supabase.from('anexos').update({ categoria }).eq('id', a.id);
    if (error) setErro(mensagemErro(error));
    await carregar();
  }

  async function excluir(a: Anexo) {
    setErro(null);
    const { error } = await supabase.rpc('excluir_registro', { p_tabela: 'anexos', p_id: a.id });
    setExcluindo(null);
    if (error) return setErro(mensagemErro(error));
    await carregar();
    onMudou();
  }

  function soltar(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setArrastando(false);
    if (podeIncluir && !enviando) void enviar(Array.from(e.dataTransfer.files));
  }

  if (!anexos) return <p className="note">Carregando…</p>;
  const nomeUsuario = (id: string | null) => usuarios.find((u) => u.id === id)?.nome ?? '—';
  const ativas = categorias.filter((c) => c.ativo);
  const ligacao = (a: Anexo) => (a.parcela_id ? `Comprovante da ${parcelas.get(a.parcela_id)?.toLowerCase() ?? 'parcela'}` : a.devolucao_id ? 'Comprovante da devolução' : null);

  return (
    <div className="anexos">
      {podeIncluir && (
        <div
          className={`soltar${arrastando ? ' ativo' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={soltar}
        >
          <Icone nome="upload" tamanho={22} />
          <div className="soltar-tx">
            <strong>{enviando ? `Enviando ${enviando}…` : 'Arraste os arquivos aqui'}</strong>
            <span>PDF, imagem, Word ou Excel, até 20 MB cada. Pode enviar vários de uma vez.</span>
          </div>
          <label className="campo soltar-cat">
            <span className="rot">Categoria</span>
            <select className="inp" value={categoriaEnvio} onChange={(e) => setCategoriaEnvio(e.target.value)}>
              {ativas.map((c) => (
                <option key={c.id} value={c.nome}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn pri" onClick={() => entrada.current?.click()} disabled={!!enviando || !categoriaEnvio}>
            Escolher arquivos
          </button>
          <input
            ref={entrada}
            type="file"
            multiple
            hidden
            accept={TIPOS.join(',')}
            onChange={(e) => {
              void enviar(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
        </div>
      )}

      {erro && (
        <p className="msg-erro" role="alert">
          {erro}
        </p>
      )}

      {anexos.length === 0 ? (
        <p className="vazio">Nenhum anexo nesta reserva.</p>
      ) : (
        <ul className="lista-anexos">
          {anexos.map((a) => (
            <li key={a.id}>
              <button type="button" className="anexo-mini" onClick={() => void abrir(a)} title="Abrir">
                {miniaturas.get(a.id) ? <img src={miniaturas.get(a.id)} alt="" /> : <span>{extensao(a.nome_arquivo)}</span>}
              </button>
              <div className="anexo-tx">
                <button type="button" className="anexo-nome" onClick={() => void abrir(a)} title={a.nome_arquivo}>
                  {a.nome_arquivo}
                </button>
                <span>
                  {tamanho(a.tamanho)} · {nomeUsuario(a.enviado_por)} · {new Date(a.enviado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  {ligacao(a) ? ` · ${ligacao(a)}` : ''}
                </span>
              </div>
              {podeAlterar && a.categoria !== 'Comprovante' ? (
                <select className="inp anexo-cat" value={a.categoria} aria-label={`Categoria de ${a.nome_arquivo}`} onChange={(e) => void trocarCategoria(a, e.target.value)}>
                  {ativas.filter((c) => !c.sistema || c.nome === a.categoria).map((c) => (
                    <option key={c.id} value={c.nome}>
                      {c.nome}
                    </option>
                  ))}
                  {!ativas.some((c) => c.nome === a.categoria) && <option value={a.categoria}>{a.categoria}</option>}
                </select>
              ) : (
                <span className="tag">{a.categoria}</span>
              )}
              {podeExcluir &&
                (excluindo === a.id ? (
                  <span className="acoes">
                    <button type="button" className="btn peq" onClick={() => setExcluindo(null)}>
                      Voltar
                    </button>
                    <button type="button" className="btn peq perigo" onClick={() => void excluir(a)}>
                      Excluir
                    </button>
                  </span>
                ) : (
                  <button type="button" className="ib" onClick={() => setExcluindo(a.id)} aria-label={`Excluir ${a.nome_arquivo}`} title="Excluir (vai para a lixeira)">
                    <Icone nome="trash" tamanho={16} />
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
