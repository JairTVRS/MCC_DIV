# MCC_DIV — Agenda de Locações

Web app para gerenciar as locações da casa de eventos: agenda contínua, reservas, pagamentos, anexos, comentários, log de auditoria e controle de acesso por perfil. Segue o **Plano Agenda de Locações v1.8**.

- **Front-end:** React + Vite + TypeScript
- **Banco, login e arquivos:** Supabase (Postgres, Auth, Storage, Realtime)
- **Login:** Google, com liberação de acesso pelo administrador
- **Hospedagem:** Cloudflare Pages

## Histórico de versões

| Versão | Data | Descrição |
|---|---|---|
| v1.2.0 | 16/11/2026 | Prazo de pagamento com parcelas "antes do evento" (ex.: 30% entrada + 70% 15 dias antes do evento), vencimento nunca antes da data base (com aviso no plano); arrastar ou mudar a data da reserva move junto os vencimentos "antes do evento" em aberto, com aviso antes de gravar; nome dos prazos troca "antecipado" por "entrada" |
| v1.1.1 | 16/11/2026 | Formulário da pessoa mais largo (até 1200px) e centralizado na área da página, sem contar o menu lateral: o cadastro rápido de Movimento e Paróquia fica com espaço para digitar |
| v1.1.0 | 16/11/2026 | Movimento e Paróquia na pessoa (obrigatórios em cadastro novo, com cadastro rápido no próprio seletor), Configurações > Movimentos e Paróquias, filtros de Movimento e Paróquia na Agenda (do locatário) e colunas e filtros no Relatório |
| v1.0.0 | 15/11/2026 | Etapas 9, 10 e 11: Lista / Relatório (reservas e parcelas com filtros, totais, colunas à escolha e CSV), histórico geral na engrenagem com filtros, relógio de histórico no usuário, no grupo e na pessoa, pessoas inativadas em vez de excluídas, lixeira com busca, pontinho de novidade na versão, testes de permissão por grupo |
| v0.8.1 | 15/11/2026 | "Sair" sempre funciona: não fica preso quando outra aba do app está travada (limpa a sessão e recarrega) |
| v0.8.0 | 15/11/2026 | Etapa 8: aba Anexos da reserva (arrastar ou escolher vários arquivos, categoria, miniatura, abrir, trocar categoria, excluir), categorias de anexo em Configurações, aba Comentários com menções @ (editar o próprio, excluir), sino de notificações em tempo real (menções, pedidos de acesso, parcelas a vencer e vencidas) que abre a reserva na aba certa, clipe e balão com a quantidade no card da agenda |
| v0.7.0 | 15/11/2026 | Etapa 7: prazos de pagamento (nome gerado das parcelas), plano sempre pelo prazo (quantidade do prazo, última parcela fecha o total), registrar pagamento com comprovante e prévia, Reservado automático no 1º pagamento ou com desconto total e volta para Cadastrado sem nada pago, devolução no cancelamento, desconto com motivo. Histórico da reserva (relógio). Agenda com cor por status e filtro de status |
| v0.6.0 | 15/11/2026 | Etapas 5 e 6: agenda em calendário (FullCalendar) com visões Mês (padrão), Semana, Dia e Lista; mês arrasta entre dias mantendo o horário; semana/dia sem eixo de horas, arrastar e esticar em passos de 15 min; confirmação e conferência de conflito antes de gravar; celular com dia por dia e mês |
| v0.4.1 | 15/11/2026 | Logo sem fundo e ícone da aba publicados com o app (`public/marca/`); configurações aceitam também imagens em `/marca/...` |
| v0.4.0 | 15/11/2026 | Etapa 4: cadastro de pessoas (locatário, locador ou os dois) e da reserva (responsável, horário padrão 00:00–23:59, status, valor, resumo pago/total), aviso de conflito antes de salvar, agenda provisória em lista. Atualização do app: aviso "Atualizando app em 5…" no canto e recarga automática quando sai versão nova; Novidades só ao clicar na versão |
| v0.3.0 | 15/11/2026 | Etapa 3: lista de espera com aprovação por grupo, usuários (busca, filtros, ativar/inativar, nome e grupo), grupos de usuários e árvore de permissões por módulo e função |
| v0.2.2 | 13/11/2026 | Ícone da aba do navegador enviado à parte (imagem quadrada); sem ele, continua gerado a partir do logo |
| v0.2.1 | 13/11/2026 | Correção do contador de usuários online (políticas do canal privado); o ícone aparece sempre e mostra quando o canal está indisponível |
| v0.2.0 | 13/11/2026 | Etapa 2: Configurações (nome e logo do app, formas de pagamento, lixeira com restauração), Meu perfil e troca de foto com recorte, contador de usuários online, página de política de privacidade |
| v0.1.1 | 13/11/2026 | Carregamento inicial com tempo limite e mensagem de erro na tela; limpeza de espaços nas chaves do Supabase |
| v0.1.0 | 12/11/2026 | Etapa 1: estrutura do projeto, banco completo com regras e permissões, login com Google, tela de espera de aprovação, menu com versão e novidades, tema claro e escuro |

