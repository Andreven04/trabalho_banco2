import Fastify from "fastify";
import cors from "@fastify/cors";
import * as dotenv from "dotenv";
import { resolve } from "node:path";
import { backupRoutes } from "./routes/backupRoutes";

// Lê o .env da raiz do repositório (uma pasta acima de backend).
dotenv.config({ path: resolve(__dirname, "../../.env") });

const app = Fastify({
  logger: {
    // Protege campos sensíveis nos logs (RNF01).
    redact: {
      paths: [
        "req.body.senha",
        "req.body.configBanco.senha",
        "req.body.chaveCriptografia",
        "req.body.chaveDescriptografia",
        "req.body.senhaZip",
      ],
      censor: "[DADO_PROTEGIDO]",
    },
  },
});

// Libera o CORS para o Angular.
app.register(cors, {
  origin: process.env.CORS_ORIGIN || "http://localhost:4200",
  methods: ["GET", "POST", "PUT", "DELETE"],
});

app.register(backupRoutes);

const PORT = Number(process.env.PORT) || 3000;

app
  .listen({ port: PORT, host: "0.0.0.0" })
  .then(() => console.log(`🚀 Backend Fastify rodando em http://localhost:${PORT}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
