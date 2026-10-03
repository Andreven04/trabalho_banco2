import type { Client } from "pg";
import { criarCliente, schemaDominio } from "../config/database";
import { registrarLog } from "./logService";
import { simularEnvioEmail } from "./emailService";
import type {
  ConfigBanco,
  EstatisticaTabela,
  MomentoEstatistica,
  OrigemManutencao,
} from "../types";

const TABELAS_DOMINIO = [
  "categoria",
  "produto",
  "cliente",
  "pedido",
  "pedido_item",
  "pagamento",
  "estoque_movimento",
];

/**
 * Coleta estatísticas das principais tabelas do domínio.
 *
 * n_live_tup     = estimativa de tuplas vivas
 * n_dead_tup     = estimativa de tuplas mortas
 * tamanho_bytes  = tamanho total (tabela + índices)
 */
export async function coletarEstatisticasBanco(
  client: Client,
  schema: string,
): Promise<EstatisticaTabela[]> {
  const query = `
    SELECT
      s.relname AS tabela,
      s.n_live_tup,
      s.n_dead_tup,
      pg_total_relation_size(
        quote_ident(s.schemaname) || '.' || quote_ident(s.relname)
      ) AS tamanho_bytes,
      pg_size_pretty(
        pg_total_relation_size(
          quote_ident(s.schemaname) || '.' || quote_ident(s.relname)
        )
      ) AS tamanho_formatado
    FROM pg_stat_user_tables s
    WHERE s.schemaname = $1
      AND s.relname = ANY($2::text[])
    ORDER BY s.relname;
  `;

  const resultado = await client.query<EstatisticaTabela>(query, [
    schema,
    TABELAS_DOMINIO,
  ]);

  return resultado.rows;
}

async function salvarEstatisticasManutencao(
  client: Client,
  manutencaoId: number,
  momento: MomentoEstatistica,
  estatisticas: EstatisticaTabela[],
): Promise<void> {
  const query = `
    INSERT INTO manutencao_estatistica (
      manutencao_id, momento, tabela, n_live_tup, n_dead_tup, tamanho_bytes
    )
    VALUES ($1, $2, $3, $4, $5, $6);
  `;

  for (const e of estatisticas) {
    await client.query(query, [
      manutencaoId,
      momento,
      e.tabela,
      e.n_live_tup,
      e.n_dead_tup,
      e.tamanho_bytes,
    ]);
  }
}

/**
 * Consulta o histórico de manutenções para calcular há quantos
 * dias foi a última manutenção efetiva.
 */
export async function obterDiasDesdeUltimaManutencao(
  client: Client,
): Promise<number | null> {
  const res = await client.query<{ iniciado_em: Date; finalizado_em: Date | null }>(
    `
    SELECT iniciado_em, finalizado_em
    FROM manutencao_registro
    WHERE resultado = 'SUCESSO'
      AND decisao <> 'NENHUMA'
    ORDER BY id DESC
    LIMIT 1;
    `,
  );

  if (res.rows.length === 0) {
    return null;
  }

  const ultimaData = new Date(res.rows[0].finalizado_em || res.rows[0].iniciado_em);
  const agora = new Date();
  const diferencaMs = agora.getTime() - ultimaData.getTime();
  return Math.floor(diferencaMs / (1000 * 60 * 60 * 24));
}

export interface ResultadoManutencao {
  sucesso: boolean;
  registroId: number;
  acao: string;
  regra: string;
  origem: OrigemManutencao;
  iniciadoEm: Date;
  finalizadoEm: Date;
  estatisticas: {
    antes: EstatisticaTabela[];
    depois: EstatisticaTabela[];
  };
}

/**
 * Aplica a regra de negócio (ou a escolha explícita do usuário)
 * e executa o comando de manutenção correspondente.
 *
 * Regra automática por temporalidade:
 *  - sem histórico          -> VACUUM FULL ANALYZE
 *  - < 30 dias              -> NENHUMA
 *  - entre 30 e 60 dias     -> VACUUM
 *  - > 60 dias              -> VACUUM FULL ANALYZE
 */
