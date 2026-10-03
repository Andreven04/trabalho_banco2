// ============================================================
// Tipos compartilhados do backend
// ============================================================

/**
 * Configuração de conexão com um banco de dados alvo.
 * A plataforma é genérica: conecta em qualquer banco cujos
 * dados sejam informados (RF01 do documento de visão).
 */
export interface ConfigBanco {
  host?: string;
  porta?: number;
  database?: string;
  usuario?: string;
  senha?: string;
  /**
   * Habilita SSL. Necessário para bancos gerenciados como o
   * Supabase. Se não informado, é ativado automaticamente
   * quando o host aparenta ser do Supabase.
   */
  ssl?: boolean;
  /**
   * Lista de schemas (separados por vírgula) usada no
   * search_path da conexão. Padrão: "public".
   * Ex.: "loja,plataforma" para o banco da Aula 2.
   */
  schema?: string;
}

/** Configuração já validada e normalizada. */
export interface ConfigBancoValidada {
  host: string;
  porta: number;
  database: string;
  usuario: string;
  senha: string;
  ssl: boolean;
  schema: string;
}

/** Estatística de uma tabela coletada antes/depois da manutenção. */
export interface EstatisticaTabela {
  tabela: string;
  n_live_tup: number;
  n_dead_tup: number;
  tamanho_bytes: number;
  tamanho_formatado?: string;
}

/** Momento da coleta de estatísticas de manutenção. */
export type MomentoEstatistica = "ANTES" | "DEPOIS";

/** Origem da decisão de manutenção (respeita o CHECK do banco). */
export type OrigemManutencao = "auto" | "manual";

/** Payload do processo completo (manutenção + backup). */
export interface DadosProcesso {
  configBanco: ConfigBanco;
  escolhaExplicita?: boolean;
  manutencaoCompleta?: boolean;
  caminhoDestino?: string;
  compactar?: boolean;
  criptografar?: boolean;
  chaveCriptografia?: string;
  senhaZip?: string;
  quantidadeManter?: number | null;
  caminhoCopia?: string;
}

/** Entrada para o registro de log. */
export interface EntradaLog {
  configBanco: ConfigBanco;
  execucaoId?: number | null;
  etapa: string;
  nivel?: string;
  mensagem: string;
  parametros?: Record<string, unknown> | null;
  saidaTecnica?: string | null;
}

/** Entrada para a simulação de e-mail. */
export interface EntradaEmail {
  destinatario?: string;
  assunto?: string;
  etapa: string;
  nivel: string;
  mensagem: string;
  saidaTecnica?: string | null;
}
