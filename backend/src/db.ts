import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// lê o .env que está na raiz do repositório (uma pasta acima de backend)
dotenv.config({ path: resolve(__dirname, '../../.env') });

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase exige SSL
});