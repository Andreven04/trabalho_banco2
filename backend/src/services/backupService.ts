import { execFile } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import sevenBin from "7zip-bin";
import {
  criarCliente,
  validarConfiguracaoBanco,
  verificarPermissoesBanco,
} from "../config/database";
import { registrarLog } from "./logService";
import { simularEnvioEmail } from "./emailService";
import type { ConfigBanco } from "../types";

export { verificarPermissoesBanco };

const PASTA_BACKUPS = path.resolve(__dirname, "../../backups");

/**
 * Diretório dos binários do PostgreSQL (pg_dump/psql).
 * Configurável via .env (PG_BIN). O padrão cobre a instalação
 * típica do PostgreSQL 18 no Windows.
 */
const PG_BIN =
  process.env.PG_BIN || "C:\\Program Files\\PostgreSQL\\18\\bin";
const CAMINHO_PG_DUMP = path.join(PG_BIN, "pg_dump");
const CAMINHO_PSQL = path.join(PG_BIN, "psql");

// ============================================================
// VALIDAÇÕES DE CAMINHO / RETENÇÃO
// ============================================================

function validarCaminhoDestino(caminho: string, nomeCampo: string): string {
  if (!caminho || typeof caminho !== "string") {
    throw new Error(`${nomeCampo} deve ser informado.`);
  }

  const caminhoResolvido = path.resolve(caminho);
  const estaDentroDaPasta =
    caminhoResolvido === PASTA_BACKUPS ||
    caminhoResolvido.startsWith(`${PASTA_BACKUPS}${path.sep}`);

  if (!estaDentroDaPasta) {
    throw new Error(
      `${nomeCampo} inválido. O caminho deve estar dentro da pasta de backups.`,
    );
  }

  return caminhoResolvido;
}

function validarQuantidadeRetencao(
  quantidadeManter: number | null | undefined | string,
): number | null {
  if (quantidadeManter === null || quantidadeManter === undefined || quantidadeManter === "") {
    return null;
  }

  const quantidade = Number(quantidadeManter);
  if (!Number.isInteger(quantidade) || quantidade < 1) {
    throw new Error(
      "A quantidade de retenção deve ser um número inteiro maior que zero.",
    );
  }

  return quantidade;
}

/** Lista de argumentos -n para restringir o dump aos schemas. */
function argumentosSchema(schema: string): string[] {
  return schema
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => ["-n", s]);
}

// ============================================================
// COMPACTAÇÃO (ZIP, opcionalmente com senha AES256)
// ============================================================

interface ResultadoZip {
  caminhoZip: string;
  tamanhoBytes: number;
  protegidoPorSenha: boolean;
}

async function compactarArquivo(caminhoArquivo: string, senhaZip = ""): Promise<ResultadoZip> {
  return new Promise((resolve, reject) => {
    const caminhoZip = caminhoArquivo
      .replace(/\.enc$/i, ".zip")
      .replace(/\.sql$/i, ".zip");

    const argumentos = ["a", "-tzip", caminhoZip, caminhoArquivo];

    if (senhaZip) {
      argumentos.push(`-p${senhaZip}`);
      argumentos.push("-mem=AES256");
    }

    execFile(sevenBin.path7za, argumentos, (erro, _stdout, stderr) => {
      if (erro) {
        return reject(new Error(`Erro ao criar arquivo ZIP: ${stderr || erro.message}`));
      }

      try {
        const stats = fs.statSync(caminhoZip);
        resolve({
          caminhoZip,
          tamanhoBytes: stats.size,
          protegidoPorSenha: Boolean(senhaZip),
        });
      } catch (erroArquivo) {
        reject(erroArquivo);
      }
    });
  });
}

// ============================================================
// CRIPTOGRAFIA AES-256-GCM
// ============================================================

interface ResultadoCriptografia {
  caminhoCriptografado: string;
  tamanhoBytes: number;
}

