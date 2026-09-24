import { FastifyInstance } from 'fastify';
import { pool } from './db';

export async function rotasConexao(app: FastifyInstance) {
  app.get('/api/conexao/testar', async (_req, reply) => {
    try {
      const r = await pool.query('SELECT 1 AS ok');
      return reply.send({
        conectado: true,
        mensagem: 'Conexão estabelecida com o banco (Supabase).',
        resultado: r.rows[0].ok,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'erro desconhecido';
      return reply.status(500).send({ conectado: false, mensagem: msg });
    }
  });
}