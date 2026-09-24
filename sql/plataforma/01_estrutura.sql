-- ============================================================
-- Trabalho de Banco 2 — Aula 2
-- Estrutura do banco de METADADOS da plataforma — schema: plataforma
-- Rodar no SQL Editor do Supabase.
-- Pré-requisito: schema "plataforma" já criado (Parte 1).
-- ============================================================

CREATE TABLE IF NOT EXISTS plataforma.banco_alvo (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    host VARCHAR(100) NOT NULL,
    porta INT NOT NULL DEFAULT 5432,
    database VARCHAR(100) NOT NULL,
    usuario VARCHAR(100) NOT NULL,
    segredo_ref VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS plataforma.config_backup (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    banco_alvo_id BIGINT REFERENCES plataforma.banco_alvo(id),
    caminho_destino VARCHAR(255) NOT NULL,
    quantidade_manter INT DEFAULT 7,
    caminho_copia VARCHAR(255),
    executar_manutencao BOOLEAN DEFAULT FALSE,
    manutencao_completa BOOLEAN DEFAULT FALSE,
    criptografar BOOLEAN DEFAULT FALSE,
    compactar BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS plataforma.execucao (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    config_id BIGINT REFERENCES plataforma.config_backup(id),
    iniciado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finalizado_em TIMESTAMP,
    status VARCHAR(50) DEFAULT 'EM_ANDAMENTO',
    etapa_atual VARCHAR(100),
    resumo TEXT
);

CREATE TABLE IF NOT EXISTS plataforma.execucao_etapa (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    execucao_id BIGINT REFERENCES plataforma.execucao(id) ON DELETE CASCADE,
    etapa VARCHAR(100) NOT NULL,
    ordem INT NOT NULL,
    status VARCHAR(50) NOT NULL,
    iniciado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finalizado_em TIMESTAMP,
    mensagem TEXT
);

CREATE TABLE IF NOT EXISTS plataforma.manutencao_registro (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    execucao_id BIGINT REFERENCES plataforma.execucao(id) ON DELETE CASCADE,
    decisao VARCHAR(100) NOT NULL,
    regra_aplicada VARCHAR(150),
    origem VARCHAR(20) CHECK (origem IN ('auto', 'manual')),
    iniciado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    finalizado_em TIMESTAMP,
    resultado VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS plataforma.backup_arquivo (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    execucao_id BIGINT REFERENCES plataforma.execucao(id) ON DELETE CASCADE,
    caminho VARCHAR(255) NOT NULL,
    tamanho_bytes BIGINT,
    checksum VARCHAR(64),
    criptografado BOOLEAN DEFAULT FALSE,
    compactado BOOLEAN DEFAULT FALSE,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plataforma.log_evento (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    execucao_id BIGINT REFERENCES plataforma.execucao(id) ON DELETE CASCADE,
    etapa VARCHAR(100),
    nivel VARCHAR(20) DEFAULT 'INFO',
    mensagem TEXT,
    saida_tecnica TEXT,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
