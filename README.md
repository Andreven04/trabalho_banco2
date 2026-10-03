# Plataforma de Gerenciamento de Backup & Manutenção

Trabalho de **Banco de Dados II** — plataforma web para configurar, executar e
acompanhar a **manutenção (VACUUM)** e o **backup** de um PostgreSQL pela
interface. Backend em **Fastify + TypeScript**, frontend em **Angular**, banco
no **PostgreSQL** (Supabase ou local).

- Equipe: André, Davi Zappelini, Gabriel de Bona, José Henrique Pereira
- Repositório: https://github.com/Andreven04/trabalho_banco2

## Estrutura

```
trabalho_banco2/
├─ backend/        API Fastify (TypeScript) — engine de manutenção e backup
├─ frontend/       App Angular (tela única: config, processo, históricos)
├─ sql/            Scripts SQL (objetos da plataforma)
├─ .env.example    Modelo de .env (vai na RAIZ do projeto)
└─ AULA3_INSTRUCOES.md
```

## Pré-requisitos

- **Node.js 22.22.3+** (ou 24.15+). ⚠️ O Angular CLI 22 recusa versões abaixo de
  `22.22.3` — confira com `node -v`. Se der erro de versão de Node ao rodar o
  frontend, atualize o Node.
- **PostgreSQL client** (`pg_dump` e `psql`) instalado. No Windows, aponte
  `PG_BIN` no `.env` para a pasta `bin` (ex.: `C:\Program Files\PostgreSQL\18\bin`).
- Um banco PostgreSQL alvo (Supabase da Aula 2 ou um Postgres local).

## 1. Banco de dados

Rode no banco alvo, no schema correto (`plataforma` no Supabase, `public` num
Postgres local — ajuste o `SET search_path` no topo do arquivo):

```
sql/plataforma/02_aula3_manutencao.sql
```

Ele adiciona `backup_arquivo.checksum_sha256` (integridade) e cria
`manutencao_estatistica` (dead tuples antes/depois). Os scripts de estrutura e
carga do domínio (Aula 2) estão no repositório em `sql/dominio` e
`sql/plataforma/01_estrutura.sql`.

## 2. Backend

```bash
# na RAIZ do projeto
cp .env.example .env          # Windows: copy .env.example .env
# ajuste PG_BIN se estiver no Windows

cd backend
npm install
npm run dev                   # tsx watch — recarrega ao salvar
```

Deve aparecer: `🚀 Backend Fastify rodando em http://localhost:3000`.

Scripts: `npm run dev` (desenvolvimento), `npm start` (executa uma vez),
`npm run build` (compila para `dist/`), `npm run typecheck` (só checa tipos).

## 3. Frontend

```bash
cd frontend
npm install
npm start                     # ng serve → http://localhost:4200
```

Produção: `npm run build` (gera `dist/frontend`).

## 4. Usar / demonstrar pela interface

1. Preencha a **conexão** (host, porta, database, usuário, senha, schema, ssl).
   - Supabase: `schema = loja,plataforma`, `ssl` marcado, porta `5432`
     (session pooler), usuário `postgres.<REF>`, database `postgres`.
   - Postgres local: `schema` vazio (= `public`) e `ssl` desmarcado.
2. **Testar conexão**.
3. **Gerar churn** (cria dead tuples) → **Executar manutenção** (VACUUM por
   faixa de dias ou escolha manual; grava estatísticas antes/depois).
4. **Iniciar processo completo** (manutenção + backup), marcando as opções:
   criptografia AES, compactação ZIP com senha, retenção (quantidade a manter),
   cópia secundária. O frontend acompanha as etapas em tempo real.
5. **Verificar integridade** (checksum SHA-256) e **restaurar** um backup.
   > A restauração cria um novo banco (CREATE DATABASE) — funciona em Postgres
   > local com superusuário; no Supabase gerenciado não é permitido.

## O que foi ajustado para rodar em produção

- `frontend/angular.json`: os *budgets* padrão do Angular (8 kB por estilo de
  componente, 1 MB inicial) estouravam no `ng build` por causa do `app.scss`
  (~18 kB) e do bundle inicial. Limites elevados para `anyComponentStyle`
  24 kB/48 kB e `initial` 1 MB/2 MB. (`ng serve` ignora budgets; o erro só
  aparecia no build de produção.)

Verificado neste ambiente: backend com `typecheck` limpo e subindo em
`:3000` respondendo os endpoints; frontend com `ng build --configuration
production` concluído com sucesso.