async function criptografarArquivo(
  caminhoArquivo: string,
  senha: string,
): Promise<ResultadoCriptografia> {
  return new Promise((resolve, reject) => {
    try {
      if (!senha) {
        return reject(new Error("Uma chave de criptografia deve ser informada."));
      }

      const caminhoCriptografado = `${caminhoArquivo}.enc`;
      const salt = crypto.randomBytes(16);
      const iv = crypto.randomBytes(12);
      const chave = crypto.pbkdf2Sync(senha, salt, 100000, 32, "sha256");
      const cipher = crypto.createCipheriv("aes-256-gcm", chave, iv);

      const entrada = fs.createReadStream(caminhoArquivo);
      const saida = fs.createWriteStream(caminhoCriptografado);

      // Cabeçalho: SALT (16) + IV (12); depois o conteúdo; ao final o authTag (16).
      saida.write(salt);
      saida.write(iv);

      entrada.on("error", reject);
      saida.on("error", reject);

      entrada.on("data", (chunk) => {
        saida.write(cipher.update(chunk));
      });

      entrada.on("end", () => {
        try {
          const finalizado = cipher.final();
          if (finalizado.length > 0) {
            saida.write(finalizado);
          }
          saida.write(cipher.getAuthTag());
          saida.end();

          saida.on("close", () => {
            const stats = fs.statSync(caminhoCriptografado);
            resolve({ caminhoCriptografado, tamanhoBytes: stats.size });
          });
        } catch (erro) {
          reject(erro);
        }
      });
    } catch (erro) {
      reject(erro);
    }
  });
}

// ============================================================
// RETENÇÃO
// ============================================================

interface ResultadoRetencao {
  aplicada: boolean;
  quantidadeMantida: number | null;
  totalEncontrados?: number;
  removidos: { nome: string; caminho: string }[];
}

async function aplicarRetencao(
  caminhoDestino: string,
  quantidadeManter: number | null | undefined,
): Promise<ResultadoRetencao> {
  if (quantidadeManter === null || quantidadeManter === undefined || quantidadeManter <= 0) {
    return { aplicada: false, quantidadeMantida: null, removidos: [] };
  }

  const quantidade = Number(quantidadeManter);
  if (!Number.isInteger(quantidade) || quantidade < 1) {
    throw new Error("A quantidade de retenção deve ser um número inteiro maior que zero.");
  }

  if (!fs.existsSync(caminhoDestino)) {
    return { aplicada: true, quantidadeMantida: quantidade, removidos: [] };
  }

  const arquivos = fs
    .readdirSync(caminhoDestino)
    .filter((nome) => /^backup_.+\.(sql|zip|sql\.enc)$/i.test(nome))
    .map((nome) => {
      const caminhoCompleto = path.join(caminhoDestino, nome);
      const stats = fs.statSync(caminhoCompleto);
      return { nome, caminho: caminhoCompleto, dataModificacao: stats.mtimeMs };
    })
    .sort((a, b) => b.dataModificacao - a.dataModificacao);

  const arquivosParaRemover = arquivos.slice(quantidade);
  const removidos: { nome: string; caminho: string }[] = [];

  for (const arquivo of arquivosParaRemover) {
    fs.unlinkSync(arquivo.caminho);
    removidos.push({ nome: arquivo.nome, caminho: arquivo.caminho });
  }

  return {
    aplicada: true,
    quantidadeMantida: quantidade,
    totalEncontrados: arquivos.length,
    removidos,
  };
}

// ============================================================
// INTEGRIDADE (SHA-256)
// ============================================================

async function calcularChecksumSHA256(caminhoArquivo: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!caminhoArquivo || typeof caminhoArquivo !== "string") {
      return reject(new Error("O caminho do arquivo para cálculo do checksum é inválido."));
    }

    const caminhoValidado = path.resolve(caminhoArquivo);
    if (!fs.existsSync(caminhoValidado)) {
      return reject(new Error("O arquivo para cálculo do checksum não foi encontrado."));
    }

    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(caminhoValidado);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", (erro) =>
      reject(new Error(`Erro ao calcular checksum SHA-256: ${erro.message}`)),
    );
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export interface ResultadoIntegridade {
  sucesso: boolean;
  backupId: number;
  caminho: string;
  integro: boolean;
  checksumRegistrado: string;
  checksumAtual: string;
  mensagem: string;
}