Toda mensagem de commit começa pela versão: `v0.1.0 - Descrição da mudança`.

---

## Guia de implantação

Faça na ordem. Cada passo depende do anterior.

### 1. Supabase: criar o banco

1. Em [supabase.com](https://supabase.com), abra o projeto (ou crie um novo, região São Paulo).
2. Vá em **SQL Editor > New query**, cole todo o conteúdo de `supabase/migrations/001_estrutura.sql` e clique em **Run**.
3. Vá em **Database > Extensions**, ative **pg_cron** e depois rode, do mesmo jeito, `supabase/migrations/002_rotina_alertas.sql`.
4. Defina o primeiro administrador. No SQL Editor, rode (trocando pelo seu e-mail do Google):

   ```sql
   update public.config_privada set admin_email = 'seu-email@gmail.com';
   ```

   O e-mail fica só no banco, fora do código, porque este repositório é público. Faça isso **antes** do primeiro login.
5. Rode as demais migrações de `supabase/migrations/`, uma por vez e na ordem do número (`003_...`, `004_...` e as que vierem depois). Cada versão nova do app traz a sua.

### 2. Google Cloud: liberar o login

No [Google Cloud Console](https://console.cloud.google.com), projeto **MCCDIV**:

1. **Google Auth Platform > Clientes**, abra o cliente OAuth do tipo *Aplicativo da Web*.
2. Em **URIs de redirecionamento autorizados**, adicione:

   ```
   https://SEU-PROJETO.supabase.co/auth/v1/callback
   ```

   O endereço exato aparece no Supabase em **Authentication > Sign In / Providers > Google** (campo *Callback URL*).
3. **Google Auth Platform > Branding**: preencha
   - **Página inicial do aplicativo:** `https://mcc-div.pages.dev`
   - **Política de privacidade:** `https://mcc-div.pages.dev/privacidade`
   - **Domínios autorizados:** `mcc-div.pages.dev` (e o domínio do Supabase, se o Google pedir)
4. **Google Auth Platform > Público-alvo**: enquanto o app estiver em **Teste**, só os e-mails cadastrados como usuários de teste conseguem entrar. Para qualquer conta Google poder pedir acesso, clique em **Publicar app**. O app usa só nome, e-mail e foto, então normalmente não precisa da verificação do Google.

### 3. Supabase: ligar o Google

1. **Authentication > Sign In / Providers > Google**: ative, cole o **Client ID** e o **Client Secret** do Google e salve.
   O Client Secret fica só no Supabase. Não coloque no código nem mande por chat.
2. **Authentication > URL Configuration**:
   - **Site URL:** o endereço do Cloudflare (passo 4), ex.: `https://mcc-div.pages.dev`
   - **Redirect URLs:** o mesmo endereço e, para testar no computador, `http://localhost:5173`

### 4. Cloudflare Pages: publicar

1. No [Cloudflare](https://dash.cloudflare.com), **Workers & Pages > Create > Pages > Connect to Git** e escolha `JairTVRS/MCC_DIV`.
2. Configuração do build:
   - **Framework preset:** Vite
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
3. **Environment variables** (Production e Preview):

   | Nome | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | Supabase > Project Settings > API > Project URL |
   | `VITE_SUPABASE_ANON_KEY` | Supabase > Project Settings > API > chave `anon` / `publishable` |
   | `NODE_VERSION` | `20` |

   A chave `anon` é pública por natureza: quem protege os dados são as regras do banco (RLS). Nunca use a chave `service_role` aqui.
4. **Save and Deploy**. Depois, volte ao passo 3.2 e confira se a Site URL bate com o endereço gerado.

### 5. Primeiro acesso

1. Abra o endereço do Cloudflare e entre com o Google usando o e-mail do passo 1.4. Você entra direto como Administrador.
2. Qualquer outra pessoa que entrar fica **na lista de espera** e vê a tela de espera. Aprove em **Usuários e Grupos > Lista de espera**, escolhendo o grupo; a tela de espera da pessoa abre o app sozinha em até 10 segundos.
3. Se você entrou antes de fazer o passo 1.4 e ficou pendente, libere a si mesmo pelo SQL Editor:

   ```sql
   update public.usuarios
   set status_acesso = 'ativo', perfil_id = (select id from public.perfis where sistema)
   where email = 'seu-email@gmail.com';
   ```

---

## Desenvolvimento

```bash
cp .env.example .env.local   # preencha com os dados do Supabase
npm install
npm run dev                  # http://localhost:5173
npm run build                # confere tipos e gera a pasta dist
npm run test:db              # roda todas as migrações num Postgres em memória e testa as regras
```

### Como o banco protege os dados

- **Acesso:** só usuário com status `ativo` lê ou grava qualquer coisa. Pendente, recusado e inativo ficam bloqueados no próprio banco.
- **Permissões:** cada usuário pertence a um **grupo** (tabela `perfis`). O que cada grupo pode fazer é uma **árvore** módulo > função (`funcoes`), liberada por grupo (`grupo_funcoes`): ex.: Agenda > Visualizar, Incluir, Alterar, Excluir, Confirmar reserva. O banco confere com `tem_funcao('codigo')`; `tem_permissao(modulo, acao)` e `tem_acao(acao)` continuam valendo e leem a árvore. O grupo Administrador (`perfis.sistema`) tem sempre tudo; só administradores mexem em administradores; ninguém altera o próprio acesso ou grupo.
- **Função nova:** uma migração com `insert into public.funcoes (codigo, pai, tipo, rotulo, ordem)`; ela já nasce liberada para o Administrador e aparece na árvore da tela de Grupos.
- **Conflito de agenda:** o banco recusa pré-reserva ou reservado que se sobreponha a outra pré-reserva ou reservado. Cadastrado pode dividir a data. A tela consulta `conflito_reserva(inicio, fim, ignorar)` antes de salvar para dizer qual reserva ocupa o horário.
- **Pessoas e reserva:** uma pessoa pode ser locatário, locador ou os dois (`tipo = 'ambos'`). Pessoa não é excluída, só inativada (`pessoas.ativo`, função `pessoas.inativar`): inativa não entra em reserva nova, mas as reservas antigas e o histórico continuam. A reserva só aceita locatário/locador do tipo certo e ativo, e responsável ativo que vê a agenda.
- **Exclusão lógica:** nada é apagado. Exclua e restaure pelas funções `excluir_registro(tabela, id)` e `restaurar_registro(tabela, id)`. Excluir uma reserva leva junto parcelas, anexos e comentários; restaurar traz de volta. A lixeira (`listar_lixeira()`) mostra tudo que foi excluído; item de uma reserva excluída só volta junto com ela, e restaurar uma reserva cujo horário já foi ocupado é recusado com a reserva que está no caminho.
- **Usuários:** o nome só muda por quem administra usuários; cada um troca a própria foto, que precisa estar na sua pasta do Storage. Trocar o tema ou ver as novidades não entra no log.
- **Usuários online:** canal de presença privado do Realtime (`online`), aberto só para usuário ativo.
- **Pagamento:** o status (pendente, parcial, pago, devolvido, devolvido parcial) é calculado pelo banco a partir das parcelas e da devolução, sobre o **valor final** (valor − desconto). O plano de parcelas é gravado por `salvar_parcelas(reserva, plano)`, que troca só as em aberto. Qualquer valor pago deixa a reserva **Reservado**; pagamento desfeito sem nada pago volta para **Cadastrado**. Os prazos (`prazos_pagamento`) contam a partir de `locacoes.pre_reserva_em`.
- **Anexos e comentários:** a categoria do anexo precisa existir e estar ativa (`categorias_anexo`; "Comprovante" é do sistema). Menção só a usuário ativo que vê a agenda, e só o autor marca pessoas no próprio comentário; cada menção vira aviso no sino. `contadores_reservas()` dá os números do card e `minhas_notificacoes()` os avisos já com título e detalhe, só os do próprio usuário.
- **Histórico:** `historico(tabelas, registro, usuario, de, ate, busca, antes, limite)` lê o log com filtros e o nome do registro pronto. Geral exige `logs.geral`; de um usuário ou grupo, `logs.usuario`; de uma pessoa, `logs.pessoa`; o da reserva, `logs.reserva`.
- **Log:** toda criação, alteração (campo, valor anterior e novo), exclusão e restauração vai para `log_eventos`, que ninguém altera nem apaga.

### Etapas do plano

1. ✅ Projeto Supabase, tabelas, login Google e deploy inicial no Cloudflare
2. ✅ Configurações (nome, logo, formas de pagamento, lixeira), avatar com upload, usuários online, política de privacidade
3. ✅ Acesso: lista de espera com aprovação por grupo, status do usuário, grupos de usuários e árvore de permissões
4. ✅ Cadastro de pessoas e da reserva (agenda provisória em lista)
5. ✅ Visões semanal e diária com arrastar e redimensionar
6. ✅ Visão mensal e lista para celular
7. ✅ Pagamento: prazos, rateio, comprovante, reservado automático, devolução e desconto
8. ✅ Anexos, comentários com menções e sino de notificações
9. ✅ Relógios de log e lixeira
10. ✅ Lista / relatório com filtros e exportação
11. ✅ Painel de novidades, testes por perfil e publicação
