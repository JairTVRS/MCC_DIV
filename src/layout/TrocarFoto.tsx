import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { useSessao } from '../auth/Sessao';
import { canvasParaBlob, carimbo, enviarArquivo, removerArquivos, validarImagem } from '../lib/arquivos';
import { mensagemErro } from '../lib/erros';
import { Icone } from '../lib/icones';
import { Avatar } from './Avatar';

const VISOR = 260; // lado do quadro de recorte na tela, em px
const SAIDA = 256; // lado da foto salva, em px
const TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
// A foto original pode ser maior (fotos de celular): ela é recortada e salva bem menor que 2 MB.
const LIMITE_ORIGINAL = 10 * 1024 * 1024;

interface Ponto {
  x: number;
  y: number;
}

/** Envia uma foto com recorte quadrado (arrastar e zoom) ou volta para a foto do Google. */
export function TrocarFoto({ onFechar }: { onFechar: () => void }) {
  const { usuario, atualizarUsuario } = useSessao();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [desloc, setDesloc] = useState<Ponto>({ x: 0, y: 0 });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const arrasto = useRef<{ inicio: Ponto; base: Ponto } | null>(null);
  const urlLocal = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (urlLocal.current) URL.revokeObjectURL(urlLocal.current);
  }, []);

  if (!usuario) return null;

  // Escala que faz a imagem cobrir o quadro inteiro, vezes o zoom escolhido.
  const escala = img ? (VISOR / Math.min(img.naturalWidth, img.naturalHeight)) * zoom : 1;
  const largura = img ? img.naturalWidth * escala : 0;
  const altura = img ? img.naturalHeight * escala : 0;

  function limitar(p: Ponto, l = largura, a = altura): Ponto {
    const mx = Math.max(0, (l - VISOR) / 2);
    const my = Math.max(0, (a - VISOR) / 2);
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
  }

  function mudarZoom(z: number) {
    if (!img) return;
    const novo = Math.min(4, Math.max(1, z));
    const e = (VISOR / Math.min(img.naturalWidth, img.naturalHeight)) * novo;
    setZoom(novo);
    setDesloc((d) => limitar(d, img.naturalWidth * e, img.naturalHeight * e));
  }

  function escolher(arquivo: File | undefined) {
    if (!arquivo) return;
    const problema = validarImagem(arquivo, TIPOS, LIMITE_ORIGINAL);
    if (problema) {
      setErro(problema);
      return;
    }
    setErro(null);
    if (urlLocal.current) URL.revokeObjectURL(urlLocal.current);
    const url = URL.createObjectURL(arquivo);
    urlLocal.current = url;
    const nova = new Image();
    nova.onload = () => {
      setImg(nova);
      setZoom(1);
      setDesloc({ x: 0, y: 0 });
    };
    nova.onerror = () => setErro('Não foi possível abrir esta imagem.');
    nova.src = url;
  }

  function aoPressionar(e: PointerEvent<HTMLDivElement>) {
    if (!img) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    arrasto.current = { inicio: { x: e.clientX, y: e.clientY }, base: desloc };
  }
  function aoMover(e: PointerEvent<HTMLDivElement>) {
    const a = arrasto.current;
    if (!a) return;
    setDesloc(limitar({ x: a.base.x + e.clientX - a.inicio.x, y: a.base.y + e.clientY - a.inicio.y }));
  }
  function aoSoltar() {
    arrasto.current = null;
  }
  function aoRolar(e: WheelEvent<HTMLDivElement>) {
    if (img) mudarZoom(zoom - e.deltaY * 0.002);
  }
  function aoTeclar(e: KeyboardEvent<HTMLDivElement>) {
    const passo = 10;
    const mov: Record<string, Ponto> = { ArrowLeft: { x: passo, y: 0 }, ArrowRight: { x: -passo, y: 0 }, ArrowUp: { x: 0, y: passo }, ArrowDown: { x: 0, y: -passo } };
    if (mov[e.key]) {
      e.preventDefault();
      setDesloc((d) => limitar({ x: d.x + mov[e.key].x, y: d.y + mov[e.key].y }));
    } else if (e.key === '+' || e.key === '=') mudarZoom(zoom + 0.1);
    else if (e.key === '-') mudarZoom(zoom - 0.1);
  }

  async function salvar() {
    if (!img || !usuario) return;
    setSalvando(true);
    setErro(null);
    let enviada: string | null = null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = SAIDA;
      canvas.height = SAIDA;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Navegador sem suporte a recorte de imagens.');
      // Parte da imagem original que está dentro do quadro.
      const lado = VISOR / escala;
      const sx = (largura / 2 - VISOR / 2 - desloc.x) / escala;
      const sy = (altura / 2 - VISOR / 2 - desloc.y) / escala;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, lado, lado, 0, 0, SAIDA, SAIDA);
      let blob = await canvasParaBlob(canvas, 'image/webp', 0.9);
      if (blob.type !== 'image/webp') blob = await canvasParaBlob(canvas, 'image/jpeg', 0.9); // Safari antigo não gera WebP
      const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
      enviada = await enviarArquivo('avatares', `${usuario.id}/foto-${carimbo()}.${ext}`, blob, blob.type);
      const antiga = usuario.foto_upload;
      const falha = await atualizarUsuario({ foto_upload: enviada, usar_foto_upload: true });
      if (falha) throw new Error(falha);
      if (antiga && antiga !== enviada) await removerArquivos('avatares', [antiga]);
      onFechar();
    } catch (e) {
      if (enviada) await removerArquivos('avatares', [enviada]);
      setErro(mensagemErro(e));
      setSalvando(false);
    }
  }

  async function voltarParaGoogle() {
    if (!usuario) return;
    setSalvando(true);
    setErro(null);
    const antiga = usuario.foto_upload;
    const falha = await atualizarUsuario({ foto_upload: null, usar_foto_upload: false });
    if (falha) {
      setErro(falha);
      setSalvando(false);
      return;
    }
    await removerArquivos('avatares', [antiga]);
    onFechar();
  }

  return (
    <>
      <div className="scrim" onClick={salvando ? undefined : onFechar} />
      <div className="modal estreito" role="dialog" aria-modal="true" aria-label="Trocar foto">
        <div className="m-head">
          <h2>Trocar foto</h2>
          <button className="ib" onClick={onFechar} aria-label="Fechar" disabled={salvando}>
            <Icone nome="x" />
          </button>
        </div>
        <div className="m-body">
          <input
            ref={inputRef}
            type="file"
            accept={TIPOS.join(',')}
            hidden
            onChange={(e) => {
              escolher(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {img ? (
            <>
              <div
                className="recorte"
                tabIndex={0}
                role="img"
                aria-label="Área de recorte. Arraste para posicionar; use as setas do teclado para mover e + ou - para o zoom."
                onPointerDown={aoPressionar}
                onPointerMove={aoMover}
                onPointerUp={aoSoltar}
                onPointerCancel={aoSoltar}
                onWheel={aoRolar}
                onKeyDown={aoTeclar}
              >
                <img
                  src={img.src}
                  alt=""
                  draggable={false}
                  style={{ width: largura, height: altura, transform: `translate(${VISOR / 2 - largura / 2 + desloc.x}px, ${VISOR / 2 - altura / 2 + desloc.y}px)` }}
                />
              </div>
              <label className="campo">
                <span className="rot">Zoom</span>
                <input className="zoom" type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => mudarZoom(Number(e.target.value))} />
              </label>
              <p className="note">Arraste a imagem para enquadrar. A foto é salva quadrada e aparece redonda no app.</p>
            </>
          ) : (
            <div className="perfil-topo">
              <Avatar nome={usuario.nome} foto={usuario.usar_foto_upload && usuario.foto_upload ? usuario.foto_upload : usuario.foto_google} tamanho={96} />
              <p className="note">JPG, PNG ou WebP. Depois de escolher, você ajusta o recorte.</p>
            </div>
          )}
          {erro && (
            <p className="msg-erro" role="alert">
              {erro}
            </p>
          )}
        </div>
        <div className="m-foot">
          {usuario.foto_upload && !img && (
            <button className="btn" onClick={() => void voltarParaGoogle()} disabled={salvando}>
              <Icone nome="restore" tamanho={16} />
              {usuario.foto_google ? 'Voltar para a foto do Google' : 'Remover foto enviada'}
            </button>
          )}
          <span className="sp" />
          <button className="btn" onClick={() => inputRef.current?.click()} disabled={salvando}>
            <Icone nome="upload" tamanho={16} />
            {img ? 'Escolher outra' : 'Escolher imagem'}
          </button>
          {img && (
            <button className="btn pri" onClick={() => void salvar()} disabled={salvando}>
              {salvando ? 'Salvando…' : 'Salvar foto'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
