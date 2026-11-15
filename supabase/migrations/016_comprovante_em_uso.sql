-- =====================================================================
-- v0.8.0 - Comprovante em uso não vai para a lixeira pela aba Anexos
-- Rode depois da 015: SQL Editor > New query > colar > Run.
--
-- O comprovante ligado a uma parcela paga ou a uma devolução só sai pela aba Pagamento
-- (desfazer o pagamento). Excluir a reserva inteira continua levando tudo junto.
-- =====================================================================

create or replace function public.tg_anexos_comprovante_em_uso()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_de text;
begin
  if new.excluido and not old.excluido and not public.em_operacao_interna() then
    select case when p.tipo = 'entrada' then 'da entrada' else 'da parcela ' || p.numero end into v_de
    from public.parcelas p
    where p.comprovante_id = new.id and not p.excluido
    limit 1;
    if v_de is null and exists (select 1 from public.devolucoes d where d.comprovante_id = new.id) then
      v_de := 'da devolução';
    end if;
    if v_de is not null then
      raise exception 'Este é o comprovante %: para tirá-lo, desfaça o pagamento na aba Pagamento.', v_de;
    end if;
  end if;
  return new;
end $$;

create trigger comprovante_em_uso before update on public.anexos
  for each row execute function public.tg_anexos_comprovante_em_uso();
