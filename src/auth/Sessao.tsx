import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { mensagemErro } from '../lib/erros';
import { supabase, supabaseConfigurado } from '../lib/supabase';
import { aplicarTema } from '../lib/tema';
import type { CodigoFuncao, Configuracoes, Usuario } from '../lib/tipos';

interface SessaoCtx {
  carregando: boolean;
  erro: string | null;
  sessao: Session | null;
  usuario: Usuario | null;
  config: Configuracoes | null;
  /** O grupo do usuário tem esta função da árvore de permissões (ex.: 'reservas.visualizar'). */
  tem: (funcao: CodigoFuncao) => boolean;
  /** Relê as permissões do grupo (depois de editar a árvore do próprio grupo). */
  recarregarPermissoes: () => Promise<void>;
  entrarComGoogle: () => Promise<void>;
  sair: () => Promise<void>;
  recarregarUsuario: () => Promise<void>;
  recarregarConfig: () => Promise<void>;
  /** Grava campos do próprio cadastro. Devolve a mensagem de erro, ou null se deu certo. */
  atualizarUsuario: (campos: CamposProprios) => Promise<string | null>;
}

type CamposProprios = Partial<Pick<Usuario, 'tema_preferido' | 'ultima_versao_vista' | 'foto_upload' | 'usar_foto_upload'>>;

const Ctx = createContext<SessaoCtx | null>(null);

const COLUNAS_USUARIO =
  'id, nome, email, status_acesso, perfil_id, foto_google, foto_upload, usar_foto_upload, tema_preferido, ultima_versao_vista, motivo_recusa';

