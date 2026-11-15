-- =====================================================================
-- v0.4.1 - Logo sem fundo e ícone da aba (arquivos publicados com o app)
-- Rode DEPOIS que a v0.4.1 estiver no ar (os arquivos /marca/... precisam existir).
-- SQL Editor > New query > colar > Run.
--
-- As configurações passam a aceitar também imagens publicadas junto com o app
-- (caminho começando por /marca/), além das enviadas pela tela (bucket "marca").
-- Enviar um logo novo pela tela continua funcionando e substitui estes.
-- =====================================================================
create or replace function public.tg_configuracoes_regras()
returns trigger language plpgsql as $$
declare
  v_url text;
begin
  new.nome_app := nullif(trim(new.nome_app), '');
  if length(new.nome_app) > 60 then
    raise exception 'O nome do app pode ter até 60 caracteres.';
  end if;
  foreach v_url in array array[new.logo_claro, new.logo_escuro, new.favicon] loop
    if v_url is not null
       and position('/storage/v1/object/public/marca/' in v_url) = 0
       and v_url !~ '^/marca/[A-Za-z0-9._-]+$' then
      raise exception 'Endereço de imagem inválido.';
    end if;
  end loop;
  return new;
end $$;

update public.configuracoes
set logo_claro = '/marca/logo-claro.png',
    logo_escuro = '/marca/logo-escuro.png',
    favicon = '/marca/icone.png',
    favicon_proprio = true
where id = 1;

insert into public.versoes_app (numero, data_publicacao, itens) values
  ('v0.4.1', '2026-11-15', array[
    'Logo sem fundo no menu e na tela de entrada; ícone da aba com o globo'
  ])
on conflict (numero) do nothing;
