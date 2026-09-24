-- ============================================================
-- Trabalho de Banco 2 — Aula 2
-- Estrutura do banco de DOMÍNIO (loja online) — schema: loja
-- Rodar no SQL Editor do Supabase.
-- Pré-requisito: schema "loja" já criado (Parte 1).
-- ============================================================

CREATE TABLE IF NOT EXISTS loja.categoria (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    descricao TEXT
);

CREATE TABLE IF NOT EXISTS loja.produto (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    categoria_id BIGINT REFERENCES loja.categoria(id),
    nome VARCHAR(150) NOT NULL,
    sku VARCHAR(50) UNIQUE NOT NULL,
    preco NUMERIC(10, 2) NOT NULL,
    ativo BOOLEAN DEFAULT TRUE,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS loja.cliente (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    cpf VARCHAR(14) UNIQUE NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS loja.pedido (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cliente_id BIGINT NOT NULL REFERENCES loja.cliente(id),
    status VARCHAR(50) NOT NULL,
    total NUMERIC(10, 2) NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS loja.pedido_item (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pedido_id BIGINT NOT NULL REFERENCES loja.pedido(id) ON DELETE CASCADE,
    produto_id BIGINT NOT NULL REFERENCES loja.produto(id),
    quantidade INT NOT NULL,
    preco_unit NUMERIC(10, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS loja.pagamento (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pedido_id BIGINT NOT NULL REFERENCES loja.pedido(id) ON DELETE CASCADE,
    metodo VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL,
    valor NUMERIC(10, 2) NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS loja.estoque_movimento (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    produto_id BIGINT NOT NULL REFERENCES loja.produto(id),
    tipo VARCHAR(20) NOT NULL,
    quantidade INT NOT NULL,
    saldo INT NOT NULL,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