export async function decidirEExecutarManutencao(
  configBanco: ConfigBanco,
  escolhaExplicita = false,
  manutencaoCompleta = false,
): Promise<ResultadoManutencao> {
  const client = criarCliente(configBanco);
  const schema = schemaDominio(configBanco);
  const inicio = new Date();

  let decisao = "NENHUMA";
  let regraAplicada = "";
  const origem: OrigemManutencao = escolhaExplicita ? "manual" : "auto";

  const parametrosLog = {
    escolhaExplicita: Boolean(escolhaExplicita),
    manutencaoCompleta: Boolean(manutencaoCompleta),
    origem,
  };

  try {
    await client.connect();

    // ---- Decisão da manutenção ----
    if (escolhaExplicita) {
      if (manutencaoCompleta) {
        decisao = "VACUUM FULL ANALYZE";
        regraAplicada =
          "Escolha explícita do usuário: Manutenção Completa com Análise.";
      } else {
        decisao = "VACUUM";
        regraAplicada = "Escolha explícita do usuário: Manutenção Simples.";
      }
    } else {
      const dias = await obterDiasDesdeUltimaManutencao(client);

      if (dias === null) {
        decisao = "VACUUM FULL ANALYZE";
        regraAplicada = "Sem histórico de manutenção anterior registrada.";
      } else if (dias < 30) {
        decisao = "NENHUMA";
        regraAplicada = `Última manutenção há ${dias} dia(s) (menos de 30 dias). Manutenção ignorada.`;
      } else if (dias >= 30 && dias <= 60) {
        decisao = "VACUUM";
        regraAplicada = `Última manutenção há ${dias} dia(s) (entre 30 e 60 dias). Executando VACUUM.`;
      } else {
        decisao = "VACUUM FULL ANALYZE";
        regraAplicada = `Última manutenção há ${dias} dia(s) (superior a 60 dias). Executando VACUUM FULL ANALYZE.`;
      }
    }

    // ---- Estatísticas ANTES ----
    const estatisticasAntes = await coletarEstatisticasBanco(client, schema);

    // ---- Execução da manutenção ----
    if (decisao !== "NENHUMA") {
      await client.query(decisao);
    }

    // ---- Estatísticas DEPOIS ----
    const estatisticasDepois = await coletarEstatisticasBanco(client, schema);

    const fim = new Date();

    // ---- Registro de sucesso ----
    const resRegistro = await client.query<{ id: number }>(
      `
      INSERT INTO manutencao_registro (
        decisao, regra_aplicada, origem, iniciado_em, finalizado_em, resultado
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id;
      `,
      [decisao, regraAplicada, origem, inicio, fim, "SUCESSO"],
    );

    const registroId = resRegistro.rows[0].id;

    await salvarEstatisticasManutencao(client, registroId, "ANTES", estatisticasAntes);
    await salvarEstatisticasManutencao(client, registroId, "DEPOIS", estatisticasDepois);

    return {
      sucesso: true,
      registroId,
      acao: decisao,
      regra: regraAplicada,
      origem,
      iniciadoEm: inicio,
      finalizadoEm: fim,
      estatisticas: { antes: estatisticasAntes, depois: estatisticasDepois },
    };
  } catch (erro) {
    const fim = new Date();
    const e = erro as Error;
    const mensagemErro = "Falha ao executar manutenção.";
    const detalheTecnico = e.message;

    // Registra a falha no histórico (se a conexão existir).
    try {
      await client.query(
        `
        INSERT INTO manutencao_registro (
          decisao, regra_aplicada, origem, iniciado_em, finalizado_em, resultado
        )
        VALUES ($1, $2, $3, $4, $5, $6);
        `,
        [decisao, `ERRO: ${e.message}`, origem, inicio, fim, "FALHA"],
      );
    } catch (erroHistorico) {
      console.error(
        "Não foi possível registrar a falha no histórico de manutenção:",
        (erroHistorico as Error).message,
      );
    }

    try {
      await registrarLog({
        configBanco,
        etapa: "MANUTENCAO",
        nivel: "ERRO",
        mensagem: mensagemErro,
        parametros: { ...parametrosLog, decisao, regraAplicada },
        saidaTecnica: detalheTecnico,
      });
    } catch (erroLog) {
      console.error(
        "Não foi possível preservar o log da falha de manutenção:",
        (erroLog as Error).message,
      );
    }

    try {
      await simularEnvioEmail({
        etapa: "MANUTENCAO",
        nivel: "ERRO",
        mensagem: mensagemErro,
        saidaTecnica: detalheTecnico,
      });
    } catch (erroEmail) {
      console.error(
        "Não foi possível realizar a simulação de envio do e-mail:",
        (erroEmail as Error).message,
      );
    }

    throw new Error(`Falha ao executar manutenção: ${e.message}`);
  } finally {
    try {
      await client.end();
    } catch (erroFechamento) {
      console.error(
        "Erro ao encerrar conexão da manutenção:",
        (erroFechamento as Error).message,
      );
    }
  }
}
