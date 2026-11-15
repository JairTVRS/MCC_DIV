-- =====================================================================
-- v0.6.0 - Agenda em calendário: mês, semana, dia e dia por dia no celular (etapas 5 e 6)
-- Só o registro no painel de novidades: o banco não muda nesta versão.
-- SQL Editor > New query > colar > Run.
-- =====================================================================
insert into public.versoes_app (numero, data_publicacao, itens) values
  ('v0.6.0', '2026-11-15', array[
    'Agenda: visões Mês, Semana, Dia e Lista; abre no Mês',
    'Mês: arrastar a reserva para outro dia mantém o horário; "+ mais" quando o dia tem muitas reservas; clicar no número do dia abre a visão Dia',
    'Semana e Dia: horário escrito em cada reserva; arrastar muda dia ou horário e esticar muda o fim, de 15 em 15 minutos',
    'Toda mudança feita arrastando pede confirmação e confere o conflito de horário antes de gravar',
    'Clicar num espaço vazio abre uma reserva nova naquele dia',
    'Celular: agenda dia por dia (semana a semana) e mês; tocar na reserva abre o formulário'
  ])
on conflict (numero) do nothing;
