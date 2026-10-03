import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFilePromise = promisify(execFile);

export interface ResultadoComando {
  sucesso: boolean;
  stdout?: string;
  stderr?: string;
  erro?: string;
}

/**
 * Executa um comando do sistema operacional de forma segura,
 * passando os argumentos isoladamente (evita injeção de comando).
 *
 * @param comando   Ex.: 'pg_dump' ou '7z'
 * @param argumentos Lista de argumentos isolados
 */
export async function executarComandoSeguro(
  comando: string,
  argumentos: string[] = [],
): Promise<ResultadoComando> {
  try {
    const { stdout, stderr } = await execFilePromise(comando, argumentos);
    return { sucesso: true, stdout, stderr };
  } catch (erro) {
    const e = erro as NodeJS.ErrnoException & { stderr?: string };
    return {
      sucesso: false,
      erro: e.message,
      stderr: e.stderr,
    };
  }
}
