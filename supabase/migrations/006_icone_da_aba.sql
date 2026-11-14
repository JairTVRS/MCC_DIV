-- =====================================================================
-- v0.2.2 - Ícone da aba enviado à parte
-- Rode depois da 005: SQL Editor > New query > colar > Run.
--
-- favicon_proprio = true: o ícone foi enviado em Configurações e não é refeito ao trocar o logo.
-- favicon_proprio = false: o ícone é gerado a partir do logo (como na v0.2.0).
-- =====================================================================
alter table public.configuracoes
  add column if not exists favicon_proprio boolean not null default false;

insert into public.versoes_app (numero, data_publicacao, itens) values
  ('v0.2.2', '2026-11-13', array[
    'Configurações: ícone da aba do navegador pode ser enviado à parte (imagem quadrada); sem ele, continua gerado a partir do logo'
  ])
on conflict (numero) do nothing;
