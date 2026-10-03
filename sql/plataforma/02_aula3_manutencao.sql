-- ============================================================
-- Trabalho de Banco 2 — AULA 3 (Manutenção e Backup)
-- Objetos que a engine de backup usa e que não existiam na Aula 2.
--
-- Ajuste o schema de metadados antes de rodar:
--   Supabase (Aula 2)          -> plataforma
--   PostgreSQL local (public)  -> public
-- ============================================================

SET search_path TO plataforma;   -- troque para "public" se o banco for local

-- 1) Coluna de checksum SHA-256 no registro de arquivos de backup.
--    Usada para verificar a integridade do backup (RF13).
ALTER TABLE backup_arquivo
  ADD COLUMN IF NOT EXISTS checksum_sha256 VARCHAR(64);

-- 2) Estatísticas de manutenção (antes/depois do VACUUM).
--    Guardam n_dead_tup e o tamanho das tabelas para comprovar
--    o efeito da manutenção — a evidência central da Aula 3.
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
