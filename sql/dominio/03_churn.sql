-- ============================================================
-- Trabalho de Banco 2 — material da AULA 3 (manutenção/VACUUM)
-- Churn: gera dead tuples para tornar o efeito do VACUUM observável.
-- NÃO é necessário rodar na Aula 2. Guardado aqui para a próxima etapa.
-- ============================================================

BEGIN;

-- Apaga ~30% dos itens de pedido
DELETE FROM loja.pedido_item
WHERE id IN (
    SELECT id FROM loja.pedido_item
    ORDER BY RANDOM()
    LIMIT (SELECT (COUNT(*) * 0.30)::int FROM loja.pedido_item)
);

-- Apaga ~20% dos pedidos cancelados/pendentes
DELETE FROM loja.pedido
WHERE status IN ('CANCELADO', 'PENDENTE')
  AND id IN (
      SELECT id FROM loja.pedido
      WHERE status IN ('CANCELADO', 'PENDENTE')
      ORDER BY RANDOM()
      LIMIT (SELECT (COUNT(*) * 0.20)::int
             FROM loja.pedido WHERE status IN ('CANCELADO', 'PENDENTE'))
  );

-- Atualiza o status de ~40% dos pedidos
UPDATE loja.pedido
SET status = CASE (FLOOR(RANDOM() * 3)::INT)
        WHEN 0 THEN 'PROCESSANDO'
        WHEN 1 THEN 'ENVIADO'
        ELSE 'CONCLUIDO'
    END,
    atualizado_em = CURRENT_TIMESTAMP
WHERE id IN (
    SELECT id FROM loja.pedido
    ORDER BY RANDOM()
    LIMIT (SELECT (COUNT(*) * 0.40)::int FROM loja.pedido)
);

COMMIT;
