-- ============================================================
-- Trabalho de Banco 2 — Aula 2
-- Carga de massa do banco de DOMÍNIO (loja) — schema: loja
-- Rodar UMA vez, com as tabelas vazias (a carga não é idempotente).
-- Volumes alinhados ao Documento de Visão (Aula 1).
-- ============================================================

-- Para recarregar do zero, descomente o TRUNCATE abaixo:
-- TRUNCATE loja.estoque_movimento, loja.pagamento, loja.pedido_item,
--          loja.pedido, loja.cliente, loja.produto, loja.categoria
--   RESTART IDENTITY CASCADE;

-- Categorias
INSERT INTO loja.categoria (nome, descricao) VALUES
('Eletrônicos',    'Dispositivos eletrônicos e gadgets'),
('Vestuário',      'Roupas e acessórios'),
('Casa e Cozinha', 'Artigos para o lar'),
('Livros',         'Livros físicos e e-books');

-- 2.000 produtos
INSERT INTO loja.produto (categoria_id, nome, sku, preco)
SELECT
    (i % 4) + 1,
    'Produto ' || i,
    'SKU-' || i,
    (10 + RANDOM() * 500)::NUMERIC(10, 2)
FROM generate_series(1, 2000) AS i;

-- 5.000 clientes
INSERT INTO loja.cliente (nome, email, cpf)
SELECT
    'Cliente ' || i,
    'cliente' || i || '@exemplo.com',
    LPAD(i::TEXT, 11, '0')
FROM generate_series(1, 5000) AS i;

-- 50.000 pedidos
INSERT INTO loja.pedido (cliente_id, status, total)
SELECT
    (i % 5000) + 1,
    CASE (i % 4)
        WHEN 0 THEN 'PENDENTE'
        WHEN 1 THEN 'PAGO'
        WHEN 2 THEN 'ENVIADO'
        ELSE 'CANCELADO'
    END,
    (20 + RANDOM() * 1000)::NUMERIC(10, 2)
FROM generate_series(1, 50000) AS i;

-- 150.000 itens de pedido
INSERT INTO loja.pedido_item (pedido_id, produto_id, quantidade, preco_unit)
SELECT
    (i % 50000) + 1,
    (i % 2000) + 1,
    (1 + FLOOR(RANDOM() * 5))::INT,
    (10 + RANDOM() * 200)::NUMERIC(10, 2)
FROM generate_series(1, 150000) AS i;

-- Pagamentos: um para cada pedido já PAGO ou ENVIADO
INSERT INTO loja.pagamento (pedido_id, metodo, status, valor)
SELECT
    id,
    CASE (id % 3) WHEN 0 THEN 'PIX' WHEN 1 THEN 'CARTAO' ELSE 'BOLETO' END,
    'APROVADO',
    total
FROM loja.pedido
WHERE status IN ('PAGO', 'ENVIADO');

-- 300.000 movimentos de estoque (tabela de maior rotatividade)
INSERT INTO loja.estoque_movimento (produto_id, tipo, quantidade, saldo)
SELECT
    (i % 2000) + 1,
    CASE (i % 2) WHEN 0 THEN 'ENTRADA' ELSE 'SAIDA' END,
    (1 + FLOOR(RANDOM() * 50))::INT,
    (FLOOR(RANDOM() * 1000))::INT
FROM generate_series(1, 300000) AS i;
