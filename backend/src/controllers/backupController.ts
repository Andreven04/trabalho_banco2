import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import { criarCliente, verificarPermissoesBanco } from "../config/database";
import { decidirEExecutarManutencao } from "../services/manutencaoService";
import {
  gerarBackup,
  descriptografarArquivo,
  verificarIntegridadeBackup,
  restaurarBackup,
} from "../services/backupService";
import { executarChurn } from "../services/churnService";
import { gerarDados } from "../services/gerarDadosService";
import { registrarLog } from "../services/logService";
import { simularEnvioEmail } from "../services/emailService";
import type { ConfigBanco, DadosProcesso } from "../types";

// ============================================================
// FUNÇÕES AUXILIARES DE EXECUÇÃO
// ============================================================

async function criarExecucao(configBanco: ConfigBanco): Promise<{ id: number; iniciadoEm: Date }> {
  const client = criarCliente(configBanco);
  try {
    await client.connect();
    const resultado = await client.query<{ id: number; iniciado_em: Date }>(
      `
      INSERT INTO execucao (status, etapa_atual, resumo)
      VALUES ('EM_ANDAMENTO', 'INICIO', 'Processo de manutenção e backup iniciado.')
      RETURNING id, iniciado_em;
      `,
    );
    return { id: resultado.rows[0].id, iniciadoEm: resultado.rows[0].iniciado_em };
  } finally {
    try { await client.end(); } catch { /* ignora */ }
  }
}

async function atualizarExecucao(
  configBanco: ConfigBanco,
  execucaoId: number,
  status: string,
  etapaAtual: string,
  resumo: string,
): Promise<void> {
  const client = criarCliente(configBanco);
  try {
    await client.connect();
    await client.query(
      `
      UPDATE execucao
      SET status = $1::VARCHAR,
          etapa_atual = $2::VARCHAR,
          resumo = $3::TEXT,
          finalizado_em = CASE
            WHEN $1::VARCHAR IN ('CONCLUIDA', 'FALHA') THEN CURRENT_TIMESTAMP
            ELSE finalizado_em
          END
      WHERE id = $4::BIGINT;
      `,
      [status, etapaAtual, resumo, execucaoId],
    );
  } finally {
    try { await client.end(); } catch { /* ignora */ }
  }
}

async function atualizarEtapaAtual(
  configBanco: ConfigBanco,
  execucaoId: number,
  etapaAtual: string,
): Promise<void> {
  const client = criarCliente(configBanco);
  try {
    await client.connect();
    await client.query(
      `UPDATE execucao SET etapa_atual = $1::VARCHAR WHERE id = $2::BIGINT;`,
      [etapaAtual, execucaoId],
    );
  } finally {
    try { await client.end(); } catch { /* ignora */ }
  }
}

async function registrarEtapa(
  configBanco: ConfigBanco,
  execucaoId: number,
  etapa: string,
  ordem: number,
  status: string,
  mensagem: string | null,
): Promise<{ id: number; iniciado_em: Date }> {
  const client = criarCliente(configBanco);
  try {
    await client.connect();
    const resultado = await client.query<{ id: number; iniciado_em: Date }>(
      `
      INSERT INTO execucao_etapa (execucao_id, etapa, ordem, status, mensagem)
      VALUES ($1::BIGINT, $2::VARCHAR, $3::INTEGER, $4::VARCHAR, $5::TEXT)
      RETURNING id, iniciado_em;
      `,
      [execucaoId, etapa, ordem, status, mensagem || null],
    );
    return resultado.rows[0];
  } finally {
    try { await client.end(); } catch { /* ignora */ }
  }
}

async function finalizarEtapa(
  configBanco: ConfigBanco,
  etapaId: number,
  status: string,
  mensagem: string | null,
): Promise<void> {
  const client = criarCliente(configBanco);
  try {
    await client.connect();
    await client.query(
      `
      UPDATE execucao_etapa
      SET status = $1::VARCHAR, mensagem = $2::TEXT, finalizado_em = CURRENT_TIMESTAMP
      WHERE id = $3::BIGINT;
      `,
      [status, mensagem || null, etapaId],
    );
  } finally {
    try { await client.end(); } catch { /* ignora */ }
  }
}

