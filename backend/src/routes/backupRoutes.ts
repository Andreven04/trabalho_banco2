import type { FastifyInstance } from "fastify";
import {
  testarConexaoController,
  consultarHistoricoManutencaoController,
  consultarHistoricoExecucoesController,
  consultarEtapasExecucaoController,
  consultarStatusExecucaoController,
  executarChurnController,
  executarManutencaoController,
  iniciarProcessoController,
  descriptografarBackupController,
  gerarDadosController,
  verificarIntegridadeBackupController,
  restaurarBackupController,
} from "../controllers/backupController";

export async function backupRoutes(fastify: FastifyInstance): Promise<void> {
  // Teste de conexão
  fastify.post("/api/conexao/testar", testarConexaoController);

  // Churn
  fastify.post("/api/churn/executar", executarChurnController);

  // Geração de dados
  fastify.post("/api/dados/inserir", gerarDadosController);

  // Manutenção
  fastify.post("/api/manutencao/executar", executarManutencaoController);
  fastify.post("/api/manutencao/historico", consultarHistoricoManutencaoController);

  // Processo completo (manutenção + backup)
  fastify.post("/api/processo/iniciar", iniciarProcessoController);
  fastify.post("/api/processo/historico", consultarHistoricoExecucoesController);
  fastify.post("/api/processo/etapas", consultarEtapasExecucaoController);
  fastify.post("/api/processo/status", consultarStatusExecucaoController);

  // Backup: descriptografia, integridade e restauração
  fastify.post("/api/backup/descriptografar", descriptografarBackupController);
  fastify.post("/api/backup/verificar-integridade", verificarIntegridadeBackupController);
  fastify.post("/api/backup/restaurar", restaurarBackupController);
}
