import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseConfigurado } from '../lib/supabase';
import { aplicarTema } from '../lib/tema';
import type { AcaoSensivel, Configuracoes, Modulo, Permissao, Usuario } from '../lib/tipos';

type AcaoCrud = 'visualizar' | 'incluir' | 'alterar' | 'excluir';

interface SessaoCtx {
  carregando: boolean;
  erro: string | null;
  sessao: Session | null;
  usuario: Usuario | null;
  config: Configuracoes | null;
  pode: (modulo: Modulo, acao: AcaoCrud) => boolean;
  temAcao: (acao: AcaoSensivel) => boolean;
  entrarComGoogle: () => Promise<void>;
  sair: () => Promise<void>;
  recarregarUsuario: () => Promise<void>;
  atualizarUsuario: (campos: Partial<Pick<Usuario, 'tema_preferido' | 'ultima_versao_vista'>>) => Promise<void>;
}

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
  const [permissoes, setPermissoes] = useState<Permissao[]>([]);
  const [acoes, setAcoes] = useState<Set<string>>(new Set());
  const tentativaRegistrada = useRef(false);

  const carregarConfig = useCallback(async () => {
    const { data } = await supabase.from('configuracoes').select('nome_app, logo_claro, logo_escuro, favicon').eq('id', 1).maybeSingle();
    if (data) setConfig(data as Configuracoes);
  }, []);

  const carregarUsuario = useCallback(async (s: Session | null) => {
    if (!s) {
      setUsuario(null);
      setPermissoes([]);
      setAcoes(new Set());
      return;
    }
    const { data, error } = await supabase.from('usuarios').select(COLUNAS_USUARIO).eq('id', s.user.id).maybeSingle();
    if (error || !data) {
      setErro('Não encontramos seu cadastro no banco. Confira se a migração do Supabase foi executada.');
      setUsuario(null);
      return;
    }
    const u = data as Usuario;
    setUsuario(u);
    if (u.tema_preferido !== 'sistema') aplicarTema(u.tema_preferido);

    if (u.status_acesso === 'ativo' && u.perfil_id) {
      const [perm, ac] = await Promise.all([
        supabase.from('permissoes').select('modulo, visualizar, incluir, alterar, excluir').eq('perfil_id', u.perfil_id),
        supabase.from('perfil_acoes').select('acao').eq('perfil_id', u.perfil_id),
      ]);
      setPermissoes((perm.data ?? []) as Permissao[]);
      setAcoes(new Set((ac.data ?? []).map((a: { acao: string }) => a.acao)));
    } else {
      setPermissoes([]);
      setAcoes(new Set());
    }

    // Quem foi recusado e tenta entrar de novo gera um novo alerta para o administrador.
    if (u.status_acesso === 'recusado' && !tentativaRegistrada.current) {
      tentativaRegistrada.current = true;
      await supabase.rpc('registrar_tentativa_acesso');
    }
  }, []);

  useEffect(() => {
    if (!supabaseConfigurado) {
      setErro('As variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não foram configuradas.');
      setCarregando(false);
      return;
    }
    let ativo = true;
    (async () => {
      await carregarConfig();
      const { data } = await supabase.auth.getSession();
      if (!ativo) return;
      setSessao(data.session);
      await carregarUsuario(data.session);
      if (ativo) setCarregando(false);
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
      sub.subscription.unsubscribe();
    };
  }, [carregarConfig, carregarUsuario]);

  // Nome do app na aba do navegador e logo como ícone da aba.
  useEffect(() => {
    document.title = config?.nome_app || 'Agenda';
    const link = document.getElementById('favicon') as HTMLLinkElement | null;
    if (link) link.href = config?.favicon || config?.logo_claro || '/favicon.svg';
  }, [config]);

  const pode = useCallback(
    (modulo: Modulo, acao: AcaoCrud) => permissoes.some((p) => p.modulo === modulo && p[acao]),
    [permissoes],
  );
  const temAcao = useCallback((acao: AcaoSensivel) => acoes.has(acao), [acoes]);

  const entrarComGoogle = useCallback(async () => {
    setErro(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
    });
    if (error) setErro('Não foi possível abrir o login do Google. Tente de novo em instantes.');
  }, []);

  const sair = useCallback(async () => {
    tentativaRegistrada.current = false;
    await supabase.auth.signOut();
  }, []);

  const recarregarUsuario = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    await carregarUsuario(data.session);
  }, [carregarUsuario]);

  const atualizarUsuario = useCallback<SessaoCtx['atualizarUsuario']>(
    async (campos) => {
      if (!usuario) return;
      setUsuario({ ...usuario, ...campos });
      await supabase.from('usuarios').update(campos).eq('id', usuario.id);
    },
    [usuario],
  );

  const valor = useMemo<SessaoCtx>(
    () => ({ carregando, erro, sessao, usuario, config, pode, temAcao, entrarComGoogle, sair, recarregarUsuario, atualizarUsuario }),
    [carregando, erro, sessao, usuario, config, pode, temAcao, entrarComGoogle, sair, recarregarUsuario, atualizarUsuario],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useSessao() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSessao precisa estar dentro de SessaoProvider');
  return v;
}
