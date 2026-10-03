import fs from "node:fs";
import path from "node:path";
import { criarCliente } from "../config/database";
import type { EntradaLog } from "../types";

const CAMPOS_SENSIVEIS = [
  "senha",
  "password",
  "pgpassword",
  "senhazip",
  "chavecriptografia",
  "chavedescriptografia",
  "authorization",
  "token",
];

/**
 * Remove recursivamente valores de campos sensíveis (RNF01).
 */
function sanitizarDados(dados: unknown): unknown {
  if (dados === null || dados === undefined) {
    return dados;
  }

  if (Array.isArray(dados)) {
    return dados.map((item) => sanitizarDados(item));
  }

  if (typeof dados !== "object") {
    return dados;
  }

  const copia: Record<string, unknown> = {};

  for (const [chave, valor] of Object.entries(dados as Record<string, unknown>)) {
    const chaveNormalizada = chave.toLowerCase().replace(/[_\-\s]/g, "");
    const campoSensivel = CAMPOS_SENSIVEIS.some((campo) =>
      chaveNormalizada.includes(campo),
    );

    copia[chave] = campoSensivel ? "[DADO_PROTEGIDO]" : sanitizarDados(valor);
  }

  return copia;
}

export interface ResultadoLog {
  sucesso: boolean;
  logId?: number;
  criadoEm?: Date;
  fallback: boolean;
  arquivo?: string;
}

/**
 * Cria um arquivo local de emergência quando não é possível
 * registrar o log no banco (RNF05: preserva o log detalhado).
 */
function registrarLogEmArquivo({
  etapa,
  nivel,
  mensagem,
  parametros = null,
  saidaTecnica = null,
}: {
  etapa: string;
  nivel: string;
  mensagem: string;
  parametros?: unknown;
  saidaTecnica?: string | null;
}): ResultadoLog {
  const pastaLogs = path.join(__dirname, "../../logs/falhas");

  if (!fs.existsSync(pastaLogs)) {
    fs.mkdirSync(pastaLogs, { recursive: true });
  }

  const data = new Date();
  const dataHoraArquivo = data.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const nomeArquivo = `falha_${etapa}_${dataHoraArquivo}.txt`;
  const caminhoArquivo = path.join(pastaLogs, nomeArquivo);

  const conteudo = `
LOG DE FALHA
========================================

Data:
${data.toLocaleString("pt-BR")}

Etapa:
${etapa}

Nível:
${nivel}

Mensagem:
${mensagem}

Parâmetros não sensíveis:
${parametros ? JSON.stringify(parametros, null, 2) : "Nenhum parâmetro informado."}

Saída técnica:
${saidaTecnica || "Nenhuma informação técnica disponível."}

========================================
Este arquivo foi criado como fallback
porque não foi possível registrar o log
no banco de dados.
`;

  fs.writeFileSync(caminhoArquivo, conteudo, "utf8");

  return { sucesso: true, fallback: true, arquivo: caminhoArquivo };
}

/**
 * Registra um evento na tabela log_evento.
 *
 * IMPORTANTE: nunca enviar senha, chave de criptografia ou
 * senha do ZIP nos parâmetros — são sanitizados por garantia.
 */
export async function registrarLog({
  configBanco,
  execucaoId = null,
  etapa,
  nivel = "INFO",
  mensagem,
  parametros = null,
  saidaTecnica = null,
}: EntradaLog): Promise<ResultadoLog> {
  const client = criarCliente(configBanco);
  const parametrosSeguros = sanitizarDados(parametros);

  let mensagemComParametros = mensagem;
  if (parametrosSeguros) {
    mensagemComParametros += `\nParâmetros não sensíveis: ${JSON.stringify(
      parametrosSeguros,
    )}`;
  }

  try {
    await client.connect();

    const resultado = await client.query<{ id: number; criado_em: Date }>(
      `
      INSERT INTO log_evento (execucao_id, etapa, nivel, mensagem, saida_tecnica)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, criado_em;
      `,
      [execucaoId, etapa, nivel, mensagemComParametros, saidaTecnica],
    );

    return {
      sucesso: true,
      logId: resultado.rows[0].id,
      criadoEm: resultado.rows[0].criado_em,
      fallback: false,
    };
  } catch (erroBanco) {
    const e = erroBanco as Error;
    console.error("Não foi possível registrar o log no banco:", e.message);

    return registrarLogEmArquivo({
      etapa,
      nivel,
      mensagem,
      parametros: parametrosSeguros,
      saidaTecnica: `${saidaTecnica || ""}\nErro ao registrar no banco: ${e.message}`,
    });
  } finally {
    try {
      await client.end();
    } catch {
      // Não interrompe o processo.
    }
  }
}
