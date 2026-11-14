// Simula o ambiente do Supabase (auth.users, auth.uid(), storage) só para teste.
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import fs from 'node:fs';
const db = new PGlite({ extensions: { btree_gist } });
// Roda todas as migrações, em ordem, num Postgres em memória (PGlite) e confere as regras do plano v1.8.
// A migração do pg_cron fica de fora (a extensão não existe no PGlite).
// Uso: npm run test:db
const pasta = new URL('../migrations/', import.meta.url);
const migracoes = fs.readdirSync(pasta).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => ({ f, sql: fs.readFileSync(new URL(f, pasta), 'utf8') }))
  .filter((m) => !/create extension if not exists pg_cron/i.test(m.sql));
await db.exec(`
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name,'/') $$;
grant usage on schema public, auth, storage to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`);
for (const m of migracoes) {
  try { await db.exec(m.sql); } catch (e) { console.error(`ERRO NA MIGRACAO ${m.f}: ${e.message}`); process.exit(1); }
  console.log(`MIGRACAO OK: ${m.f}`);
}
const A='00000000-0000-0000-0000-00000000000a', B='00000000-0000-0000-0000-00000000000b', C='00000000-0000-0000-0000-00000000000c';
let falhas=0;
const ok=(c,m)=>{console.log((c?'  ✓ ':'  ✗ ')+m); if(!c) falhas++;};
const su=async(sql,p)=>{await db.exec('reset role; select set_config(\'request.jwt.claim.sub\',\'\',false);'); return (await db.query(sql,p)).rows;};
const as=async(uid,sql,p)=>{await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false); set role authenticated;`); try{ return (await db.query(sql,p)).rows; } finally { await db.exec('reset role'); }};
const erro=async(fn)=>{try{await fn(); return null;}catch(e){return e.message;}};

await su(`update config_privada set admin_email='Admin@Exemplo.com'`);
await su(`insert into auth.users(id,email,raw_user_meta_data) values ($1,'admin@exemplo.com','{"full_name":"Admin Teste","avatar_url":"http://x/a.png"}')`,[A]);
await su(`insert into auth.users(id,email,raw_user_meta_data) values ($1,'op@exemplo.com','{"name":"Operador Teste"}')`,[B]);
await su(`insert into auth.users(id,email) values ($1,'gestor@exemplo.com')`,[C]);
let u=await su(`select u.id,u.status_acesso,p.nome perfil,u.nome,u.foto_google from usuarios u left join perfis p on p.id=u.perfil_id order by email`);
console.log('1. Primeiro login');
ok(u.find(x=>x.id===A).status_acesso==='ativo'&&u.find(x=>x.id===A).perfil==='Administrador','primeiro administrador entra ativo como Administrador (e-mail sem diferenciar maiúsculas)');
ok(u.find(x=>x.id===B).status_acesso==='pendente','novo usuário entra pendente');
ok(u.find(x=>x.id===A).nome==='Admin Teste'&&u.find(x=>x.id===A).foto_google==='http://x/a.png','nome e foto vêm do Google');
let n=await su(`select * from notificacoes where tipo='pedido_acesso'`);
ok(n.length===2&&n.every(x=>x.usuario_id===A),'admin recebe alerta de pedido de acesso de cada novo usuário');

console.log('2. Acesso pendente');
ok((await as(B,`select * from locacoes`)).length===0,'pendente não lê reservas');
ok((await as(B,`select * from usuarios`)).length===1,'pendente lê só o próprio cadastro');
ok((await as(B,`select nome_app from configuracoes`)).length===1,'configurações (nome/logo) legíveis para a tela de login');
ok(!!await erro(()=>as(B,`update usuarios set status_acesso='ativo' where id='${B}'`)),'pendente não se libera sozinho');

console.log('3. Aprovação, recusa e nova tentativa');
await as(A,`update usuarios set status_acesso='ativo', perfil_id=(select id from perfis where nome='Operador') where id='${B}'`);
u=await su(`select * from usuarios where id=$1`,[B]);
ok(u[0].status_acesso==='ativo'&&u[0].decidido_por===A,'admin aprova com perfil; decidido_por registrado');
ok((await su(`select * from notificacoes where usuario_solicitante_id=$1 and not lida`,[B])).length===0,'alerta do pedido sai como lido após a decisão');
ok(!!await erro(()=>as(A,`update usuarios set status_acesso='ativo' where id='${C}'`)),'não ativa sem perfil');
await as(A,`update usuarios set status_acesso='recusado', motivo_recusa='Não conheço' where id='${C}'`);
await as(C,`select registrar_tentativa_acesso()`);
await as(C,`select registrar_tentativa_acesso()`);
ok((await su(`select * from notificacoes where usuario_solicitante_id=$1 and not lida`,[C])).length===1,'recusado que tenta de novo gera 1 novo alerta (sem repetir enquanto não lido)');
ok(!!await erro(()=>as(A,`update usuarios set status_acesso='inativo' where id='${A}'`)),'admin não altera o próprio acesso');
ok(!!await erro(()=>as(B,`update usuarios set perfil_id=(select id from perfis where nome='Administrador') where id='${B}'`)),'operador não troca o próprio perfil');
await as(B,`update usuarios set tema_preferido='escuro' where id='${B}'`);
ok((await su(`select tema_preferido from usuarios where id=$1`,[B]))[0].tema_preferido==='escuro','usuário salva o próprio tema');
await as(A,`update usuarios set status_acesso='ativo', perfil_id=(select id from perfis where nome='Gestor') where id='${C}'`);

console.log('4. Reservas e conflito');
const [loc1]=await as(A,`insert into pessoas(nome,tipo) values('Mariana','locatario') returning id`);
const [lr]=await as(A,`insert into pessoas(nome,tipo) values('Jair','locador') returning id`);
const [r1]=await as(A,`insert into locacoes(locatario_id,locador_id,inicio,fim,status_compromisso,valor_total) values($1,$2,'2026-11-14 16:00-03','2026-11-15 02:00-03','pre_reserva',6000) returning id, responsavel_id, criado_por, espaco_id`,[loc1.id,lr.id]);
ok(r1.responsavel_id===A&&r1.criado_por===A&&!!r1.espaco_id,'responsável e criado_por = quem cadastrou; espaço padrão preenchido');
let e=await erro(()=>as(A,`insert into locacoes(locatario_id,locador_id,inicio,fim,status_compromisso) values($1,$2,'2026-11-14 20:00-03','2026-11-14 23:00-03','pre_reserva')`,[loc1.id,lr.id]));
ok(!!e&&/sem_conflito|conflicting key/.test(e),'pré-reserva sobreposta é bloqueada');
const [rc]=await as(B,`insert into locacoes(locatario_id,locador_id,inicio,fim) values($1,$2,'2026-11-14 20:00-03','2026-11-14 23:00-03') returning id`,[loc1.id,lr.id]);
ok(!!rc.id,'cadastrado pode dividir a mesma data');
ok(!!await erro(()=>as(B,`update locacoes set status_compromisso='pre_reserva' where id='${rc.id}'`)),'cadastrado não vira pré-reserva se a data estiver ocupada');
ok(!!await erro(()=>as(B,`update locacoes set status_compromisso='reservado' where id='${r1.id}'`)),'operador não confirma reserva');
ok(!!await erro(()=>as(A,`insert into locacoes(locatario_id,locador_id,inicio,fim) values($1,$2,'2026-11-14 20:00-03','2026-11-14 19:00-03')`,[loc1.id,lr.id])),'fim antes do início é recusado');
ok(!!await erro(()=>as(A,`update locacoes set status_pagamento='pago' where id='${r1.id}'`))===false && (await su(`select status_pagamento from locacoes where id=$1`,[r1.id]))[0].status_pagamento==='pendente','status de pagamento não pode ser forçado pelo app');

console.log('5. Pagamento e devolução');
const fp=(await su(`select id from formas_pagamento where nome='Pix'`))[0].id;
await as(A,`insert into parcelas(locacao_id,numero,tipo,valor,vencimento,forma_pagamento_id) values($1,1,'entrada',1800,'2026-11-01',$2),($1,2,'parcela',4200,'2026-12-01',$2)`,[r1.id,fp]);
await erro(()=>as(B,`update parcelas set paga=true where locacao_id='${r1.id}' and numero=1`));
ok((await su(`select paga from parcelas where locacao_id=$1 and numero=1`,[r1.id]))[0].paga===false,'operador não marca parcela como paga');
await as(A,`update parcelas set paga=true where locacao_id='${r1.id}' and numero=1`);
let l=(await su(`select status_pagamento from locacoes where id=$1`,[r1.id]))[0];
ok(l.status_pagamento==='parcial','1 de 2 parcelas paga → Parcial');
ok((await su(`select pago_em from parcelas where locacao_id=$1 and numero=1`,[r1.id]))[0].pago_em!==null,'data do pagamento preenchida');
await as(A,`update locacoes set status_compromisso='reservado' where id='${r1.id}'`);
await as(A,`update locacoes set status_compromisso='cancelado' where id='${r1.id}'`);
ok((await su(`select encerrada from parcelas where locacao_id=$1 and numero=2`,[r1.id]))[0].encerrada===true,'cancelar encerra a parcela em aberto');
ok(!!await erro(()=>as(A,`insert into devolucoes(locacao_id,valor_devolvido) values('${r1.id}',5000)`)),'devolver mais do que recebeu é recusado');
await as(A,`insert into devolucoes(locacao_id,valor_devolvido,forma_pagamento_id,motivo) values('${r1.id}',1300,'${fp}','Retenção contratual')`);
l=(await su(`select l.status_pagamento, d.valor_retido from locacoes l join devolucoes d on d.locacao_id=l.id where l.id=$1`,[r1.id]))[0];
ok(l.status_pagamento==='devolvido_parcial'&&+l.valor_retido===500,'devolução parcial: retido R$ 500 e status Devolvido parcial');

console.log('6. Exclusão lógica, lixeira e cascata');
const [r2]=await as(A,`insert into locacoes(locatario_id,locador_id,inicio,fim,status_compromisso,valor_total) values($1,$2,'2026-11-21 18:00-03','2026-11-21 23:59-03','pre_reserva',3000) returning id`,[loc1.id,lr.id]);
await as(A,`insert into parcelas(locacao_id,numero,valor,vencimento) values($1,1,3000,'2026-11-20')`,[r2.id]);
const [cm]=await as(A,`insert into comentarios(locacao_id,texto) values($1,'Oi @Operador Teste') returning id`,[r2.id]);
await as(A,`insert into comentario_mencoes(comentario_id,usuario_mencionado_id) values($1,$2)`,[cm.id,B]);
ok((await su(`select * from notificacoes where tipo='mencao' and usuario_id=$1`,[B])).length===1,'menção gera alerta no sino de quem foi marcado');
ok(!!await erro(()=>as(B,`select excluir_registro('locacoes','${r2.id}')`)),'operador não exclui reserva');
ok(!!await erro(()=>as(C,`update locacoes set excluido=true where id='${r2.id}'`)),'exclusão direta (sem a função) é bloqueada');
ok(!!await erro(()=>as(A,`delete from locacoes where id='${r2.id}'`)),'exclusão física pelo app é negada');
await as(C,`select excluir_registro('locacoes','${r2.id}')`);
let x=(await su(`select l.excluido_por, (select bool_and(excluido) from parcelas where locacao_id=l.id) p, (select bool_and(excluido) from comentarios where locacao_id=l.id) c from locacoes l where id=$1`,[r2.id]))[0];
ok(x.excluido_por===C&&x.p&&x.c,'gestor exclui: parcelas e comentários saem junto; quem excluiu fica registrado');
ok((await as(B,`select id from locacoes where id='${r2.id}'`)).length===0,'reserva excluída some para quem não tem lixeira');
ok((await as(A,`select id from locacoes where id='${r2.id}'`)).length===1,'administrador vê na lixeira');
ok(!!await erro(()=>as(C,`select restaurar_registro('locacoes','${r2.id}')`)),'gestor não restaura');
await as(A,`select restaurar_registro('locacoes','${r2.id}')`);
x=(await su(`select (select bool_or(excluido) from parcelas where locacao_id=$1) p, (select bool_or(excluido) from comentarios where locacao_id=$1) c`,[r2.id]))[0];
ok(!x.p&&!x.c,'restaurar traz de volta parcelas e comentários');

console.log('7. Log de eventos');
const logs=await su(`select acao,campo,valor_anterior,valor_novo,usuario_id from log_eventos where locacao_id=$1 order by id`,[r1.id]);
ok(logs.some(g=>g.campo==='status_compromisso'&&g.valor_anterior==='pre_reserva'&&g.valor_novo==='reservado'&&g.usuario_id===A),'log guarda campo, valor anterior, novo e quem fez');
ok(logs.some(g=>g.campo==='status_pagamento'&&g.valor_novo==='parcial'),'mudança do status de pagamento também entra no log');
ok((await su(`select * from log_eventos where tabela='usuarios' and campo='status_acesso'`)).length>=3,'aprovações e recusas entram no log de usuários');
ok(!!await erro(()=>as(A,`update log_eventos set acao='x'`)),'log não pode ser alterado pelo app');
ok(!!await erro(()=>su(`delete from log_eventos`)),'log não pode ser apagado nem pelo dono do banco');
ok((await as(B,`select * from log_eventos where tabela='usuarios'`)).length===0,'operador não vê o log de usuários');
ok((await as(B,`select * from log_eventos where locacao_id='${r2.id}'`)).length>0,'operador vê o histórico das reservas');

console.log('8. Alertas de vencimento');
await su(`update parcelas set vencimento=(now() at time zone 'America/Sao_Paulo')::date + 3 where locacao_id=$1`,[r2.id]);
const q1=(await su(`select gerar_alertas_vencimento() q`))[0].q;
const q2=(await su(`select gerar_alertas_vencimento() q`))[0].q;
ok(q1===2&&q2===0,`alerta de vencimento para responsável/admin e gestor, sem duplicar (gerou ${q1}, depois ${q2})`);
ok(!!await erro(()=>as(A,`select gerar_alertas_vencimento()`)),'app não dispara a rotina de alertas');

console.log('9. Notificações');
const [nt]=await as(B,`select id from notificacoes where usuario_id='${B}' limit 1`);
await as(B,`update notificacoes set lida=true where id='${nt.id}'`);
ok((await su(`select lida_em from notificacoes where id=$1`,[nt.id]))[0].lida_em!==null,'marcar como lida registra a hora');
ok(!!await erro(()=>as(B,`update notificacoes set tipo='atraso' where id='${nt.id}'`)),'só dá para marcar como lida');
ok((await as(A,`select * from notificacoes where usuario_id='${B}'`)).length===0,'ninguém lê notificações dos outros');

console.log('10. Usuários: nome, foto e log (v0.2.0)');
ok(!!await erro(()=>as(B,`update usuarios set nome='Outro Nome' where id='${B}'`)),'usuário não altera o próprio nome');
await as(A,`update usuarios set nome='  Operador Renomeado ' where id='${B}'`);
ok((await su(`select nome from usuarios where id=$1`,[B]))[0].nome==='Operador Renomeado','administrador altera o nome (sem espaços nas pontas)');
ok(!!await erro(()=>as(B,`update usuarios set foto_upload='http://outro.site/x.png', usar_foto_upload=true where id='${B}'`)),'foto fora da própria pasta é recusada');
ok(!!await erro(()=>as(B,`update usuarios set foto_upload='https://p.supabase.co/storage/v1/object/public/avatares/${A}/f.webp' where id='${B}'`)),'foto na pasta de outro usuário é recusada');
await as(B,`update usuarios set foto_upload='https://p.supabase.co/storage/v1/object/public/avatares/${B}/f.webp', usar_foto_upload=true where id='${B}'`);
ok((await su(`select usar_foto_upload from usuarios where id=$1`,[B]))[0].usar_foto_upload===true,'usuário troca a própria foto');
await as(B,`update usuarios set foto_upload=null, usar_foto_upload=true where id='${B}'`);
ok((await su(`select usar_foto_upload from usuarios where id=$1`,[B]))[0].usar_foto_upload===false,'sem foto enviada, volta para a foto do Google');
await as(B,`update usuarios set tema_preferido='claro', ultima_versao_vista='v0.2.0' where id='${B}'`);
ok((await su(`select * from log_eventos where tabela='usuarios' and campo in ('tema_preferido','ultima_versao_vista')`)).length===0,'trocar tema e ver novidades não entram no log');
ok((await su(`select * from log_eventos where tabela='usuarios' and campo='foto_upload'`)).length>0,'troca de foto entra no log');

console.log('11. Configurações e formas de pagamento (v0.2.0)');
await as(B,`update configuracoes set nome_app='Hack' where id=1`);
ok((await su(`select nome_app from configuracoes`))[0].nome_app===null,'operador não altera o nome do app');
await as(A,`update configuracoes set nome_app='  Casa de Eventos  ' where id=1`);
ok((await su(`select nome_app from configuracoes`))[0].nome_app==='Casa de Eventos','administrador altera o nome do app (sem espaços nas pontas)');
ok(!!await erro(()=>as(A,`update configuracoes set logo_claro='http://outro.site/logo.png' where id=1`)),'logo fora do bucket "marca" é recusado');
await as(A,`update configuracoes set logo_claro='https://p.supabase.co/storage/v1/object/public/marca/logo.png' where id=1`);
ok((await su(`select logo_claro from configuracoes`))[0].logo_claro.endsWith('/marca/logo.png'),'logo do bucket "marca" é aceito');
ok((await su(`select * from log_eventos where tabela='configuracoes' and campo='nome_app'`)).length===1,'alteração das configurações entra no log');
ok((await su(`select favicon_proprio from configuracoes`))[0].favicon_proprio===false,'ícone da aba começa como gerado pelo logo (v0.2.2)');
await as(A,`update configuracoes set favicon='https://p.supabase.co/storage/v1/object/public/marca/icone-x.png', favicon_proprio=true where id=1`);
ok((await su(`select favicon_proprio from configuracoes`))[0].favicon_proprio===true,'administrador envia ícone da aba próprio');
ok(!!await erro(()=>as(A,`update configuracoes set favicon='http://outro.site/i.png' where id=1`)),'ícone fora do bucket "marca" é recusado');
ok(!!await erro(()=>as(B,`insert into formas_pagamento(nome,ordem) values('Cheque',7)`)),'operador não inclui forma de pagamento');
ok(!!await erro(()=>as(A,`insert into formas_pagamento(nome,ordem) values(' pix ',7)`)),'forma de pagamento repetida (maiúsculas/espaços) é recusada');
ok(!!await erro(()=>as(A,`insert into formas_pagamento(nome,ordem) values('   ',7)`)),'forma de pagamento em branco é recusada');
const [fc]=await as(A,`insert into formas_pagamento(nome,ordem) values('Cheque',7) returning id`);
await as(A,`update formas_pagamento set nome='Cheque pré', ativo=false where id='${fc.id}'`);
ok((await su(`select nome,ativo from formas_pagamento where id=$1`,[fc.id])).every(f=>f.nome==='Cheque pré'&&f.ativo===false),'administrador renomeia e desativa forma de pagamento');
ok(!!await erro(()=>as(A,`delete from formas_pagamento where id='${fc.id}'`)),'forma de pagamento não é apagada (só desativada)');

console.log('12. Lixeira (v0.2.0)');
const [pz]=await as(A,`insert into pessoas(nome,tipo) values('Pessoa Excluída','locatario') returning id`);
await as(A,`select excluir_registro('pessoas','${pz.id}')`);
await as(C,`select excluir_registro('locacoes','${r2.id}')`);
const [p1]=await su(`select id from parcelas where locacao_id=$1 and numero=1`,[r1.id]);
await as(A,`select excluir_registro('parcelas','${p1.id}')`);
ok(!!await erro(()=>as(C,`select * from listar_lixeira()`)),'gestor não vê a lixeira');
ok(!!await erro(()=>as(A,`select * from texto_reserva('${r2.id}')`)),'função interna da lixeira não é chamável pelo app');
let lx=await as(A,`select * from listar_lixeira()`);
const itR2=lx.find(i=>i.id===r2.id);
ok(!!itR2&&/Mariana/.test(itR2.descricao)&&/leva junto 1 parcela, 1 comentário/.test(itR2.detalhe)&&itR2.excluido_por_nome==='gestor','reserva aparece com o que leva junto e quem excluiu');
ok(!lx.some(i=>i.tabela!=='locacoes'&&/21\/11\/2026/.test(i.detalhe)),'parcelas e comentários da reserva excluída não aparecem soltos');
ok(lx.some(i=>i.tabela==='pessoas'&&i.descricao==='Pessoa Excluída'),'pessoa excluída aparece');
ok(lx.some(i=>i.tabela==='parcelas'&&/Parcela 1 · R\$ 1\.800,00/.test(i.descricao)),'parcela excluída sozinha aparece com valor em reais');
const [pr2]=await su(`select id from parcelas where locacao_id=$1`,[r2.id]);
e=await erro(()=>as(A,`select restaurar_registro('parcelas','${pr2.id}')`));
ok(!!e&&/Restaure a reserva primeiro/.test(e),'item de reserva na lixeira só volta junto com a reserva');
await as(A,`insert into locacoes(locatario_id,locador_id,inicio,fim,status_compromisso) values($1,$2,'2026-11-21 20:00-03','2026-11-21 22:00-03','pre_reserva')`,[loc1.id,lr.id]);
e=await erro(()=>as(A,`select restaurar_registro('locacoes','${r2.id}')`));
ok(!!e&&/horário já está ocupado pela reserva de Mariana em 21\/11\/2026 \(20:00 às 22:00\)/.test(e),'restaurar com conflito de horário explica qual reserva ocupa a data');
ok((await su(`select excluido from locacoes where id=$1`,[r2.id]))[0].excluido===true,'reserva com conflito continua na lixeira');
await as(A,`select restaurar_registro('pessoas','${pz.id}')`);
ok((await su(`select excluido from pessoas where id=$1`,[pz.id]))[0].excluido===false,'administrador restaura pessoa');
ok((await su(`select numero from versoes_app where numero in ('v0.2.0','v0.2.1','v0.2.2')`)).length===3,'novidades da v0.2.0, v0.2.1 e v0.2.2 registradas');

console.log(falhas?`\n${falhas} FALHA(S)`:'\nTODOS OS TESTES PASSARAM');
process.exit(falhas?1:0);
