# Plataforma de Gerenciamento de Backup

Trabalho prático de **Banco de Dados II** — plataforma para configurar, executar e
acompanhar a manutenção e o backup de um banco PostgreSQL.

**Equipe:** André Júnior, Davi Zappelini, Gabriel de Bona, José Henrique Pereira
**Repositório:** https://github.com/Andreven04/trabalho_banco2

## Stack

- **Banco:** PostgreSQL hospedado no Supabase (dois schemas: `loja` e `plataforma`)
- **Backend:** Node.js + Fastify (TypeScript), driver `pg`
- **Frontend:** Angular *(em desenvolvimento)*

## Pré-requisitos

- Node.js 20+ e npm
- Git
- Cliente PostgreSQL (`psql`) — para rodar os scripts e, na Aula 3, o `pg_dump`

## 1. Banco de dados

Conecte no Supabase pelo `psql` (string do **Session pooler**, porta 5432, SSL):

```bash
psql "postgresql://<USER>:<SENHA>@<HOST>.pooler.supabase.com:5432/postgres?sslmode=require"
```

Crie os schemas e rode os scripts **nesta ordem**:

```sql
create schema if not exists loja;
create schema if not exists plataforma;

\i sql/dominio/01_estrutura.sql
\i sql/plataforma/01_estrutura.sql
\i sql/dominio/02_carga.sql
```

> `02_carga.sql` gera a massa de dados (produtos, clientes, pedidos, itens,
> pagamentos e ~300 mil movimentos de estoque) e leva alguns segundos.

Conferir a carga:

```sql
SELECT 'produto', COUNT(*) FROM loja.produto
UNION ALL SELECT 'cliente', COUNT(*) FROM loja.cliente
UNION ALL SELECT 'pedido', COUNT(*) FROM loja.pedido;
```

## 2. Backend

```bash
cd backend
npm install
npm run dev
```

A configuração vem do arquivo **`.env` na raiz do projeto** (não versionado):

```dotenv
DATABASE_URL=postgresql://<USER>:<SENHA>@<HOST>.pooler.supabase.com:5432/postgres
PORT=3000
```

> Use `.env.example` como modelo. Nunca comite o `.env` com a senha real.

## 3. Testar a conexão

Com o backend rodando:

```
GET http://localhost:3000/api/conexao/testar
```

Resposta esperada:

```json
{ "conectado": true, "mensagem": "Conexão estabelecida com o banco (Supabase).", "resultado": 1 }
```

## 4. Frontend

*Em desenvolvimento — tela de configuração com botão "Testar conexão".*

## Estrutura do repositório

```
trabalho_banco2/
├─ backend/            # API Fastify
├─ frontend/           # Angular
├─ sql/
│  ├─ dominio/         # loja: estrutura, carga, churn
│  └─ plataforma/      # metadados: estrutura
├─ docs/               # documento de visão e relatórios
├─ .env.example
└─ README.md
```
