-- =====================================================================
-- v1.1.1 - Formulário da pessoa mais largo
-- Rode depois da 019: SQL Editor > New query > colar > Run.
-- Só registra a versão no painel de Novidades (não muda o banco).
-- =====================================================================

insert into public.versoes_app (numero, data_publicacao, itens) values
  ('v1.1.1', '2026-11-16', array[
    'Formulário da pessoa mais largo e centralizado na área da página: o cadastro rápido de Movimento e Paróquia fica com espaço para digitar'
  ])
on conflict (numero) do nothing;
