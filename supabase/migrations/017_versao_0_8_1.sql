-- =====================================================================
-- v0.8.1 - Correção do "Sair"
-- Rode depois da 016: SQL Editor > New query > colar > Run.
-- Só registra a versão no painel de Novidades (não muda o banco).
-- =====================================================================

insert into public.versoes_app (numero, data_publicacao, itens) values
  ('v0.8.1', '2026-11-15', array[
    '"Sair" sempre funciona, mesmo com outra aba do app travada'
  ])
on conflict (numero) do nothing;
