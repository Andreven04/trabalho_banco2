import { criarCliente } from "../config/database";
import type { ConfigBanco } from "../types";

// Limites mínimos para preservar a massa de dados.
const MINIMO_PEDIDOS = 5000;
const MINIMO_ITENS = 3000;

export interface ResultadoChurn {
  sucesso: boolean;
  mensagem: string;
}

/**
 * Gera "churn" (rotatividade) no banco de domínio: apaga e
 * atualiza registros para produzir dead tuples, tornando o
 * efeito do VACUUM observável.
 *
 * Preserva um mínimo de pedidos/itens para não esvaziar a massa.
 */
export async function executarChurn(configBanco: ConfigBanco): Promise<ResultadoChurn> {
  const client = criarCliente(configBanco);

  try {
    await client.connect();
    await client.query("BEGIN");

    // 1. Contagem atual.
    const resultadoContagem = await client.query<{
      total_pedidos: number;
      total_itens: number;
      pedidos_alvo: number;
    }>(`
      SELECT
        (SELECT COUNT(*)::INT FROM pedido) AS total_pedidos,
        (SELECT COUNT(*)::INT FROM pedido_item) AS total_itens,
        (SELECT COUNT(*)::INT FROM pedido WHERE status IN ('CANCELADO', 'PENDENTE')) AS pedidos_alvo;
    `);

    const totalPedidos = resultadoContagem.rows[0].total_pedidos;
    const totalItens = resultadoContagem.rows[0].total_itens;
    const pedidosAlvo = resultadoContagem.rows[0].pedidos_alvo;

    // 2. Quantos pedidos podem ser removidos.
    const limiteMaximoPedidosRemover = Math.max(0, totalPedidos - MINIMO_PEDIDOS);
    const quantidadePedidosDesejada = Math.floor(pedidosAlvo * 0.2);
    let quantidadePedidosRemover = Math.min(
      quantidadePedidosDesejada,
      limiteMaximoPedidosRemover,
    );

    // 3. Seleciona pedidos aleatórios numa tabela temporária.
    await client.query(`
      CREATE TEMP TABLE churn_pedidos (id BIGINT PRIMARY KEY) ON COMMIT DROP;
    `);

    if (quantidadePedidosRemover > 0) {
      await client.query(
        `
        INSERT INTO churn_pedidos (id)
        SELECT id FROM pedido
        WHERE status IN ('CANCELADO', 'PENDENTE')
        ORDER BY RANDOM()
        LIMIT $1;
        `,
        [quantidadePedidosRemover],
      );
    }

    // 4. Quantos itens serão removidos pelo CASCADE.
    let resultadoCascade = await client.query<{ quantidade: number }>(`
      SELECT COUNT(*)::INT AS quantidade
      FROM pedido_item pi
      INNER JOIN churn_pedidos cp ON cp.id = pi.pedido_id;
    `);
    let quantidadeItensCascade = resultadoCascade.rows[0].quantidade;

    const limiteMaximoItensRemover = Math.max(0, totalItens - MINIMO_ITENS);

    // 5. Reduz a seleção se o CASCADE sozinho ultrapassar o limite.
    while (
      quantidadeItensCascade > limiteMaximoItensRemover &&
      quantidadePedidosRemover > 0
    ) {
      const mediaItensPorPedido = quantidadeItensCascade / quantidadePedidosRemover;
      const excesso = quantidadeItensCascade - limiteMaximoItensRemover;

      let quantidadeParaRemoverDaSelecao = Math.ceil(
        excesso / Math.max(1, mediaItensPorPedido),
      );
      quantidadeParaRemoverDaSelecao = Math.max(
        1,
        Math.min(quantidadeParaRemoverDaSelecao, quantidadePedidosRemover),
      );

      await client.query(
        `
        DELETE FROM churn_pedidos
        WHERE id IN (
          SELECT id FROM churn_pedidos ORDER BY RANDOM() LIMIT $1
        );
        `,
        [quantidadeParaRemoverDaSelecao],
      );

      const resultadoPedidosSelecionados = await client.query<{ quantidade: number }>(`
        SELECT COUNT(*)::INT AS quantidade FROM churn_pedidos;
      `);
      quantidadePedidosRemover = resultadoPedidosSelecionados.rows[0].quantidade;

      resultadoCascade = await client.query<{ quantidade: number }>(`
        SELECT COUNT(*)::INT AS quantidade
        FROM pedido_item pi
        INNER JOIN churn_pedidos cp ON cp.id = pi.pedido_id;
      `);
      quantidadeItensCascade = resultadoCascade.rows[0].quantidade;
    }

    // 6. Quantos itens podem ser removidos diretamente (alvo: 30%).
    const quantidadeItensDesejada = Math.floor(totalItens * 0.3);
    const quantidadeItensDisponivelParaDelete = Math.max(
      0,
      limiteMaximoItensRemover - quantidadeItensCascade,
    );
    const quantidadeItensRemover = Math.min(
      quantidadeItensDesejada,
      quantidadeItensDisponivelParaDelete,
    );

    // 7. Seleciona itens que NÃO pertencem aos pedidos do CASCADE.
    await client.query(`
      CREATE TEMP TABLE churn_itens (id BIGINT PRIMARY KEY) ON COMMIT DROP;
    `);

    if (quantidadeItensRemover > 0) {
      await client.query(
        `
        INSERT INTO churn_itens (id)
        SELECT pi.id FROM pedido_item pi
        WHERE NOT EXISTS (
          SELECT 1 FROM churn_pedidos cp WHERE cp.id = pi.pedido_id
        )
        ORDER BY RANDOM()
        LIMIT $1;
        `,
        [quantidadeItensRemover],
      );
    }

    // 8. Remove os itens selecionados.
    await client.query(`
      DELETE FROM pedido_item WHERE id IN (SELECT id FROM churn_itens);
    `);

    // 9. Remove os pedidos (CASCADE remove os itens ligados).
    await client.query(`
      DELETE FROM pedido WHERE id IN (SELECT id FROM churn_pedidos);
    `);

    // 10. Atualiza 40% dos pedidos restantes.
    const resultadoPedidosRestantes = await client.query<{ quantidade: number }>(`
      SELECT COUNT(*)::INT AS quantidade FROM pedido;
    `);
    const totalPedidosRestantes = resultadoPedidosRestantes.rows[0].quantidade;
    const quantidadePedidosAtualizar = Math.floor(totalPedidosRestantes * 0.4);

    if (quantidadePedidosAtualizar > 0) {
      await client.query(
        `
        UPDATE pedido
        SET status = CASE FLOOR(RANDOM() * 3)::INT
              WHEN 0 THEN 'PROCESSANDO'
              WHEN 1 THEN 'ENVIADO'
              ELSE 'CONCLUIDO'
            END,
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id IN (
          SELECT id FROM pedido ORDER BY RANDOM() LIMIT $1
        );
        `,
        [quantidadePedidosAtualizar],
      );
    }

    // 11. Confirma a transação.
    await client.query("COMMIT");

    return {
      sucesso: true,
      mensagem: "Churn executado com sucesso! Dead tuples geradas no banco.",
    };
  } catch (erro) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignora
    }
    throw new Error(`Erro ao rodar script de churn: ${(erro as Error).message}`);
  } finally {
    try {
      await client.end();
    } catch {
      // ignora
    }
  }
}
