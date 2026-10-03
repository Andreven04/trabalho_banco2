import fs from "node:fs";
import path from "node:path";
import type { EntradaEmail } from "../types";

export interface ResultadoEmail {
  sucesso: boolean;
  simulacao: boolean;
  destinatario: string;
  assunto: string;
  arquivo: string;
  mensagem: string;
}

/**
 * Simula o envio de um log por e-mail (RF12).
 *
 * Em vez de enviar um e-mail real, grava um arquivo com todas
 * as informações que seriam enviadas — uma simulação comprovável.
 */
export async function simularEnvioEmail({
  destinatario = "equipe@empresa.local",
  assunto = "Falha no processo de backup",
  etapa,
  nivel,
  mensagem,
  saidaTecnica,
}: EntradaEmail): Promise<ResultadoEmail> {
  const pastaEmail = path.join(__dirname, "../../logs/email");

  if (!fs.existsSync(pastaEmail)) {
    fs.mkdirSync(pastaEmail, { recursive: true });
  }

  const dataHora = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const nomeArquivo = `email_${dataHora}.txt`;
  const caminhoArquivo = path.join(pastaEmail, nomeArquivo);

  const conteudo = `
SIMULAÇÃO DE ENVIO DE E-MAIL
========================================

Data: ${new Date().toLocaleString("pt-BR")}

Destinatário: ${destinatario}
Assunto: ${assunto}

Etapa: ${etapa}
Nível: ${nivel}

Mensagem:
${mensagem}

Saída técnica:
${saidaTecnica || "Nenhuma informação técnica disponível."}

========================================
Este arquivo representa uma simulação
comprovável do envio do log por e-mail.
`;

  fs.writeFileSync(caminhoArquivo, conteudo, "utf8");

  return {
    sucesso: true,
    simulacao: true,
    destinatario,
    assunto,
    arquivo: caminhoArquivo,
    mensagem: "Simulação de envio de e-mail realizada com sucesso.",
  };
}