/** Lê um erro devolvido pelo Google/Supabase na URL depois do redirecionamento. */
function erroDaUrl(): string | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, '') + '&' + window.location.search.replace(/^\?/, ''));
  const desc = params.get('error_description');
  if (!desc) return null;
  window.history.replaceState(null, '', window.location.pathname);
  return decodeURIComponent(desc.replace(/\+/g, ' '));
}

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(() => erroDaUrl());
  const [sessao, setSessao] = useState<Session | null>(null);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [config, setConfig] = useState<Configuracoes | null>(null);
  const [funcoes, setFuncoes] = useState<Set<string>>(new Set());
  const tentativaRegistrada = useRef(false);

  const carregarFuncoes = useCallback(async (perfilId: string | null) => {
    if (!perfilId) {
      setFuncoes(new Set());
      return;
    }
    const { data, error } = await supabase.from('grupo_funcoes').select('funcao').eq('perfil_id', perfilId);
    if (error) console.error('[Agenda] Permissões:', error.message);
    setFuncoes(new Set((data ?? []).map((f: { funcao: string }) => f.funcao)));
  }, []);

  const carregarConfig = useCallback(async () => {
    const { data, error } = await supabase.from('configuracoes').select('nome_app, logo_claro, logo_escuro, favicon, favicon_proprio').eq('id', 1).maybeSingle();
    if (error) console.error('[Agenda] Configurações:', error.message);
    if (data) setConfig(data as Configuracoes);
  }, []);

  const carregarUsuario = useCallback(async (s: Session | null) => {
    if (!s) {
      setUsuario(null);
      setFuncoes(new Set());
      return;
    }
    const { data, error } = await supabase.from('usuarios').select(COLUNAS_USUARIO).eq('id', s.user.id).maybeSingle();
    if (error || !data) {
      if (error) console.error('[Agenda] Usuário:', error.message);
      setErro(error ? `Erro ao ler seu cadastro: ${error.message}` : 'Não encontramos seu cadastro no banco. Confira se a migração do Supabase foi executada.');
      setUsuario(null);
      return;
    }
    const u = data as Usuario;
    setUsuario(u);
    if (u.tema_preferido !== 'sistema') aplicarTema(u.tema_preferido);

    await carregarFuncoes(u.status_acesso === 'ativo' ? u.perfil_id : null);

    // Quem foi recusado e tenta entrar de novo gera um novo alerta para o administrador.
    if (u.status_acesso === 'recusado' && !tentativaRegistrada.current) {
      tentativaRegistrada.current = true;
      await supabase.rpc('registrar_tentativa_acesso');
    }
  }, [carregarFuncoes]);

  useEffect(() => {
    if (!supabaseConfigurado) {
      setErro('As variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não foram configuradas.');
      setCarregando(false);
      return;
    }
    let ativo = true;
    // Se algo travar ou der erro, a tela de entrada aparece com a mensagem, em vez de ficar carregando para sempre.
    const limite = window.setTimeout(() => {
      if (!ativo) return;
      setErro('O servidor demorou para responder. Recarregue a página; se continuar, confira a conexão com o Supabase.');
      setCarregando(false);
    }, 15000);
    (async () => {
      try {
        await carregarConfig();
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!ativo) return;
        setSessao(data.session);
        await carregarUsuario(data.session);
      } catch (e) {
        console.error('[Agenda] Falha ao iniciar:', e);
        if (ativo) setErro(`Não foi possível conectar ao servidor: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        window.clearTimeout(limite);
        if (ativo) setCarregando(false);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((evento, s) => {
      setSessao(s);
      if (evento === 'SIGNED_IN' || evento === 'SIGNED_OUT' || evento === 'USER_UPDATED') {
        // Fora do callback, como recomenda o Supabase, para não travar a sessão.
        setTimeout(() => void carregarUsuario(s), 0);
      }
    });
    return () => {
      ativo = false;
      window.clearTimeout(limite);
      sub.subscription.unsubscribe();
    };
  }, [carregarConfig, carregarUsuario]);

  // Nome do app na aba do navegador e logo como ícone da aba.
  useEffect(() => {
    document.title = config?.nome_app || 'Agenda';
    const link = document.getElementById('favicon') as HTMLLinkElement | null;
    if (!link) return;
    const href = config?.favicon || config?.logo_claro || config?.logo_escuro || '/favicon.svg';
    link.href = href;
    if (/\.svg($|\?)/.test(href)) link.type = 'image/svg+xml';
    else link.removeAttribute('type');
  }, [config]);

  const tem = useCallback((funcao: CodigoFuncao) => funcoes.has(funcao), [funcoes]);
  const recarregarPermissoes = useCallback(async () => {
    await carregarFuncoes(usuario?.status_acesso === 'ativo' ? usuario.perfil_id : null);
  }, [carregarFuncoes, usuario?.status_acesso, usuario?.perfil_id]);

  const entrarComGoogle = useCallback(async () => {
    setErro(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
    });
    if (error) setErro('Não foi possível abrir o login do Google. Tente de novo em instantes.');
  }, []);

  // O signOut do Supabase espera uma trava de sessão dividida entre as abas do mesmo endereço:
  // se outra aba estiver presa, ele não volta nunca. Espera no máximo 3 s, limpa a sessão
  // guardada no navegador e recarrega, para a saída sempre funcionar.
  const sair = useCallback(async () => {
    tentativaRegistrada.current = false;
    try {
      await Promise.race([supabase.auth.signOut(), new Promise((r) => window.setTimeout(r, 3000))]);
    } catch (e) {
      console.warn('[Agenda] Sair:', e);
    }
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('sb-') && k.includes('auth-token')) localStorage.removeItem(k);
    } catch {
      /* armazenamento indisponível */
    }
    window.location.replace(`${window.location.origin}/`);
  }, []);

  const recarregarUsuario = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await carregarUsuario(data.session);
  }, [carregarUsuario]);

  const atualizarUsuario = useCallback<SessaoCtx['atualizarUsuario']>(
    async (campos) => {
      if (!usuario) return 'Sessão encerrada. Entre de novo.';
      const anterior = usuario;
      setUsuario({ ...usuario, ...campos });
      const { error } = await supabase.from('usuarios').update(campos).eq('id', usuario.id);
      if (error) {
        setUsuario(anterior);
        return mensagemErro(error);
      }
      return null;
    },
    [usuario],
  );

  const valor = useMemo<SessaoCtx>(
    () => ({
      carregando, erro, sessao, usuario, config, tem, recarregarPermissoes, entrarComGoogle, sair, recarregarUsuario,
      recarregarConfig: carregarConfig, atualizarUsuario,
    }),
    [carregando, erro, sessao, usuario, config, tem, recarregarPermissoes, entrarComGoogle, sair, recarregarUsuario, carregarConfig, atualizarUsuario],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useSessao() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSessao precisa estar dentro de SessaoProvider');
  return v;
}
