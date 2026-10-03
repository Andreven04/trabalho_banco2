# Aula 3 — Manutenção e Backup (backend em TypeScript)

Engine do colega convertida para **TypeScript**, integrada ao backend Fastify
da Aula 2. A plataforma conecta em **qualquer banco alvo** (os dados vêm do
formulário do frontend), com **SSL opcional** e **ciência de schema**.

## O que mudou em relação ao código JS do colega

- Tudo em **TypeScript** tipado (`.ts`), na estrutura que já tínhamos.
- **Conexão genérica** (`src/config/database.ts`): SSL automático para Supabase
  e `search_path` por schema (funciona tanto em `public` local quanto em
  `loja,plataforma` do Supabase).
- **Caminho do `pg_dump`/`psql` configurável** por `.env` (`PG_BIN`), em vez do
  caminho fixo do Windows.
- **Backup com escopo por schema** (`pg_dump -n <schema>`), pra não despejar os
  schemas internos do Supabase.
- Removido o `backupEngine.js` (código morto, não era usado e referenciava
  colunas inexistentes).

## Passo 1 — Rodar o SQL da Aula 3

A engine usa dois objetos que **não existiam** na Aula 2. Rode o script
`sql/plataforma/02_aula3_manutencao.sql` no seu banco (ajuste o schema no topo:
`plataforma` para Supabase, `public` para um Postgres local):

- adiciona a coluna `backup_arquivo.checksum_sha256` (integridade);
- cria a tabela `manutencao_estatistica` (dead tuples antes/depois — a evidência
  central da Aula 3).

## Passo 2 — Backend

```cmd
cd backend
npm install
copy ..\.env.example ..\.env   REM se ainda não existir; ajuste PG_BIN se preciso
npm run dev
```

Deve aparecer: `🚀 Backend Fastify rodando em http://localhost:3000`.

> `PG_BIN` no `.env` deve apontar para a pasta `bin` do PostgreSQL
> (padrão Windows: `C:\Program Files\PostgreSQL\18\bin`). É de lá que saem o
> `pg_dump` e o `psql`.

## Passo 3 — Conectar no banco pelo frontend

O formulário manda `configBanco`. Para o **Supabase da Aula 2**, informe também:

- `schema`: `loja,plataforma`
- `ssl`: `true`
- porta **5432** (session pooler), usuário `postgres.<REF>`, database `postgres`.

Para um **Postgres local** (tudo em `public`): deixe `schema` vazio (padrão
`public`) e `ssl` desmarcado.

> Se o formulário do frontend ainda não tem os campos `schema` e `ssl`, dá pra
> adicioná-los ao objeto `configBanco` (peça que eu te passo o trecho).

## Passo 4 — Fluxo da Aula 3 (o que demonstrar)

1. **Gerar churn** (`POST /api/churn/executar`) → cria dead tuples.
2. **Executar manutenção** (`POST /api/manutencao/executar`) → decide VACUUM /
   VACUUM FULL ANALYZE pelas faixas de dias (ou escolha manual) e grava as
   estatísticas antes/depois em `manutencao_estatistica`.
3. **Backup** (`POST /api/processo/iniciar`) → roda manutenção + `pg_dump`, com
   criptografia AES / ZIP / retenção / cópia secundária conforme marcado.
4. **Integridade** (`POST /api/backup/verificar-integridade`) e **restauração**
   (`POST /api/backup/restaurar`) — a restauração cria um novo banco e confere
   os dados (precisa de um usuário com permissão de CREATE DATABASE; funciona
   num Postgres local, não no Supabase gerenciado).

## Endpoints

| Método/rota | Função |
|---|---|
| POST /api/conexao/testar | Testa a conexão |
| POST /api/churn/executar | Gera dead tuples |
| POST /api/dados/inserir | Insere massa de dados por tipo |
| POST /api/manutencao/executar | VACUUM por regra/escolha + estatísticas |
| POST /api/manutencao/historico | Histórico de manutenções |
| POST /api/processo/iniciar | Manutenção + backup (assíncrono) |
| POST /api/processo/status | Status/etapas de uma execução |
| POST /api/processo/historico | Histórico de execuções |
| POST /api/processo/etapas | Etapas de uma execução |
| POST /api/backup/descriptografar | Descriptografa um .enc |
| POST /api/backup/verificar-integridade | Confere o checksum SHA-256 |
| POST /api/backup/restaurar | Restaura em um novo banco |

## Evidência do VACUUM (consulta pronta)

Depois de rodar churn + manutenção, para o relatório:

```sql
SELECT tabela, momento, n_dead_tup, pg_size_pretty(tamanho_bytes) AS tamanho
FROM plataforma.manutencao_estatistica
WHERE manutencao_id = (SELECT MAX(id) FROM plataforma.manutencao_registro)
ORDER BY tabela, momento;
```