export async function verificarIntegridadeBackup({
  configBanco,
  backupId,
}: {
  configBanco: ConfigBanco;
  backupId: number;
}): Promise<ResultadoIntegridade> {
  if (!backupId) {
    throw new Error("O ID do backup deve ser informado.");
  }

  const client = criarCliente(configBanco);

  try {
    await client.connect();

    const resultado = await client.query<{
      id: number;
      caminho: string;
      checksum_sha256: string | null;
    }>(
      `SELECT id, caminho, checksum_sha256 FROM backup_arquivo WHERE id = $1::BIGINT;`,
      [backupId],
    );

    if (resultado.rows.length === 0) {
      throw new Error("Backup não encontrado no banco de dados.");
    }

    const backup = resultado.rows[0];
    if (!backup.checksum_sha256) {
      throw new Error("Este backup não possui checksum SHA-256 registrado.");
    }
    if (!fs.existsSync(backup.caminho)) {
      throw new Error("O arquivo físico do backup não foi encontrado.");
    }

    const checksumAtual = await calcularChecksumSHA256(backup.caminho);
    const integro = checksumAtual === backup.checksum_sha256;

    return {
      sucesso: true,
      backupId: backup.id,
      caminho: backup.caminho,
      integro,
      checksumRegistrado: backup.checksum_sha256,
      checksumAtual,
      mensagem: integro
        ? "O backup está íntegro."
        : "O backup foi alterado ou está corrompido.",
    };
  } finally {
    try {
      await client.end();
    } catch {
      // ignora
    }
  }
}

// ============================================================
// RESTAURAÇÃO (cria um novo banco e restaura via psql)
// ============================================================

export async function restaurarBackup({
  configBanco,
  backupId,
  bancoDestino,
}: {
  configBanco: ConfigBanco;
  backupId: number;
  bancoDestino: string;
}) {
  if (!backupId) {
    throw new Error("O ID do backup deve ser informado.");
  }
  if (!bancoDestino || typeof bancoDestino !== "string") {
    throw new Error("O nome do banco de destino deve ser informado.");
  }

  const configValidada = validarConfiguracaoBanco(configBanco);
  const nomeBancoDestino = bancoDestino.trim();

  if (!/^[a-zA-Z0-9_]+$/.test(nomeBancoDestino)) {
    throw new Error("O nome do banco de destino contém caracteres inválidos.");
  }
  if (nomeBancoDestino.toLowerCase() === configValidada.database.toLowerCase()) {
    throw new Error("Não é permitido restaurar o backup sobre o banco de dados original.");
  }

  // 1. Verifica a integridade antes de restaurar.
  const integridade = await verificarIntegridadeBackup({ configBanco, backupId });
  if (!integridade.integro) {
    throw new Error(
      "A restauração foi cancelada porque o backup está alterado ou corrompido.",
    );
  }

  const caminhoBackup = path.resolve(integridade.caminho);
  if (!/\.sql$/i.test(caminhoBackup)) {
    throw new Error(
      "A restauração automática atualmente aceita somente backups SQL não compactados e não criptografados.",
    );
  }
  if (!fs.existsSync(caminhoBackup)) {
    throw new Error("O arquivo físico do backup não foi encontrado.");
  }

  // 2. Conecta no banco 'postgres' para criar o banco de destino.
  const clientAdmin = criarCliente({ ...configBanco, database: "postgres" });

  try {
    await clientAdmin.connect();

    const resultadoPermissao = await clientAdmin.query<{
      rolcreatedb: boolean;
      rolsuper: boolean;
    }>(`SELECT rolcreatedb, rolsuper FROM pg_roles WHERE rolname = current_user;`);

    const permissao = resultadoPermissao.rows[0];
    if (!permissao || (!permissao.rolcreatedb && !permissao.rolsuper)) {
      throw new Error(
        "O usuário do PostgreSQL não possui permissão para criar o banco de restauração.",
      );
    }

    const bancoExistente = await clientAdmin.query(
      `SELECT 1 FROM pg_database WHERE datname = $1;`,
      [nomeBancoDestino],
    );
    if (bancoExistente.rows.length > 0) {
      throw new Error(`O banco de destino '${nomeBancoDestino}' já existe. Escolha outro nome.`);
    }

    // Nome já validado com regex — seguro para interpolar.
    await clientAdmin.query(`CREATE DATABASE "${nomeBancoDestino}"`);
  } finally {
    try {
      await clientAdmin.end();
    } catch {
      // ignora
    }
  }

  // 2b. Remove o schema public padrão do banco recém-criado para evitar
  //     conflito com o "CREATE SCHEMA public" que o dump pode conter
  //     (restauração de um banco qualquer, cujo dump inclui o public).
  const clientPrep = criarCliente({ ...configBanco, database: nomeBancoDestino });
  try {
    await clientPrep.connect();
    await clientPrep.query(`DROP SCHEMA IF EXISTS public CASCADE;`);
  } finally {
    try { await clientPrep.end(); } catch { /* ignora */ }
  }

  // 3. Restaura via psql.
  const argumentos = [
    "-h", configValidada.host,
    "-p", String(configValidada.porta),
    "-U", configValidada.usuario,
    "-d", nomeBancoDestino,
    "-v", "ON_ERROR_STOP=1",
    "-f", caminhoBackup,
  ];

  const env = { ...process.env, PGPASSWORD: configValidada.senha };

  await new Promise<void>((resolve, reject) => {
    execFile(CAMINHO_PSQL, argumentos, { env, windowsHide: true }, (erro, _stdout, stderr) => {
      if (erro) {
        return reject(new Error(`Falha ao restaurar o backup: ${stderr || erro.message}`));
      }
      resolve();
    });
  });

  // 4. Confere os dados restaurados.
  const clientRestaurado = criarCliente({ ...configBanco, database: nomeBancoDestino });

  try {
    await clientRestaurado.connect();

    // Atualiza as estatísticas do banco restaurado para que a contagem
    // reflita as linhas recém-carregadas (sem ANALYZE, n_live_tup vem 0).
    await clientRestaurado.query(`ANALYZE;`);

    // Conferência genérica: funciona em QUALQUER banco (RF01). Conta as
    // tabelas e as linhas estimadas por schema no banco restaurado, em vez
    // de depender de tabelas fixas de um domínio específico.
    const resultado = await clientRestaurado.query(`
      SELECT
        schemaname AS schema,
        COUNT(*)::int AS tabelas,
        COALESCE(SUM(n_live_tup), 0)::bigint AS linhas_estimadas
      FROM pg_stat_user_tables
      GROUP BY schemaname
      ORDER BY schemaname;
    `);

    return {
      sucesso: true,
      mensagem: "Backup restaurado e dados verificados com sucesso.",
      backupId: integridade.backupId,
      integridade: {
        integro: integridade.integro,
        checksumSHA256: integridade.checksumAtual,
      },
      restauracao: {
        bancoOriginal: configValidada.database,
        bancoDestino: nomeBancoDestino,
        arquivo: caminhoBackup,
      },
      verificacaoDados: resultado.rows,
    };
  } finally {
    try {
      await clientRestaurado.end();
    } catch {
      // ignora
    }
  }
}