async function associarManutencaoExecucao(
  configBanco: ConfigBanco,
  manutencaoId: number | null | undefined,
  execucaoId: number,
): Promise<void> {
  if (!manutencaoId) return;
  const client = criarCliente(configBanco);
  try {
    await client.connect();
    await client.query(
      `UPDATE manutencao_registro SET execucao_id = $1::BIGINT WHERE id = $2::BIGINT;`,
      [execucaoId, manutencaoId],
    );
  } finally {
    try { await client.end(); } catch { /* ignora */ }
  }
}

// ============================================================
// TESTE DE CONEXÃO
// ============================================================

export async function testarConexaoController(request: FastifyRequest, reply: FastifyReply) {
  const configBanco = request.body as ConfigBanco;
  const client = criarCliente(configBanco);

  try {
    await client.connect();
    await client.query("SELECT 1;");
    await client.end();

    return reply.send({
      sucesso: true,
      mensagem: `Conexão estabelecida com sucesso no banco '${configBanco.database}'!`,
    });
  } catch (err) {
    const e = err as Error;
    const mensagemErro = "Erro ao conectar ao PostgreSQL.";

    await registrarLog({
      configBanco,
      etapa: "CONEXAO",
      nivel: "ERRO",
      mensagem: mensagemErro,
      parametros: {
        host: configBanco.host || "localhost",
        porta: configBanco.porta || 5432,
        database: configBanco.database || "trabalho_banco2",
        usuario: configBanco.usuario || "postgres",
      },
      saidaTecnica: e.message,
    }).catch((erroLog) =>
      console.error("Não foi possível registrar o log da falha de conexão:", (erroLog as Error).message),
    );

    await simularEnvioEmail({
      etapa: "CONEXAO", nivel: "ERRO", mensagem: mensagemErro, saidaTecnica: e.message,
    }).catch((erroEmail) =>
      console.error("Não foi possível simular o envio do e-mail:", (erroEmail as Error).message),
    );

    return reply.status(500).send({
      sucesso: false, mensagem: mensagemErro, etapa: "CONEXAO", erro: e.message,
    });
  } finally {
    try { await client.end(); } catch { /* ignora */ }
  }
}

// ============================================================
// HISTÓRICO DE MANUTENÇÃO
// ============================================================

export async function consultarHistoricoManutencaoController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { configBanco } = request.body as { configBanco: ConfigBanco };
  const client = criarCliente(configBanco);

  try {
    await client.connect();
    const resultado = await client.query(`
      SELECT id, decisao, regra_aplicada, origem, iniciado_em, finalizado_em, resultado
      FROM manutencao_registro
      ORDER BY id DESC;
    `);
    return reply.send({ sucesso: true, dados: resultado.rows });
  } catch (err) {
    return reply.status(500).send({
      sucesso: false, mensagem: "Erro ao consultar histórico de manutenção.", erro: (err as Error).message,
    });
  } finally {
    try { await client.end(); } catch { /* ignora */ }
  }
}

// ============================================================
// HISTÓRICO DE EXECUÇÕES
// ============================================================

export async function consultarHistoricoExecucoesController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { configBanco } = request.body as { configBanco: ConfigBanco };
  const client = criarCliente(configBanco);

  try {
    await client.connect();
    const resultado = await client.query(`
      SELECT
        e.id, e.iniciado_em, e.finalizado_em, e.status, e.etapa_atual, e.resumo,
        CASE WHEN e.finalizado_em IS NOT NULL
          THEN EXTRACT(EPOCH FROM (e.finalizado_em - e.iniciado_em)) * 1000
          ELSE NULL END AS duracao_ms,
        mr.decisao AS decisao_manutencao,
        mr.regra_aplicada,
        mr.origem AS origem_manutencao,
        mr.resultado AS resultado_manutencao
      FROM execucao e
      LEFT JOIN manutencao_registro mr ON mr.execucao_id = e.id
      ORDER BY e.id DESC;
    `);
    return reply.send({ sucesso: true, dados: resultado.rows });
  } catch (err) {
    return reply.status(500).send({
      sucesso: false, mensagem: "Erro ao consultar histórico de execuções.", erro: (err as Error).message,
    });
  } finally {
    try { await client.end(); } catch { /* ignora */ }
  }
}

