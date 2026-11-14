import { useEffect, useRef, useState } from 'react';
import { useSessao } from '../../auth/Sessao';
import { DOIS_MB, carimbo, enviarArquivo, extensao, gerarFavicon, removerArquivos, validarImagem } from '../../lib/arquivos';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';

const TIPOS_LOGO = ['image/png', 'image/svg+xml', 'image/webp'];

type Lado = 'claro' | 'escuro';

interface Logo {
  atual: string | null; // o que está salvo no banco
  novo: File | null; // escolhido agora, ainda não enviado
  previa: string | null; // endereço local do arquivo novo, para a prévia
  removido: boolean;
}

const vazio = (atual: string | null): Logo => ({ atual, novo: null, previa: null, removido: false });
const exibida = (l: Logo) => l.previa ?? (l.removido ? null : l.atual);

/** Nome e logo do app. O ícone da aba é gerado a partir do logo ao salvar. */
export function Geral({ podeAlterar }: { podeAlterar: boolean }) {
  const { config, recarregarConfig } = useSessao();
  const [nome, setNome] = useState(config?.nome_app ?? '');
  const [logos, setLogos] = useState<Record<Lado, Logo>>({ claro: vazio(config?.logo_claro ?? null), escuro: vazio(config?.logo_escuro ?? null) });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const previas = useRef<string[]>([]);

  useEffect(() => () => previas.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const sujo = nome.trim() !== (config?.nome_app ?? '') || (['claro', 'escuro'] as Lado[]).some((l) => logos[l].novo || logos[l].removido);

  function escolher(lado: Lado, arquivo: File | undefined) {
    if (!arquivo) return;
    const problema = validarImagem(arquivo, TIPOS_LOGO, DOIS_MB);
    if (problema) {
      setErro(problema);
      return;
    }
    setErro(null);
    setOk(null);
    const previa = URL.createObjectURL(arquivo);
    previas.current.push(previa);
    setLogos((ls) => ({ ...ls, [lado]: { ...ls[lado], novo: arquivo, previa, removido: false } }));
  }

  function remover(lado: Lado) {
    setOk(null);
    setLogos((ls) => ({ ...ls, [lado]: { ...ls[lado], novo: null, previa: null, removido: true } }));
  }

  function descartar() {
    setNome(config?.nome_app ?? '');
    setLogos({ claro: vazio(config?.logo_claro ?? null), escuro: vazio(config?.logo_escuro ?? null) });
    setErro(null);
    setOk(null);
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    setOk(null);
    const enviados: string[] = [];
    try {
      const urlFinal = async (lado: Lado): Promise<string | null> => {
        const l = logos[lado];
        if (l.novo) {
          const url = await enviarArquivo('marca', `logo-${lado}-${carimbo()}.${extensao(l.novo.type)}`, l.novo, l.novo.type);
          enviados.push(url);
          return url;
        }
        return l.removido ? null : l.atual;
      };
      const claro = await urlFinal('claro');
      const escuro = await urlFinal('escuro');

      // Ícone da aba: refeito quando muda o logo de origem (de preferência a versão clara).
      const origem = claro ?? escuro;
      const origemAntes = config?.logo_claro ?? config?.logo_escuro ?? null;
      let favicon = config?.favicon ?? null;
      if (!origem) favicon = null;
      else if (origem !== origemAntes || !favicon) {
        const fonteLocal = claro ? logos.claro.previa : logos.escuro.previa;
        try {
          const png = await gerarFavicon(fonteLocal ?? origem);
          favicon = await enviarArquivo('marca', `favicon-${carimbo()}.png`, png, 'image/png');
          enviados.push(favicon);
        } catch (e) {
          console.warn('[Agenda] Ícone da aba não gerado; o logo será usado direto.', e);
          favicon = null;
        }
      }

      const { data, error } = await supabase
        .from('configuracoes')
        .update({ nome_app: nome.trim() || null, logo_claro: claro, logo_escuro: escuro, favicon })
        .eq('id', 1)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Seu perfil não pode alterar as configurações.');

      const emUso = [claro, escuro, favicon];
      await removerArquivos('marca', [config?.logo_claro, config?.logo_escuro, config?.favicon].filter((u) => u && !emUso.includes(u)));
      await recarregarConfig();
      setLogos({ claro: vazio(claro), escuro: vazio(escuro) });
      setNome(nome.trim());
      setOk('Configurações salvas.');
    } catch (e) {
      await removerArquivos('marca', enviados);
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  const nomeExibido = nome.trim() || 'Agenda';

  return (
    <div className="secoes">
      <section className="secao">
        <h3>Nome do app</h3>
        <label className="campo">
          <span className="rot">Nome</span>
          <input className="inp" value={nome} maxLength={60} placeholder="Agenda" disabled={!podeAlterar || salvando} onChange={(e) => { setNome(e.target.value); setOk(null); }} />
        </label>
        <p className="note">Aparece na aba do navegador, na tela de entrada e no menu quando não há logo. Em branco, o app se chama "Agenda".</p>
      </section>

      <section className="secao">
        <h3>Logo</h3>
        <div className="logos">
          {(['claro', 'escuro'] as Lado[]).map((lado) => {
            const url = exibida(logos[lado]);
            return (
              <div className="logo-caixa" key={lado}>
                <span className="rot">{lado === 'claro' ? 'Para fundo claro' : 'Para fundo escuro'}</span>
                <div className={`previa ${lado}`}>{url ? <img src={url} alt={`Logo para fundo ${lado}`} /> : <span className="nm">{nomeExibido}</span>}</div>
                {podeAlterar && (
                  <div className="acoes">
                    <label className={`btn peq${salvando ? ' desab' : ''}`}>
                      <Icone nome="upload" tamanho={16} />
                      {url ? 'Trocar' : 'Enviar imagem'}
                      <input
                        type="file"
                        accept={TIPOS_LOGO.join(',')}
                        hidden
                        disabled={salvando}
                        onChange={(e) => {
                          escolher(lado, e.target.files?.[0]);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {url && (
                      <button className="btn peq" onClick={() => remover(lado)} disabled={salvando}>
                        <Icone nome="trash" tamanho={16} />
                        Remover
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="note">
          PNG, SVG ou WebP, até 2 MB. O menu lateral é sempre escuro: sem a versão para fundo escuro, ele usa a clara. O ícone da aba do navegador é gerado a partir do logo.
        </p>
      </section>

      {podeAlterar && (
        <div className="barra-salvar">
          {erro && (
            <p className="msg-erro" role="alert">
              {erro}
            </p>
          )}
          {ok && (
            <p className="msg-ok" role="status">
              {ok}
            </p>
          )}
          <span className="sp" />
          <button className="btn" onClick={descartar} disabled={!sujo || salvando}>
            Descartar
          </button>
          <button className="btn pri" onClick={() => void salvar()} disabled={!sujo || salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      )}
    </div>
  );
}