// ============================================================
// REGISTRO DO BACKUP
// ============================================================

async function registrarBackupArquivo({
  configBanco,
  execucaoId = null,
  caminho,
  tamanhoBytes,
  criptografado,
  compactado,
  checksumSHA256,
}: {
  configBanco: ConfigBanco;
  execucaoId?: number | null;
  caminho: string;
  tamanhoBytes: number;
  criptografado: boolean;
  compactado: boolean;
  checksumSHA256: string;
}) {
  if (!execucaoId) {
    return {
      registrado: false,
      execucaoId: null,
      mensagem: "Backup gerado sem ID de execução.",
    };
  }

  const client = criarCliente(configBanco);

  try {
    await client.connect();

    const resultado = await client.query(
      `
      INSERT INTO backup_arquivo (
        execucao_id, caminho, tamanho_bytes, criptografado, compactado, checksum_sha256
      )
      VALUES ($1::BIGINT, $2::VARCHAR, $3::BIGINT, $4::BOOLEAN, $5::BOOLEAN, $6::VARCHAR)
      RETURNING id, execucao_id, caminho, tamanho_bytes, criptografado, compactado, checksum_sha256, criado_em;
      `,
      [execucaoId, caminho, tamanhoBytes, Boolean(criptografado), Boolean(compactado), checksumSHA256],
    );

    return { registrado: true, dados: resultado.rows[0] };
  } finally {
    try {
      await client.end();
    } catch {
      // ignora
    }
  }
}