export async function consultarEtapasExecucaoController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { configBanco, execucaoId } = request.body as {
    configBanco: ConfigBanco; execucaoId?: number;
  };

  if (!execucaoId) {
    return reply.status(400).send({ sucesso: false, mensagem: "O ID da execução é obrigatório." });
  }

  const client = criarCliente(configBanco);
  try {
    await client.connect();
    const resultado = await client.query(
      `
      SELECT id, execucao_id, etapa, ordem, status, iniciado_em, finalizado_em, mensagem,
        CASE WHEN finalizado_em IS NOT NULL
          THEN EXTRACT(EPOCH FROM (finalizado_em - iniciado_em)) * 1000
          ELSE NULL END AS duracao_ms
      FROM execucao_etapa
      WHERE execucao_id = $1::BIGINT
      ORDER BY ordem ASC;
      `,
      [execucaoId],
    );
    return reply.send({ sucesso: true, dados: resultado.rows });
  } catch (err) {
    return reply.status(500).send({
      sucesso: false, mensagem: "Erro ao consultar etapas da execução.", erro: (err as Error).message,
    });
  } finally {
    try { await client.end(); } catch { /* ignora */ }
  }
}

// ============================================================
// CHURN
// ============================================================

export async function executarChurnController(request: FastifyRequest, reply: FastifyReply) {
  const { configBanco } = request.body as { configBanco: ConfigBanco };
  try {
    const resultado = await executarChurn(configBanco);
    return reply.send(resultado);
  } catch (err) {
    return reply.status(500).send({
      sucesso: false, mensagem: "Erro ao executar churn.", erro: (err as Error).message,
    });
  }
}

// ============================================================
// MANUTENÇÃO
// ============================================================

export async function executarManutencaoController(request: FastifyRequest, reply: FastifyReply) {
  const { configBanco, escolhaExplicita, manutencaoCompleta } = request.body as {
    configBanco: ConfigBanco; escolhaExplicita?: boolean; manutencaoCompleta?: boolean;
  };
  try {
    const resultado = await decidirEExecutarManutencao(configBanco, escolhaExplicita, manutencaoCompleta);
    return reply.send(resultado);
  } catch (err) {
    return reply.status(500).send({
      sucesso: false, mensagem: "Erro ao executar manutenção.", erro: (err as Error).message,
    });
  }
}

// ============================================================
// GERAÇÃO DE DADOS
// ============================================================

export async function gerarDadosController(request: FastifyRequest, reply: FastifyReply) {
  const { configBanco, tipo, quantidade } = request.body as {
    configBanco: ConfigBanco; tipo?: string; quantidade?: number;
  };
  try {
    if (!tipo) {
      return reply.status(400).send({ sucesso: false, mensagem: "O tipo de dado é obrigatório." });
    }
    if (!quantidade || quantidade <= 0) {
      return reply.status(400).send({ sucesso: false, mensagem: "A quantidade deve ser maior que zero." });
    }
    const resultado = await gerarDados(configBanco, tipo, Number(quantidade));
    return reply.send(resultado);
  } catch (err) {
    return reply.status(500).send({
      sucesso: false, mensagem: "Erro ao gerar dados.", erro: (err as Error).message,
    });
  }
}

// ============================================================
// PROCESSO COMPLETO (MANUTENÇÃO + BACKUP) — assíncrono
// ============================================================

