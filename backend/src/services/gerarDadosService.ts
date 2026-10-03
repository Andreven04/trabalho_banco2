import type { QueryResult } from "pg";
import { criarCliente } from "../config/database";
import type { ConfigBanco } from "../types";

export type TipoDado =
  | "produto"
  | "cliente"
  | "pedido"
  | "pedido_item"
  | "estoque_movimento";

export interface ResultadoGerarDados {
  sucesso: boolean;
  tipo: string;
  quantidade: number;
  mensagem: string;
}

/**
 * Insere massa de dados adicional no banco de domínio, por tipo.
 */
export async function gerarDados(
  configBanco: ConfigBanco,
  tipo: string,
  quantidade: number,
): Promise<ResultadoGerarDados> {
  const client = criarCliente(configBanco);

  try {
    await client.connect();
    await client.query("BEGIN");

    let resultado: QueryResult;

    if (tipo === "produto") {
      resultado = await client.query(
        `
        INSERT INTO produto (categoria_id, nome, sku, preco)
        SELECT
          (SELECT id FROM categoria ORDER BY RANDOM() LIMIT 1),
          'Produto Gerado ' || nextval(pg_get_serial_sequence('produto', 'id')),
          'SKU-GERADO-' || gen_random_uuid()::TEXT,
          (10 + (RANDOM() * 500))::NUMERIC(10,2)
        FROM generate_series(1, $1)
        RETURNING id;
        `,
        [quantidade],
      );
    } else if (tipo === "cliente") {
      resultado = await client.query(
        `
        INSERT INTO cliente (nome, email, cpf)
        SELECT
          'Cliente ' || base_id,
          'cliente' || base_id || '@exemplo.com',
          LPAD(base_id::text, 11, '0')
        FROM (
          SELECT (COALESCE((SELECT MAX(id) FROM cliente), 0) + g)::BIGINT AS base_id
          FROM generate_series(1, $1) AS g
        ) x
        RETURNING id;
        `,
        [quantidade],
      );
    } else if (tipo === "pedido") {
      resultado = await client.query(
        `
        INSERT INTO pedido (cliente_id, status, total)
        SELECT
          (SELECT id FROM cliente ORDER BY RANDOM() LIMIT 1),
          CASE FLOOR(RANDOM() * 4)::INT
            WHEN 0 THEN 'PENDENTE'
            WHEN 1 THEN 'PAGO'
            WHEN 2 THEN 'ENVIADO'
            ELSE 'CANCELADO'
          END,
          (20 + (RANDOM() * 1000))::NUMERIC(10,2)
        FROM generate_series(1, $1)
        RETURNING id;
        `,
        [quantidade],
      );
    } else if (tipo === "pedido_item") {
      resultado = await client.query(
        `
        INSERT INTO pedido_item (pedido_id, produto_id, quantidade, preco_unit)
        SELECT
          (SELECT id FROM pedido ORDER BY RANDOM() LIMIT 1),
          (SELECT id FROM produto ORDER BY RANDOM() LIMIT 1),
          (1 + FLOOR(RANDOM() * 5))::INT,
          (10 + (RANDOM() * 200))::NUMERIC(10,2)
        FROM generate_series(1, $1)
        RETURNING id;
        `,
        [quantidade],
      );
    } else if (tipo === "estoque_movimento") {
      resultado = await client.query(
        `
        INSERT INTO estoque_movimento (produto_id, tipo, quantidade, saldo)
        SELECT
          (SELECT id FROM produto ORDER BY RANDOM() LIMIT 1),
          CASE WHEN RANDOM() < 0.5 THEN 'ENTRADA' ELSE 'SAIDA' END,
          (1 + FLOOR(RANDOM() * 50))::INT,
          (100 + FLOOR(RANDOM() * 500))::INT
        FROM generate_series(1, $1)
        RETURNING id;
        `,
        [quantidade],
      );
    } else {
      throw new Error("Tipo de dado inválido.");
    }

    await client.query("COMMIT");

    return {
      sucesso: true,
      tipo,
      quantidade: resultado.rowCount ?? 0,
      mensagem: `${resultado.rowCount ?? 0} registro(s) adicionado(s) com sucesso.`,
    };
  } catch (erro) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignora
    }
    throw new Error(`Erro ao gerar dados: ${(erro as Error).message}`);
  } finally {
    try {
      await client.end();
    } catch {
      // ignora
    }
  }
}