// ============================================================
// CÓPIA SECUNDÁRIA
// ============================================================

async function copiarBackupSecundario(caminhoArquivo: string, caminhoCopia: string) {
  if (!caminhoCopia) {
    return { aplicada: false, mensagem: "Cópia secundária não configurada." };
  }

  const caminhoCopiaValidado = validarCaminhoDestino(caminhoCopia, "Caminho da cópia secundária");

  if (!fs.existsSync(caminhoArquivo)) {
    throw new Error("O arquivo de backup não foi encontrado para realizar a cópia secundária.");
  }

  if (!fs.existsSync(caminhoCopiaValidado)) {
    fs.mkdirSync(caminhoCopiaValidado, { recursive: true });
  }

  const nomeArquivo = path.basename(caminhoArquivo);
  const caminhoDestino = path.join(caminhoCopiaValidado, nomeArquivo);
  fs.copyFileSync(caminhoArquivo, caminhoDestino);
  const stats = fs.statSync(caminhoDestino);

  return {
    aplicada: true,
    mensagem: "Cópia secundária realizada com sucesso.",
    arquivo: { nome: nomeArquivo, caminho: caminhoDestino, tamanhoBytes: stats.size },
  };
}

// ============================================================
// GERAÇÃO DO BACKUP (pg_dump + etapas opcionais)
// ============================================================

