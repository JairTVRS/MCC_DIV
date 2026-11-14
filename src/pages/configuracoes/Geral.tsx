import { useEffect, useRef, useState } from 'react';
import { useSessao } from '../../auth/Sessao';
import { DOIS_MB, carimbo, enviarArquivo, extensao, gerarFavicon, removerArquivos, validarImagem } from '../../lib/arquivos';
import { mensagemErro } from '../../lib/erros';
import { Icone } from '../../lib/icones';
import { supabase } from '../../lib/supabase';

const TIPOS_IMAGEM = ['image/png', 'image/svg+xml', 'image/webp'];

type Lado = 'claro' | 'escuro';
type Campo = Lado | 'icone';

interface Imagem {
  atual: string | null; // o que está salvo no banco
  novo: File | null; // escolhido agora, ainda não enviado
  previa: string | null; // endereço local do arquivo novo, para a prévia
  removido: boolean;
}

const vazio = (atual: string | null): Imagem => ({ atual, novo: null, previa: null, removido: false });
const exibida = (l: Imagem) => l.previa ?? (l.removido ? null : l.atual);

/** Nome, logo e ícone da aba. Sem ícone enviado, ele é gerado a partir do logo ao salvar. */
export function Geral({ podeAlterar }: { podeAlterar: boolean }) {
  const { config, recarregarConfig } = useSessao();
  const inicial = (): Record<Campo, Imagem> => ({
    claro: vazio(config?.logo_claro ?? null),
    escuro: vazio(config?.logo_escuro ?? null),
    icone: vazio(config?.favicon_proprio ? config.favicon : null),
  });
  const [nome, setNome] = useState(config?.nome_app ?? '');
  const [imgs, setImgs] = useState<Record<Campo, Imagem>>(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const previas = useRef<string[]>([]);

  useEffect(() => () => previas.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const sujo = nome.trim() !== (config?.nome_app ?? '') || (['claro', 'escuro', 'icone'] as Campo[]).some((c) => imgs[c].novo || imgs[c].removido);

  function escolher(campo: Campo, arquivo: File | undefined) {
    if (!arquivo) return;
    const problema = validarImagem(arquivo, TIPOS_IMAGEM, DOIS_MB);
    if (problema) {
      setErro(problema);
      return;
    }
    setErro(null);
    setOk(null);
    const previa = URL.createObjectURL(arquivo);
    previas.current.push(previa);
    setImgs((s) => ({ ...s, [campo]: { ...s[campo], novo: arquivo, previa, removido: false } }));
  }

  function remover(campo: Campo) {
    setOk(null);
    setImgs((s) => ({ ...s, [campo]: { ...s[campo], novo: null, previa: null, removido: true } }));
  }

  function descartar() {
    setNome(config?.nome_app ?? '');
    setImgs(inicial());
    setErro(null);
    setOk(null);
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    setOk(null);
    const enviados: string[] = [];
    const enviar = async (caminho: string, arquivo: Blob, tipo: string) => {
      const url = await enviarArquivo('marca', caminho, arquivo, tipo);
      enviados.push(url);
      return url;
    };
    try {
      const urlLogo = async (lado: Lado): Promise<string | null> => {
        const l = imgs[lado];
        if (l.novo) return enviar(`logo-${lado}-${carimbo()}.${extensao(l.novo.type)}`, l.novo, l.novo.type);
        return l.removido ? null : l.atual;
      };
      const claro = await urlLogo('claro');
      const escuro = await urlLogo('escuro');

      let favicon: string | null;
      let proprio: boolean;
      const ic = imgs.icone;
      if (ic.novo) {
        // Ícone enviado: SVG vai como está; PNG/WebP viram um PNG quadrado de 128 px (leve e nítido).
        proprio = true;
        favicon =
          ic.novo.type === 'image/svg+xml'
            ? await enviar(`icone-${carimbo()}.svg`, ic.novo, ic.novo.type)
            : await enviar(`icone-${carimbo()}.png`, await gerarFavicon(ic.previa ?? '', 128), 'image/png');
      } else if (ic.atual && !ic.removido) {
        proprio = true;
        favicon = ic.atual;
      } else {
        // Sem ícone próprio: gerado a partir do logo (de preferência a versão clara), refeito quando o logo muda.
        proprio = false;
        const origem = claro ?? escuro;
        const origemAntes = config?.logo_claro ?? config?.logo_escuro ?? null;
        const geradoAntes = config?.favicon_proprio ? null : config?.favicon ?? null;
        if (!origem) favicon = null;
        else if (origem !== origemAntes || !geradoAntes) {
          const fonteLocal = claro ? imgs.claro.previa : imgs.escuro.previa;
          try {
            favicon = await enviar(`favicon-${carimbo()}.png`, await gerarFavicon(fonteLocal ?? origem), 'image/png');
          } catch (e) {
            console.warn('[Agenda] Ícone da aba não gerado; o logo será usado direto.', e);
            favicon = null;
          }
        } else favicon = geradoAntes;
      }

      const { data, error } = await supabase
        .from('configuracoes')
        .update({ nome_app: nome.trim() || null, logo_claro: claro, logo_escuro: escuro, favicon, favicon_proprio: proprio })
        .eq('id', 1)
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Seu perfil não pode alterar as configurações.');

      const emUso = [claro, escuro, favicon];
      await removerArquivos('marca', [config?.logo_claro, config?.logo_escuro, config?.favicon].filter((u) => u && !emUso.includes(u)));
      await recarregarConfig();
      setImgs({ claro: vazio(claro), escuro: vazio(escuro), icone: vazio(proprio ? favicon : null) });
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

  // Prévia do ícone: o enviado; senão, o logo atual (é dele que o ícone será gerado); senão, o padrão do app.
  const iconeProprio = exibida(imgs.icone);
  const logoBase = exibida(imgs.claro) ?? exibida(imgs.escuro);
  const iconePrevia = iconeProprio ?? (logoBase ? (sujo ? logoBase : config?.favicon ?? logoBase) : '/favicon.svg');
  const iconeOrigem = iconeProprio ? 'Enviado por você' : logoBase ? 'Gerado a partir do logo' : 'Ícone padrão do app';

  function botaoEnviar(campo: Campo, texto: string) {
    return (
      <label className={`btn peq${salvando ? ' desab' : ''}`}>
        <Icone nome="upload" tamanho={16} />
        {texto}
        <input
          type="file"
          accept={TIPOS_IMAGEM.join(',')}
          hidden
          disabled={salvando}
          onChange={(e) => {
            escolher(campo, e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
    );
  }

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
            const url = exibida(imgs[lado]);
            return (
              <div className="logo-caixa" key={lado}>
                <span className="rot">{lado === 'claro' ? 'Para fundo claro' : 'Para fundo escuro'}</span>
                <div className={`previa ${lado}`}>{url ? <img src={url} alt={`Logo para fundo ${lado}`} /> : <span className="nm">{nomeExibido}</span>}</div>
                {podeAlterar && (
                  <div className="acoes">
                    {botaoEnviar(lado, url ? 'Trocar' : 'Enviar imagem')}
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
        <p className="note">PNG, SVG ou WebP, até 2 MB. Para fundo claro, prefira imagem com fundo transparente. O menu lateral é sempre escuro: sem a versão para fundo escuro, ele usa a clara.</p>
      </section>

      <section className="secao">
        <h3>Ícone da aba</h3>
        <div className="icone-linha">
          <div className="aba-falsa" aria-hidden="true">
            <img src={iconePrevia} alt="" />
            <span>{nomeExibido}</span>
          </div>
          <div className="icone-grande">
            <img src={iconePrevia} alt="Prévia do ícone da aba" />
          </div>
          <div className="icone-info">
            <span className="rot">{iconeOrigem}</span>
            {podeAlterar && (
              <div className="acoes">
                {botaoEnviar('icone', iconeProprio ? 'Trocar' : 'Enviar ícone')}
                {iconeProprio && (
                  <button className="btn peq" onClick={() => remover('icone')} disabled={salvando}>
                    <Icone nome="restore" tamanho={16} />
                    Usar o gerado pelo logo
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <p className="note">
          Opcional. Use uma imagem quadrada, como só o símbolo do logo: no tamanho da aba, um logo largo fica ilegível. PNG, SVG ou WebP, até 2 MB. Sem ícone enviado, ele é gerado a partir do logo.
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
