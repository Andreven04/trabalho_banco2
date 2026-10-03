-- ============================================================
-- Setup da PLATAFORMA em um banco alvo QUALQUER (ex.: banco do professor)
-- Rode isto UMA vez, conectado ao banco alvo como usuário com permissão
-- (postgres / superusuário). Cria o schema de metadados "plataforma"
-- com todas as tabelas que a engine usa. Idempotente (IF NOT EXISTS).
--
-- Depois, no formulário do frontend, use:
--   schema = public,plataforma     (domínio do banco + metadados)
--   ssl    = desmarcado            (Postgres local/rede, sem SSL)
-- ============================================================

CREATE SCHEMA IF NOT EXISTS plataforma;
SET search_path TO plataforma;

CREATE TABLE IF NOT EXISTS banco_alvo (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    host VARCHAR(100) NOT NULL,
    porta INT NOT NULL DEFAULT 5432,
    database VARCHAR(100) NOT NULL,
    usuario VARCHAR(100) NOT NULL,
    segredo_ref VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS config_backup (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    banco_alvo_id BIGINT REFERENCES banco_alvo(id),
    caminho_destino VARCHAR(255) NOT NULL,
    quantidade_manter INT DEFAULT 7,
    caminho_copia VARCHAR(255),
    executar_manutencao BOOLEAN DEFAULT FALSE,
    manutencao_completa BOOLEAN DEFAULT FALSE,
    criptografar BOOLEAN DEFAULT FALSE,
    compactar BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS execucao (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    config_id BIGINT REFERENCES config_backup(id),
    iniciado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finalizado_em TIMESTAMP,
    status VARCHAR(50) DEFAULT 'EM_ANDAMENTO',
    etapa_atual VARCHAR(100),
    resumo TEXT
);

CREATE TABLE IF NOT EXISTS execucao_etapa (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    execucao_id BIGINT REFERENCES execucao(id) ON DELETE CASCADE,
    etapa VARCHAR(100) NOT NULL,
    ordem INT NOT NULL,
    status VARCHAR(50) NOT NULL,
    iniciado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finalizado_em TIMESTAMP,
    mensagem TEXT
);

CREATE TABLE IF NOT EXISTS manutencao_registro (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    execucao_id BIGINT REFERENCES execucao(id) ON DELETE CASCADE,
    decisao VARCHAR(100) NOT NULL,
    regra_aplicada VARCHAR(150),
    origem VARCHAR(20) CHECK (origem IN ('auto', 'manual')),
    iniciado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finalizado_em TIMESTAMP,
    resultado VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS backup_arquivo (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    execucao_id BIGINT REFERENCES execucao(id) ON DELETE CASCADE,
    caminho VARCHAR(255) NOT NULL,
    tamanho_bytes BIGINT,
    checksum VARCHAR(64),
    checksum_sha256 VARCHAR(64),      -- usado na verificação de integridade (RF13)
    criptografado BOOLEAN DEFAULT FALSE,
    compactado BOOLEAN DEFAULT FALSE,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS log_evento (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    execucao_id BIGINT REFERENCES execucao(id) ON DELETE CASCADE,
    etapa VARCHAR(100),
    nivel VARCHAR(20) DEFAULT 'INFO',
    mensagem TEXT,
    saida_tecnica TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Estatísticas de manutenção (dead tuples antes/depois do VACUUM) — Aula 3.
CREATE TABLE IF NOT EXISTS manutencao_estatistica (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    manutencao_id BIGINT NOT NULL
        REFERENCES manutencao_registro(id) ON DELETE CASCADE,
    momento VARCHAR(10) NOT NULL CHECK (momento IN ('ANTES', 'DEPOIS')),
    tabela VARCHAR(100) NOT NULL,
    n_live_tup BIGINT,
    n_dead_tup BIGINT,
    tamanho_bytes BIGINT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_manutencao_estatistica_manutencao
    ON manutencao_estatistica (manutencao_id);