async function executarProcessoEmSegundoPlano(
  dadosProcesso: DadosProcesso,
  execucaoId: number,
): Promise<void> {
  const {
    configBanco, escolhaExplicita, manutencaoCompleta,
    caminhoDestino, compactar, criptografar, chaveCriptografia,
    senhaZip, quantidadeManter, caminhoCopia,
  } = dadosProcesso;

  let etapaManutencaoId: number | null = null;
  let etapaBackupId: number | null = null;

  try {
    // 0. Permissões
    await verificarPermissoesBanco(configBanco);

    // 1. Manutenção
    await atualizarEtapaAtual(configBanco, execucaoId, "MANUTENCAO");
    const etapaManutencao = await registrarEtapa(
      configBanco, execucaoId, "MANUTENCAO", 1, "EM_ANDAMENTO", "Execução da manutenção iniciada.",
    );
    etapaManutencaoId = etapaManutencao.id;

    const manutencaoRes = await decidirEExecutarManutencao(configBanco, escolhaExplicita, manutencaoCompleta);
    await associarManutencaoExecucao(configBanco, manutencaoRes.registroId, execucaoId);
    await finalizarEtapa(configBanco, etapaManutencaoId, "CONCLUIDA", manutencaoRes.acao || "Manutenção concluída.");

    // 2. Backup
    await atualizarEtapaAtual(configBanco, execucaoId, "GERACAO_BACKUP");
    const etapaBackup = await registrarEtapa(
      configBanco, execucaoId, "GERACAO_BACKUP", 2, "EM_ANDAMENTO", "Geração do backup iniciada.",
    );
    etapaBackupId = etapaBackup.id;

    const destino = caminhoDestino || path.join(__dirname, "../../backups");
    const backupRes = await gerarBackup(
      configBanco, destino,
      compactar, criptografar, chaveCriptografia, senhaZip,
      quantidadeManter ?? null, caminhoCopia, execucaoId,
    );
    await finalizarEtapa(
      configBanco, etapaBackupId, "CONCLUIDA",
      (backupRes.mensagem as string) || "Backup concluído.",
    );

    // 3. Finaliza
    await atualizarExecucao(
      configBanco, execucaoId, "CONCLUIDA", "FINALIZADO",
      "Processo de manutenção e backup concluído com sucesso.",
    );
    console.log(`Execução #${execucaoId} concluída com sucesso.`);
  } catch (err) {
    const mensagemErro = (err as Error).message || "";

    if (mensagemErro.includes("permissão CONNECT") || mensagemErro.includes("permissão USAGE")) {
      await atualizarExecucao(
        configBanco, execucaoId, "FALHA", "VALIDACAO_PERMISSOES",
        `Falha na validação de permissões: ${mensagemErro}`,
      ).catch((e) => console.error("Não foi possível registrar a falha de permissões:", (e as Error).message));
      return;
    }

    let etapa = "PROCESSO";
    if (mensagemErro.includes("pg_dump")) etapa = "GERACAO_BACKUP";
    else if (mensagemErro.includes("criptograf")) etapa = "CRIPTOGRAFIA";
    else if (mensagemErro.includes("compact")) etapa = "COMPACTACAO";
    else if (mensagemErro.includes("retenção")) etapa = "RETENCAO";
    else if (mensagemErro.includes("cópia secundária")) etapa = "COPIA_SECUNDARIA";
    else if (mensagemErro.includes("manutenção")) etapa = "MANUTENCAO";

    try {
      if (etapaManutencaoId) {
        await finalizarEtapa(
          configBanco, etapaManutencaoId,
          etapa === "MANUTENCAO" ? "FALHA" : "CONCLUIDA",
          etapa === "MANUTENCAO" ? mensagemErro : "Manutenção concluída.",
        );
      }
      if (etapaBackupId) {
        await finalizarEtapa(
          configBanco, etapaBackupId,
          etapa !== "MANUTENCAO" ? "FALHA" : "CONCLUIDA",
          etapa !== "MANUTENCAO" ? mensagemErro : "Backup não iniciado.",
        );
      }
    } catch (erroEtapa) {
      console.error("Não foi possível atualizar a etapa da execução:", (erroEtapa as Error).message);
    }

    await atualizarExecucao(
      configBanco, execucaoId, "FALHA", etapa,
      `Processo interrompido na etapa ${etapa}: ${mensagemErro}`,
    ).catch((e) => console.error("Não foi possível atualizar a execução como falha:", (e as Error).message));

    console.error(`Execução #${execucaoId} falhou na etapa ${etapa}:`, mensagemErro);
  }
}

export async function iniciarProcessoController(request: FastifyRequest, reply: FastifyReply) {
  const dadosProcesso = request.body as DadosProcesso;
  const { configBanco } = dadosProcesso;

  try {
    if (!configBanco) {
      return reply.status(400).send({ sucesso: false, mensagem: "A configuração do banco deve ser informada." });
    }

    await verificarPermissoesBanco(configBanco);
    const execucao = await criarExecucao(configBanco);

    // Roda em segundo plano (não aguarda).
    executarProcessoEmSegundoPlano(dadosProcesso, execucao.id).catch((erro) =>
      console.error(`Erro inesperado na execução #${execucao.id}:`, (erro as Error).message),
    );

    return reply.status(202).send({
      sucesso: true,
      mensagem: "Processo iniciado e continuará sendo executado em segundo plano.",
      execucaoId: execucao.id,
      status: "EM_ANDAMENTO",
    });
  } catch (erro) {
    const mensagemErro = (erro as Error).message || "";
    if (mensagemErro.includes("permissão CONNECT") || mensagemErro.includes("permissão USAGE")) {
      return reply.status(403).send({
        sucesso: false,
        mensagem: "O usuário do PostgreSQL não possui as permissões necessárias.",
        etapa: "VALIDACAO_PERMISSOES",
        erro: mensagemErro,
      });
    }
    return reply.status(500).send({
      sucesso: false, mensagem: "Não foi possível iniciar o processo.", erro: mensagemErro,
    });
  }
}

