import Fastify from 'fastify';
import cors from '@fastify/cors';
import { rotasConexao } from './conexao';

const app = Fastify({ logger: true });

app.register(cors, { origin: true }); // libera o frontend Angular
app.register(rotasConexao);

const PORT = Number(process.env.PORT) || 3000;

app.listen({ port: PORT, host: '0.0.0.0' })
  .then(() => console.log(`Backend rodando em http://localhost:${PORT}`))
  .catch((err) => { app.log.error(err); process.exit(1); });