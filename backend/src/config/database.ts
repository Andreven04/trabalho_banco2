import { Client, type ClientConfig } from "pg";
import type { ConfigBanco, ConfigBancoValidada } from "../types";

/**
 * Valida e normaliza a configuração do banco de dados.
 */
export function validarConfiguracaoBanco(
  config: ConfigBanco | undefined | null,
): ConfigBancoValidada {
  if (!config || typeof config !== "object") {
    throw new Error("Configuração do banco de dados não informada.");
  }

  const host = config.host || "localhost";
  const porta = Number(config.porta || 5432);
  const database = config.database || "trabalho_banco2";
  const usuario = config.usuario || "postgres";
  const senha = config.senha ?? "";
  const schema = (config.schema || "public").trim();

  if (typeof host !== "string" || host.trim() === "") {
    throw new Error("O host do banco de dados é inválido.");
  }

  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    throw new Error("A porta do banco de dados é inválida.");
  }

  if (typeof database !== "string" || database.trim() === "") {
    throw new Error("O nome do banco de dados é inválido.");
  }

  if (!/^[a-zA-Z0-9_.-]+$/.test(database)) {
    throw new Error("O nome do banco de dados contém caracteres inválidos.");
  }

  if (typeof usuario !== "string" || usuario.trim() === "") {
    throw new Error("O usuário do banco de dados é inválido.");
  }

  if (typeof senha !== "string") {
    throw new Error("A senha do banco de dados é inválida.");
  }

  // SSL: explícito, ou automático quando o host é do Supabase.
  const ssl =
    typeof config.ssl === "boolean"
      ? config.ssl
      : /supabase\.(co|com)/i.test(host);

  return {
    host: host.trim(),
    porta,
    database: database.trim(),
    usuario: usuario.trim(),
    senha,
    ssl,
    schema: schema || "public",
  };
}

/**
 * Monta o ClientConfig do pg a partir da configuração validada,
 * já com SSL (quando necessário) e search_path por schema.
 */
function montarClientConfig(cfg: ConfigBancoValidada): ClientConfig {
  const schemas = cfg.schema
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(",");

  const clientConfig: ClientConfig = {
    host: cfg.host,
    port: cfg.porta,
    database: cfg.database,
    user: cfg.usuario,
    password: cfg.senha,
    // Define o search_path já na abertura da conexão, para que
    // as queries sem schema resolvam nos schemas certos
    // (ex.: loja,plataforma no banco da Aula 2).
    options: schemas ? `-c search_path=${schemas}` : undefined,
  };

  if (cfg.ssl) {
    // Supabase usa certificado gerenciado; não validamos a cadeia.
    clientConfig.ssl = { rejectUnauthorized: false };
  }

  return clientConfig;
}

/**
 * Cria um Client do pg pronto para conectar (não conecta ainda).
 */
export function criarCliente(config: ConfigBanco): Client {
  const cfg = validarConfiguracaoBanco(config);
  return new Client(montarClientConfig(cfg));
}

/**
 * Retorna o schema de domínio (o primeiro da lista de schemas).
 * Usado nas estatísticas de manutenção.
 */
export function schemaDominio(config: ConfigBanco): string {
  const cfg = validarConfiguracaoBanco(config);
  const primeiro = cfg.schema.split(",")[0]?.trim();
  return primeiro || "public";
}

/**
 * Testa a conexão executando um SELECT 1.
 */
export async function testarConexaoBanco(config: ConfigBanco): Promise<void> {
  const cfg = validarConfiguracaoBanco(config);
  const client = new Client({
    ...montarClientConfig(cfg),
    connectionTimeoutMillis: 5000,
  });

  await client.connect();
  await client.query("SELECT 1;");
  await client.end();
}

/**
 * Verifica permissões básicas (CONNECT no banco e USAGE no schema).
 */
export async function verificarPermissoesBanco(config: ConfigBanco): Promise<{
  possuiPermissoesBasicas: boolean;
  permissoes: { pode_conectar: boolean; pode_usar_schema: boolean };
}> {
  const cfg = validarConfiguracaoBanco(config);
  const schema = schemaDominio(config);

  const client = new Client({
    ...montarClientConfig(cfg),
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();

    const resultado = await client.query<{
      pode_conectar: boolean;
      pode_usar_schema: boolean;
    }>(
      `
      SELECT
        has_database_privilege(current_user, current_database(), 'CONNECT') AS pode_conectar,
        has_schema_privilege(current_user, $1, 'USAGE') AS pode_usar_schema;
      `,
      [schema],
    );

    const permissoes = resultado.rows[0];

    if (!permissoes.pode_conectar) {
      throw new Error(
        "O usuário do PostgreSQL não possui permissão CONNECT no banco de dados.",
      );
    }

    if (!permissoes.pode_usar_schema) {
      throw new Error(
        `O usuário do PostgreSQL não possui permissão USAGE no schema ${schema}.`,
      );
    }

    return { possuiPermissoesBasicas: true, permissoes };
  } finally {
    try {
      await client.end();
    } catch {
      // Não interrompe o processo.
    }
  }
}
