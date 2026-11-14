-- v0.1.1 - Registro da versão no painel de novidades
insert into public.versoes_app (numero, data_publicacao, itens) values
  ('v0.1.1', '2026-11-13', array[
    'Se o servidor demorar ou falhar, a tela de entrada mostra o motivo em vez de ficar carregando'
  ])
on conflict (numero) do nothing;
