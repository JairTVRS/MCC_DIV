-- =====================================================================
-- v0.5.0 - Visões semanal e diária da agenda (etapa 5)
-- Só o registro no painel de novidades: o banco não muda nesta versão.
-- SQL Editor > New query > colar > Run.
-- =====================================================================
insert into public.versoes_app (numero, data_publicacao, itens) values
  ('v0.5.0', '2026-11-15', array[
    'Agenda: visões Semana e Dia, com o horário escrito em cada reserva e a cor do status',
    'Agenda: arrastar a reserva muda o dia ou o horário e esticar muda o fim, de 15 em 15 minutos, sempre com confirmação antes de gravar',
    'Agenda: clicar num espaço vazio abre uma reserva nova naquele dia; a lista continua como visão Lista'
  ])
on conflict (numero) do nothing;