export async function gerarBackup(
  configBanco: ConfigBanco,
  caminhoDestino: string,
  compactar = false,
  criptografar = false,
  chaveCriptografia = "",
  senhaZip = "",
  quantidadeManter: number | null = null,
  caminhoCopia = "",
  execucaoId: number | null = null,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let pastaDestino: string;
    const configBancoValidada = (() => {
      try {
        return validarConfiguracaoBanco(configBanco);
      } catch (e) {
        reject(e);
        return null;
      }
    })();

    if (!configBancoValidada) return;

    try {
      pastaDestino = caminhoDestino
        ? validarCaminhoDestino(caminhoDestino, "Caminho de destino")
        : PASTA_BACKUPS;

      validarQuantidadeRetencao(quantidadeManter);

      if (caminhoCopia) {
        validarCaminhoDestino(caminhoCopia, "Caminho da cópia secundária");
      }
    } catch (erroValidacao) {
      return reject(erroValidacao);
    }

    if (!fs.existsSync(pastaDestino)) {
      fs.mkdirSync(pastaDestino, { recursive: true });
    }

    const dataHora = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const nomeArquivo = `backup_${configBancoValidada.database}_${dataHora}.sql`;
    const caminhoCompleto = path.join(pastaDestino, nomeArquivo);

    const args = [
      "-h", configBancoValidada.host,
      "-p", String(configBancoValidada.porta),
      "-U", configBancoValidada.usuario,
      ...argumentosSchema(configBancoValidada.schema),
      "-F", "p",
      "-f", caminhoCompleto,
      configBancoValidada.database,
    ];

    const env = { ...process.env, PGPASSWORD: configBancoValidada.senha };
    const inicio = new Date();

    execFile(CAMINHO_PG_DUMP, args, { env }, async (erro, _stdout, stderr) => {
      const fim = new Date();

      if (erro) {
        const mensagemErro = "Falha ao executar pg_dump.";
        const detalheTecnico = stderr || erro.message;

        try {
          await registrarLog({
            configBanco,
            execucaoId,
            etapa: "GERACAO_BACKUP",
            nivel: "ERRO",
            mensagem: mensagemErro,
            parametros: {
              banco: configBancoValidada.database,
              host: configBancoValidada.host,
              porta: configBancoValidada.porta,
              destinoConfigurado: Boolean(caminhoDestino),
              criptografar: Boolean(criptografar),
              compactar: Boolean(compactar),
              retencaoConfigurada: quantidadeManter !== null && quantidadeManter !== undefined,
              copiaSecundariaConfigurada: Boolean(caminhoCopia),
            },
            saidaTecnica: detalheTecnico,
          });
        } catch (erroLog) {
          console.error("Não foi possível registrar o log da falha:", (erroLog as Error).message);
        }

        try {
          await simularEnvioEmail({
            etapa: "GERACAO_BACKUP",
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

        return reject(new Error(`${mensagemErro} ${detalheTecnico}`));
      }

      try {
        let caminhoAtual = caminhoCompleto;
        let nomeAtual = nomeArquivo;
        let tipoAtual = "SQL";

        // 1. Criptografia
        if (criptografar) {
          try {
            const res = await criptografarArquivo(caminhoAtual, chaveCriptografia);
            fs.unlinkSync(caminhoAtual);
            caminhoAtual = res.caminhoCriptografado;
            nomeAtual = path.basename(caminhoAtual);
            tipoAtual = "AES-256";
          } catch (erroCripto) {
            const detalhe = (erroCripto as Error).message;
            await registrarLog({
              configBanco, execucaoId, etapa: "CRIPTOGRAFIA", nivel: "ERRO",
              mensagem: "Falha ao criptografar o backup.",
              parametros: { criptografar: true, algoritmo: "AES-256-GCM", pbkdf2: true },
              saidaTecnica: detalhe,
            }).catch(() => {});
            await simularEnvioEmail({
              etapa: "CRIPTOGRAFIA", nivel: "ERRO",
              mensagem: "Falha ao criptografar o backup.", saidaTecnica: detalhe,
            }).catch(() => {});
            throw new Error(`Falha na etapa de criptografia: ${detalhe}`);
          }
        }

        // 2. Compactação
        if (compactar) {
          try {
            const res = await compactarArquivo(caminhoAtual, senhaZip);
            fs.unlinkSync(caminhoAtual);
            caminhoAtual = res.caminhoZip;
            nomeAtual = path.basename(caminhoAtual);
            tipoAtual = criptografar ? "ZIP + AES-256" : "ZIP";
          } catch (erroZip) {
            const detalhe = (erroZip as Error).message;
            await registrarLog({
              configBanco, execucaoId, etapa: "COMPACTACAO", nivel: "ERRO",
              mensagem: "Falha ao compactar o backup em ZIP.",
              parametros: { compactar: true, senhaZipInformada: Boolean(senhaZip), criptografar: Boolean(criptografar) },
              saidaTecnica: detalhe,
            }).catch(() => {});
            await simularEnvioEmail({
              etapa: "COMPACTACAO", nivel: "ERRO",
              mensagem: "Falha ao compactar o backup em ZIP.", saidaTecnica: detalhe,
            }).catch(() => {});
            throw new Error(`Falha na etapa de compactação: ${detalhe}`);
          }
        }

        // 3. Retenção
        let resultadoRetencao: ResultadoRetencao;
        try {
          resultadoRetencao = await aplicarRetencao(pastaDestino, quantidadeManter);
        } catch (erroRet) {
          const detalhe = (erroRet as Error).message;
          await registrarLog({
            configBanco, execucaoId, etapa: "RETENCAO", nivel: "ERRO",
            mensagem: "Falha ao aplicar a retenção dos backups.",
            parametros: { quantidadeManter, retencaoAtivada: quantidadeManter != null },
            saidaTecnica: detalhe,
          }).catch(() => {});
          await simularEnvioEmail({
            etapa: "RETENCAO", nivel: "ERRO",
            mensagem: "Falha ao aplicar a retenção dos backups.", saidaTecnica: detalhe,
          }).catch(() => {});
          throw new Error(`Falha na etapa de retenção: ${detalhe}`);
        }

        // 4. Cópia secundária
        let resultadoCopia: unknown;
        try {
          resultadoCopia = await copiarBackupSecundario(caminhoAtual, caminhoCopia);
        } catch (erroCopia) {
          const detalhe = (erroCopia as Error).message;
          await registrarLog({
            configBanco, execucaoId, etapa: "COPIA_SECUNDARIA", nivel: "ERRO",
            mensagem: "Falha ao realizar a cópia secundária do backup.",
            parametros: { copiaSecundariaConfigurada: Boolean(caminhoCopia) },
            saidaTecnica: detalhe,
          }).catch(() => {});
          await simularEnvioEmail({
            etapa: "COPIA_SECUNDARIA", nivel: "ERRO",
            mensagem: "Falha ao realizar a cópia secundária do backup.", saidaTecnica: detalhe,
          }).catch(() => {});
          throw new Error(`Falha na etapa de cópia secundária: ${detalhe}`);
        }

        // 5. Resultado final + checksum
        const statsFinal = fs.statSync(caminhoAtual);
        const checksumSHA256 = await calcularChecksumSHA256(caminhoAtual);

        let mensagem: string;
        if (criptografar && compactar) {
          mensagem = "Backup gerado, criptografado com AES-256 e compactado com sucesso!";
        } else if (criptografar) {
          mensagem = "Backup gerado e criptografado com AES-256!";
        } else if (compactar) {
          mensagem = "Backup gerado e compactado com sucesso!";
        } else {
          mensagem = "Backup gerado com sucesso via pg_dump!";
        }

        // 6. Registro do backup
        let registroBackup: unknown = null;
        try {
          registroBackup = await registrarBackupArquivo({
            configBanco, execucaoId,
            caminho: caminhoAtual,
            tamanhoBytes: statsFinal.size,
            criptografado: criptografar,
            compactado: compactar,
            checksumSHA256,
          });
        } catch (erroRegistro) {
          console.error(
            "Não foi possível registrar o backup na tabela backup_arquivo:",
            (erroRegistro as Error).message,
          );
        }

        resolve({
          sucesso: true,
          mensagem,
          arquivo: {
            nome: nomeAtual,
            caminho: caminhoAtual,
            tamanhoBytes: statsFinal.size,
            checksumSHA256,
            tipo: tipoAtual,
            criadoEm: fim,
            duracaoMs: fim.getTime() - inicio.getTime(),
          },
          retencao: resultadoRetencao,
          copiaSecundaria: resultadoCopia,
          registroBackup,
          execucaoId,
        });
      } catch (erroProcessamento) {
        reject(
          new Error(
            `Backup foi gerado, mas ocorreu um erro durante o processamento: ${(erroProcessamento as Error).message}`,
          ),
        );
      }
    });
  });
}

// ============================================================
// DESCRIPTOGRAFIA
// ============================================================

export async function descriptografarArquivo(caminhoArquivo: string, senha: string) {
  if (!senha) {
    throw new Error("Uma chave de criptografia deve ser informada.");
  }
  if (!caminhoArquivo || typeof caminhoArquivo !== "string") {
    throw new Error("O caminho do arquivo criptografado deve ser informado.");
  }

  const caminhoArquivoValidado = path.resolve(caminhoArquivo);
  const arquivoDentroDaPasta = caminhoArquivoValidado.startsWith(`${PASTA_BACKUPS}${path.sep}`);
  if (!arquivoDentroDaPasta) {
    throw new Error("Arquivo inválido. O arquivo deve estar dentro da pasta de backups.");
  }
  if (!/\.enc$/i.test(caminhoArquivoValidado)) {
    throw new Error("Arquivo inválido. A descriptografia deve utilizar um arquivo .enc.");
  }
  if (!fs.existsSync(caminhoArquivoValidado)) {
    throw new Error("O arquivo criptografado não foi encontrado.");
  }

  const dados = fs.readFileSync(caminhoArquivoValidado);
  const salt = dados.subarray(0, 16);
  const iv = dados.subarray(16, 28);
  const authTag = dados.subarray(dados.length - 16);
  const conteudoCriptografado = dados.subarray(28, dados.length - 16);

  const chave = crypto.pbkdf2Sync(senha, salt, 100000, 32, "sha256");
  const decipher = crypto.createDecipheriv("aes-256-gcm", chave, iv);
  decipher.setAuthTag(authTag);

  try {
    const conteudoOriginal = Buffer.concat([
      decipher.update(conteudoCriptografado),
      decipher.final(),
    ]);

    const caminhoDescriptografado = caminhoArquivoValidado.replace(/\.enc$/i, "");
    fs.writeFileSync(caminhoDescriptografado, conteudoOriginal);
    const stats = fs.statSync(caminhoDescriptografado);

    return {
      sucesso: true,
      mensagem: "Arquivo descriptografado com sucesso!",
      arquivo: {
        nome: path.basename(caminhoDescriptografado),
        caminho: caminhoDescriptografado,
        tamanhoBytes: stats.size,
      },
    };
  } catch {
    throw new Error("Não foi possível descriptografar o arquivo. Verifique a chave.");
  }
}