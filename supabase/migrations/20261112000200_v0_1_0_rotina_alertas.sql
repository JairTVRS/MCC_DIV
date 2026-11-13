-- =====================================================================
-- v0.1.0 - Rotina diária dos alertas de vencimento de parcelas
-- Rode depois da migração de estrutura.
-- Se der erro de extensão: Database > Extensions > ative "pg_cron" e rode de novo.
-- =====================================================================
create extension if not exists pg_cron;

-- Todo dia às 07:00 de Brasília (10:00 UTC): avisa 3 dias antes e no dia seguinte ao vencimento.
select cron.schedule(
  'alertas-vencimento',
  '0 10 * * *',
  $$select public.gerar_alertas_vencimento()$$
);
