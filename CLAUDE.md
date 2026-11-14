# MCC_DIV — Agenda de Locações

Web app de agenda e gestão de locações de uma casa de eventos (alugada inteira por vez). Agenda contínua, sem ano fixo.
Plano de referência: **Plano-Agenda-Locacoes v1.8** (https://claude.ai/artifact/Ndn1UJrD2pnLwrt22Qc5Sg). Protótipo validado: v0.2.0 (https://claude.ai/artifact/LzxjcPXfyoeJoBRRCde5TA).

## Como trabalhar neste projeto

- **Estruturar antes de executar:** apresente o plano/escopo de cada etapa e espere aprovação antes de implementar.
- **Comunicação:** português, direta e informal.
- **Commits:** toda mensagem começa com a versão: `v0.2.0 - Descrição da mudança`.
- **Versão:** semântica. A cada versão publicada, atualizar juntos:
  - `src/version.ts` (`APP_VERSION`) e `version` no `package.json`
  - tabela "Histórico de versões" no `README.md`
  - uma migração `supabase/migrations/NNN_<descricao>.sql` com o `insert` em `versoes_app` (alimenta o painel Novidades)
- **Banco:** toda mudança de esquema vira um arquivo novo em `supabase/migrations/` (nunca editar migração já aplicada). O Jair roda no SQL Editor do Supabase.
- **Nome das migrações:** número sequencial de 3 dígitos + descrição curta em minúsculas com `_` (ex.: `004_configuracoes_lixeira_online.sql`; a próxima é `005_...`). A versão do app vai no cabeçalho do arquivo, não no nome. A ordem dos números é a ordem de execução.
- **Testes do banco:** `npm run test:db` roda as migrações num Postgres em memória (PGlite) e confere as regras. Acrescente testes ao mudar regras.
- **Correções de código:** preferir reescrever o arquivo inteiro a remendos parciais quando entregar ao Jair.
- Nunca colocar no código: e-mails pessoais, Client Secret do Google, chave `service_role`/`secret` do Supabase. O repositório é público. Exceção autorizada: `retiroscasade@gmail.com` como contato da casa na página `/privacidade`.
- **Árvore de acesso (sempre):** toda tela, aba ou ação nova nasce com seu nó na árvore módulo > função (ex.: Agenda > Visualizar, Incluir, Alterar, Excluir; funções sensíveis como filhas do módulo) e checagem no banco (RLS) e na interface. Permissões são dadas a **grupos de usuários**; cada usuário pertence a **um único grupo**. Ao planejar uma etapa, listar os nós que ela cria.
- **Identidade visual:** a paleta e as fontes vieram de um manual de marca externo, usado só como referência. Nunca citar o nome dessa empresa em telas, textos, novidades ou documentos; chamar de "identidade visual do app".
- **Permissões do agente de IA:** seguir a skill `.claude/skills/permissoes-agente/SKILL.md` (push publica no Cloudflare e exige aprovação; sem curingas genéricos).

## Stack e ambiente

- React 18 + Vite 5 + TypeScript, sem roteador (rotas por hash: `#agenda`, `#lista`, `#pessoas`, `#usuarios`, `#configuracoes`).
- Supabase (projeto `rcxijihpzlsozfyxnkhy`): Postgres + RLS, Auth Google, Storage, Realtime, pg_cron.
- Deploy: Cloudflare Pages, projeto `mcc-div` na conta retiroscasade → https://mcc-div.pages.dev. Publicação automática a cada push no `main`.
- Google OAuth: projeto Google Cloud **MCCDIV**, em modo **Teste** (só usuários de teste entram).
- Local: `.env.local` com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (chave publishable). `npm run dev` → http://localhost:5173.

## Regras de negócio já no banco (migração v0.1.0)

- Acesso: login Google aberto; novo usuário entra `pendente`; só `ativo` acessa algo. Primeiro admin vem de `config_privada.admin_email`.
- RBAC: `permissoes` (Visualizar/Incluir/Alterar/Excluir por módulo) + `perfil_acoes` (ações sensíveis). Perfis: Administrador, Gestor, Operador, Consulta.
- Status do compromisso: cadastrado → pre_reserva → reservado; cancelado. Pré-reserva e reservado não podem se sobrepor (constraint de exclusão).
- Status de pagamento calculado pelo banco (pendente, parcial, pago, devolvido, devolvido_parcial).
- Exclusão lógica só por `excluir_registro(tabela, id)` / `restaurar_registro(tabela, id)`; cascata para parcelas, anexos e comentários.
- `log_eventos` imutável, gravado por triggers (campo, valor anterior, novo, quem, quando).
- Alertas de vencimento: `gerar_alertas_vencimento()` agendada no pg_cron, 07:00 de Brasília.
- (v0.2.0) Lixeira: `listar_lixeira()` (só `restaurar_lixeira`); item de reserva excluída só volta com ela; restaurar com conflito de horário dá mensagem com a reserva que ocupa a data.
- (v0.2.0) Nome do usuário só muda com `administrar_usuarios`; `foto_upload` precisa estar em `avatares/<id do usuário>/`; logos só do bucket `marca`; `tema_preferido` e `ultima_versao_vista` não entram no log.
- (v0.2.0/v0.2.1) Usuários online: canal privado de presença `online` no Realtime, com políticas em `realtime.messages` (select e insert, extensões broadcast e presence) só para usuário ativo (migração 005).
- Rotas: o app usa só `#hash`; `/privacidade` é o arquivo estático `public/privacidade.html` (não existe `_redirects`).

## Situação atual

- **v0.2.1** (correção do contador online). **v0.2.0** — Etapa 2 concluída: Configurações (nome/logo com ícone da aba gerado, formas de pagamento, lixeira), Meu perfil e Trocar foto com recorte, contador de usuários online ao lado da versão, página `/privacidade`.
- Telas Agenda, Lista, Pessoas e Usuários ainda são "em construção".

## Próximas etapas (plano v1.8, com os ajustes do Jair)

3. **(próxima)** Acesso: **lista de espera** (quem entra fica pendente; o admin aprova escolhendo o **grupo**), status ativo/inativo, **grupos de usuários** (os perfis atuais viram grupos; um grupo por usuário) e **árvore de permissões** por módulo > função, com catálogo de funções no banco substituindo `permissoes` + `perfil_acoes` (mantendo `tem_permissao`/`tem_acao` para não quebrar as regras). Inclui os nós "Usuários online > Visualizar", "Usuários > Editar dados" e as abas de Configurações.
4. Cadastro de pessoas e da reserva (horário padrão 00:00–23:59; resumo pago/total e % na aba Dados).
5. Visões semanal e diária (sem eixo de horas na lateral) com arrastar e redimensionar.
6. Visão mensal (arrastar entre dias) e lista por dia no celular.
7. Pagamento: condições, rateio de parcelas, devolução no cancelamento.
8. Anexos, comentários com menções @ e sino de notificações (Realtime).
9. Relógios de log (reserva, usuário, geral) e lixeira.
10. Lista/relatório com filtros e exportação.
11. Painel de novidades, testes por perfil, ajustes visuais e publicação.

Pendência fora do código: depois da página `/privacidade`, preencher Branding no Google Cloud (página inicial, política de privacidade, domínio `mcc-div.pages.dev`) e clicar em **Publicar app**.