export async function consultarStatusExecucaoController(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { configBanco, execucaoId } = request.body as {
    configBanco: ConfigBanco; execucaoId?: number;
  };

  if (!configBanco) {
    return reply.status(400).send({ sucesso: false, mensagem: "A configuração do banco deve ser informada." });
  }
  if (!execucaoId) {
    return reply.status(400).send({ sucesso: false, mensagem: "O ID da execução é obrigatório." });
  }

  const client = criarCliente(configBanco);
  try {
    await client.connect();

    const resultadoExecucao = await client.query(
      `SELECT id, iniciado_em, finalizado_em, status, etapa_atual, resumo FROM execucao WHERE id = $1::BIGINT;`,
      [execucaoId],
    );

    if (resultadoExecucao.rows.length === 0) {
      return reply.status(404).send({ sucesso: false, mensagem: "Execução não encontrada." });
    }

    const resultadoEtapas = await client.query(
      `
      SELECT id, execucao_id, etapa, ordem, status, iniciado_em, finalizado_em, mensagem
      FROM execucao_etapa
      WHERE execucao_id = $1::BIGINT
      ORDER BY ordem ASC;
      `,
      [execucaoId],
    );

    return reply.send({
      sucesso: true,
      execucao: resultadoExecucao.rows[0],
      etapas: resultadoEtapas.rows,
    });
  } catch (erro) {
    return reply.status(500).send({
      sucesso: false, mensagem: "Erro ao consultar o status da execução.", erro: (erro as Error).message,
    });
  } finally {
    try { await client.end(); } catch { /* ignora */ }
  }
}

// ============================================================
// DESCRIPTOGRAFIA
// ============================================================

export async function descriptografarBackupController(request: FastifyRequest, reply: FastifyReply) {
  const { caminhoArquivo, chaveCriptografia } = request.body as {
    caminhoArquivo?: string; chaveCriptografia?: string;
  };
  try {
    if (!caminhoArquivo) {
      return reply.status(400).send({ sucesso: false, mensagem: "O caminho do arquivo é obrigatório." });
    }
    if (!chaveCriptografia) {
      return reply.status(400).send({ sucesso: false, mensagem: "A chave de criptografia é obrigatória." });
    }
    const resultado = await descriptografarArquivo(caminhoArquivo, chaveCriptografia);
    return reply.send(resultado);
  } catch (err) {
    return reply.status(500).send({
      sucesso: false, mensagem: "Erro ao descriptografar o backup.", erro: (err as Error).message,
    });
  }
}

// ============================================================
// INTEGRIDADE / RESTAURAÇÃO
// ============================================================

export async function verificarIntegridadeBackupController(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { configBanco, backupId } = request.body as { configBanco: ConfigBanco; backupId?: number };
    if (!configBanco) {
      return reply.status(400).send({ sucesso: false, mensagem: "A configuração do banco deve ser informada." });
    }
    if (!backupId) {
      return reply.status(400).send({ sucesso: false, mensagem: "O ID do backup deve ser informado." });
    }
    const resultado = await verificarIntegridadeBackup({ configBanco, backupId });
    return reply.send(resultado);
  } catch (erro) {
    return reply.status(500).send({
      sucesso: false, mensagem: "Erro ao verificar a integridade do backup.", erro: (erro as Error).message,
    });
  }
}

export async function restaurarBackupController(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { configBanco, backupId, bancoDestino } = request.body as {
      configBanco: ConfigBanco; backupId?: number; bancoDestino?: string;
    };
    if (!configBanco) {
      return reply.status(400).send({ sucesso: false, mensagem: "A configuração do banco deve ser informada." });
    }
    if (!backupId) {
      return reply.status(400).send({ sucesso: false, mensagem: "O ID do backup deve ser informado." });
    }
    if (!bancoDestino) {
      return reply.status(400).send({ sucesso: false, mensagem: "O banco de destino deve ser informado." });
    }
    const resultado = await restaurarBackup({ configBanco, backupId, bancoDestino });
    return reply.send(resultado);
  } catch (erro) {
    return reply.status(500).send({
      sucesso: false, mensagem: "Erro ao restaurar o backup.", erro: (erro as Error).message,
    });
  }
}
