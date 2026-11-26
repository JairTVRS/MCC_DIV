-- =====================================================================
-- v1.2.1 - Cor da reserva de um dia no Mês e prévia do link no WhatsApp
-- Rode depois da 022: SQL Editor > New query > colar > Run.
-- Só registra a versão no painel de Novidades (não muda o banco).
-- =====================================================================

insert into public.versoes_app (numero, data_publicacao, itens) values
  ('v1.2.1', '2026-11-25', array[
    'Agenda, visão Mês: reserva que começa e termina no mesmo dia agora aparece com a cor do status (antes saía sem cor)',
    'Link do app enviado no WhatsApp mostra a prévia com o logo, o título e a descrição'
  ])
on conflict (numero) do nothing;
