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
  - uma migração `supabase/migrations/AAAAMMDDhhmmss_vX_Y_Z_<assunto>.sql` com o `insert` em `versoes_app` (alimenta o painel Novidades)
- **Banco:** toda mudança de esquema vira um arquivo novo em `supabase/migrations/` (nunca editar migração já aplicada). O Jair roda no SQL Editor do Supabase.
- **Testes do banco:** `npm run test:db` roda as migrações num Postgres em memória (PGlite) e confere as regras. Acrescente testes ao mudar regras.
- **Correções de código:** preferir reescrever o arquivo inteiro a remendos parciais quando entregar ao Jair.
- Nunca colocar no código: e-mails pessoais, Client Secret do Google, chave `service_role`/`secret` do Supabase. O repositório é público.

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

## Situação atual

- **v0.1.1 no ar.** Etapa 1 concluída: estrutura, banco, login Google, tela de espera, menu com versão/novidades/engrenagem, tema claro/escuro.
- Telas Agenda, Lista, Pessoas, Usuários e Configurações ainda são "em construção".

## Próximas etapas (plano v1.8)

2. **(próxima, aguardando aprovação do escopo)** Configurações (nome e logo do app, formas de pagamento, lixeira), avatar com upload de foto, página `/privacidade` para publicar o app no Google.
3. Acesso: tela de aprovação de usuários, status ativo/inativo, perfis e matriz de permissões.
4. Cadastro de pessoas e da reserva (horário padrão 00:00–23:59; resumo pago/total e % na aba Dados).
5. Visões semanal e diária (sem eixo de horas na lateral) com arrastar e redimensionar.
6. Visão mensal (arrastar entre dias) e lista por dia no celular.
7. Pagamento: condições, rateio de parcelas, devolução no cancelamento.
8. Anexos, comentários com menções @ e sino de notificações (Realtime).
9. Relógios de log (reserva, usuário, geral) e lixeira.
10. Lista/relatório com filtros e exportação.
11. Painel de novidades, testes por perfil, ajustes visuais e publicação.

Pendência fora do código: depois da página `/privacidade`, preencher Branding no Google Cloud (página inicial, política de privacidade, domínio `mcc-div.pages.dev`) e clicar em **Publicar app**.
