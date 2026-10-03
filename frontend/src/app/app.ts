import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { finalize } from 'rxjs';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class AppComponent implements OnInit {
  // ==============================
  // CONFIGURAÇÃO DO BANCO
  // ==============================

  configBanco = {
    host: 'aws-0-us-west-2.pooler.supabase.com',
    porta: 5432,
    database: 'postgres',
    usuario: 'postgres.bjtxivfirolgjpvcuhse',
    senha: '',
    schema: 'loja,plataforma',
    ssl: true,
  };

  // ==============================
  // STATUS / PROCESSO
  // ==============================

  etapaFalha = '';
  mensagemFalha = '';

  escolhaExplicita = false;
  manutencaoCompleta = false;

  // Tipo de manutenção escolhida pelo usuário
  // 'vacuum' = VACUUM
  // 'full' = VACUUM FULL ANALYZE
  tipoManutencao = 'vacuum';

  caminhoDestino = '';

  criptografar = false;
  chaveCriptografia = '';

  compactar = false;
  senhaZip = '';

  caminhoCopia = '';
  quantidadeManter: number | null = null;

  // ==============================
  // DESCRIPTOGRAFIA
  // ==============================

  arquivoCriptografado = '';
  chaveDescriptografia = '';
  resultadoDescriptografia: any = null;

  // ==============================
  // INTEGRIDADE DO BACKUP
  // ==============================

  backupIdIntegridade: number | null = null;
  resultadoIntegridade: any = null;
  verificandoIntegridade = false;

  // ==============================
  // RESTAURAÇÃO DE BACKUP
  // ==============================

  backupIdRestauracao: number | null = null;
  bancoDestinoRestauracao = 'trabalho_banco2_restore';
  resultadoRestauracao: any = null;
  restaurandoBackup = false;

  // ==============================
  // CONEXÃO
  // ==============================

  statusConexao = '';
  conectado = false;
  carregando = false;

  // ==============================
  // CHURN
  // ==============================

  mensagemChurn = '';

  // ==============================
  // GERAÇÃO DE DADOS
  // ==============================

  tipoDado = 'produto';
  quantidadeDados = 10;
  mensagemDados = '';
  carregandoDados = false;

  // ==============================
  // RESULTADOS
  // ==============================

  resultadoManutencao: any = null;
  resultadoProcesso: any = null;

  // ==============================
  // ACOMPANHAMENTO ASSÍNCRONO
  // ==============================

  execucaoAtualId: number | null = null;
  statusExecucaoAtual = '';
  etapaExecucaoAtual = '';
  resumoExecucaoAtual = '';
  etapasExecucaoAtual: any[] = [];

  private intervaloStatus: any = null;

  // ==============================
  // VERIFICAR INTEGRIDADE DO BACKUP
  // ==============================

  verificarIntegridade() {
    if (!this.backupIdIntegridade || this.backupIdIntegridade <= 0) {
      this.resultadoIntegridade = {
        sucesso: false,
        mensagem: 'Informe um ID de backup válido.',
      };

      return;
    }

    this.verificandoIntegridade = true;
    this.resultadoIntegridade = null;

    const payload = {
      configBanco: this.configBanco,
      backupId: this.backupIdIntegridade,
    };

    this.http.post<any>(`${this.API_URL}/backup/verificar-integridade`, payload).pipe(finalize(() => this.cdr.detectChanges())).subscribe({
      next: (res) => {
        this.resultadoIntegridade = res;

        this.verificandoIntegridade = false;
      },

      error: (err) => {
        this.resultadoIntegridade = {
          sucesso: false,
          mensagem:
            err.error?.erro || err.error?.mensagem || 'Erro ao verificar a integridade do backup.',
        };

        this.verificandoIntegridade = false;
      },
    });
  }

  // ==============================
  // RESTAURAR BACKUP
  // ==============================

  restaurarBackup() {
    if (!this.backupIdRestauracao || this.backupIdRestauracao <= 0) {
      this.resultadoRestauracao = {
        sucesso: false,
        mensagem: 'Informe um ID de backup válido.',
      };

      return;
    }

    if (!this.bancoDestinoRestauracao.trim()) {
      this.resultadoRestauracao = {
        sucesso: false,
        mensagem: 'Informe o nome do banco de destino.',
      };

      return;
    }

    this.restaurandoBackup = true;
    this.resultadoRestauracao = null;

    const payload = {
      configBanco: this.configBanco,
      backupId: this.backupIdRestauracao,
      bancoDestino: this.bancoDestinoRestauracao.trim(),
    };

    this.http.post<any>(`${this.API_URL}/backup/restaurar`, payload).pipe(finalize(() => this.cdr.detectChanges())).subscribe({
      next: (res) => {
        this.resultadoRestauracao = res;
        this.restaurandoBackup = false;
      },

      error: (err) => {
        this.resultadoRestauracao = {
          sucesso: false,
          mensagem: err.error?.erro || err.error?.mensagem || 'Erro ao restaurar o backup.',
        };

        this.restaurandoBackup = false;
      },
    });
  }

  // ==============================
  // HISTÓRICO DE MANUTENÇÃO
  // ==============================

  historicoManutencao: any[] = [];

  // ==============================
  // HISTÓRICO DE EXECUÇÕES
  // ==============================

  historicoExecucoes: any[] = [];

  // Execução atualmente selecionada
  execucaoSelecionada: any = null;

  // Etapas da execução selecionada
  etapasExecucao: any[] = [];

  // Indica carregamento das etapas
  carregandoEtapas = false;

  // ==============================
  // API
  // ==============================

  private readonly API_URL = 'http://localhost:3000/api';

  constructor(private http: HttpClient, private cdr: ChangeDetectorRef) {}

  // ==============================
  // INICIALIZAÇÃO
  // ==============================

  ngOnInit() {
    // Não consulta o banco ao abrir a tela: sem uma conexão válida
    // (ex.: senha ainda em branco), isso geraria falhas de autenticação
    // e poderia bloquear novas conexões no Supabase (circuit breaker).
    // Os históricos são carregados após o "Testar Conexão" dar certo.
  }

  // ==============================
  // TESTAR CONEXÃO
  // ==============================

  testarConexao() {
    this.carregando = true;
    this.statusConexao = 'Testando conexão...';

    this.http.post<any>(`${this.API_URL}/conexao/testar`, this.configBanco).pipe(finalize(() => this.cdr.detectChanges())).subscribe({
      next: (res) => {
        this.conectado = true;
        this.statusConexao = res.mensagem;
        this.carregando = false;

        // Conexão válida: agora sim carrega os históricos.
        this.carregarHistorico();
        this.carregarHistoricoExecucoes();
      },

      error: (err) => {
        this.conectado = false;

        this.statusConexao = err.error?.mensagem || 'Erro ao conectar ao PostgreSQL.';

        this.carregando = false;
      },
    });
  }

  // ==============================
  // CHURN
  // ==============================

  simularChurn() {
    this.carregando = true;
    this.mensagemChurn = '';

    this.http
      .post<any>(`${this.API_URL}/churn/executar`, {
        configBanco: this.configBanco,
      })
      .pipe(finalize(() => this.cdr.detectChanges())).subscribe({
        next: (res) => {
          this.mensagemChurn = res.mensagem || 'Churn executado com sucesso.';

          this.carregando = false;
        },

        error: (err) => {
          this.mensagemChurn = err.error?.mensagem || 'Erro ao executar o Churn de dados.';

          this.carregando = false;
        },
      });
  }

  // ==============================
  // GERAÇÃO DE DADOS
  // ==============================

  gerarDados() {
    this.carregandoDados = true;
    this.mensagemDados = '';

    if (!this.quantidadeDados || this.quantidadeDados <= 0) {
      this.mensagemDados = 'Informe uma quantidade maior que zero.';

      this.carregandoDados = false;
      return;
    }

    const payload = {
      configBanco: this.configBanco,
      tipo: this.tipoDado,
      quantidade: Number(this.quantidadeDados),
    };

    this.http.post<any>(`${this.API_URL}/dados/inserir`, payload).pipe(finalize(() => this.cdr.detectChanges())).subscribe({
      next: (res) => {
        this.mensagemDados = res.mensagem || 'Dados adicionados com sucesso.';

        this.carregandoDados = false;
      },

      error: (err) => {
        this.mensagemDados = err.error?.mensagem || 'Erro ao adicionar os dados.';

        this.carregandoDados = false;
      },
    });
  }

  // ==============================
  // ESCOLHA DA MANUTENÇÃO
  // ==============================

  selecionarManutencao(tipo: string) {
    this.tipoManutencao = tipo;

    // O backend usa esta variável para decidir
    // entre VACUUM e VACUUM FULL ANALYZE.
    this.manutencaoCompleta = tipo === 'full';
  }

  // ==============================
  // EXECUTAR MANUTENÇÃO
  // ==============================

  executarManutencao() {
    this.carregando = true;

    const payload = {
      configBanco: this.configBanco,
      escolhaExplicita: this.escolhaExplicita,
      manutencaoCompleta: this.manutencaoCompleta,
    };

    this.http.post<any>(`${this.API_URL}/manutencao/executar`, payload).pipe(finalize(() => this.cdr.detectChanges())).subscribe({
      next: (res) => {
        this.resultadoManutencao = res;
        this.resultadoProcesso = res;

        this.carregando = false;

        this.carregarHistorico();
        this.carregarHistoricoExecucoes();
      },

      error: (err) => {
        alert('Erro ao executar manutenção: ' + (err.error?.mensagem || err.message));

        this.carregando = false;
      },
    });
  }

  // ==============================
  // EXECUTAR PROCESSO COMPLETO
  // ==============================

  executarBackupCompleto() {
    this.carregando = true;

    this.etapaFalha = '';
    this.mensagemFalha = '';

    this.resultadoProcesso = null;

    this.execucaoAtualId = null;
    this.statusExecucaoAtual = '';
    this.etapaExecucaoAtual = '';
    this.resumoExecucaoAtual = '';
    this.etapasExecucaoAtual = [];

    // Garante que não exista polling antigo.
    this.pararAcompanhamentoExecucao();

    const payload = {
      configBanco: this.configBanco,
      escolhaExplicita: this.escolhaExplicita,
      manutencaoCompleta: this.manutencaoCompleta,

      caminhoDestino: this.caminhoDestino,

      criptografar: this.criptografar,
      chaveCriptografia: this.chaveCriptografia,

      compactar: this.compactar,
      senhaZip: this.senhaZip,

      caminhoCopia: this.caminhoCopia,

      quantidadeManter: this.quantidadeManter,
    };

    this.http.post<any>(`${this.API_URL}/processo/iniciar`, payload).pipe(finalize(() => this.cdr.detectChanges())).subscribe({
      next: (res) => {
        /*
         * O backend agora responde rapidamente
         * com HTTP 202 e o ID da execução.
         */
        this.execucaoAtualId = Number(res.execucaoId);

        this.statusExecucaoAtual = res.status || 'EM_ANDAMENTO';

        this.etapaExecucaoAtual = 'INICIO';

        this.resumoExecucaoAtual = res.mensagem || 'Processo iniciado em segundo plano.';

        this.resultadoProcesso = {
          sucesso: true,
          mensagem: 'Processo iniciado. Acompanhando execução...',
          execucaoId: this.execucaoAtualId,
          status: this.statusExecucaoAtual,
        };

        /*
         * Começa a consultar o backend.
         */
        this.iniciarAcompanhamentoExecucao();
      },

      error: (err) => {
        this.etapaFalha = err.error?.etapa || 'INICIO';

        this.mensagemFalha =
          err.error?.erro ||
          err.error?.mensagem ||
          err.message ||
          'Não foi possível iniciar o processo.';

        this.resultadoProcesso = {
          sucesso: false,
          etapa: this.etapaFalha,
          mensagem: this.mensagemFalha,
        };

        this.carregando = false;

        this.pararAcompanhamentoExecucao();
      },
    });
  }

  // ==============================
  // INICIAR ACOMPANHAMENTO
  // ==============================

  iniciarAcompanhamentoExecucao() {
    if (!this.execucaoAtualId) {
      return;
    }

    // Faz uma consulta imediatamente.
    this.consultarStatusExecucao();

    // Depois consulta novamente a cada 1 segundo.
    this.intervaloStatus = setInterval(() => {
      this.consultarStatusExecucao();
    }, 1000);
  }

  // ==============================
  // CONSULTAR STATUS DA EXECUÇÃO
  // ==============================

  consultarStatusExecucao() {
    if (!this.execucaoAtualId) {
      return;
    }

    const payload = {
      configBanco: this.configBanco,
      execucaoId: this.execucaoAtualId,
    };

    this.http.post<any>(`${this.API_URL}/processo/status`, payload).pipe(finalize(() => this.cdr.detectChanges())).subscribe({
      next: (res) => {
        if (!res.sucesso || !res.execucao) {
          return;
        }

        const execucao = res.execucao;

        this.statusExecucaoAtual = execucao.status || '';

        this.etapaExecucaoAtual = execucao.etapa_atual || '';

        this.resumoExecucaoAtual = execucao.resumo || '';

        this.etapasExecucaoAtual = res.etapas || [];

        /*
         * PROCESSO CONCLUÍDO
         */
        if (execucao.status === 'CONCLUIDA') {
          this.resultadoProcesso = {
            sucesso: true,
            mensagem: execucao.resumo || 'Processo concluído com sucesso.',
            execucaoId: execucao.id,
            status: execucao.status,
            etapas: res.etapas,
          };

          this.carregando = false;

          this.pararAcompanhamentoExecucao();

          this.carregarHistorico();
          this.carregarHistoricoExecucoes();

          return;
        }

        /*
         * PROCESSO COM FALHA
         */
        if (execucao.status === 'FALHA') {
          this.etapaFalha = execucao.etapa_atual || 'PROCESSO';

          this.mensagemFalha = execucao.resumo || 'O processo foi interrompido.';

          this.resultadoProcesso = {
            sucesso: false,
            mensagem: this.mensagemFalha,
            execucaoId: execucao.id,
            status: execucao.status,
            etapa: this.etapaFalha,
            etapas: res.etapas,
          };

          this.carregando = false;

          this.pararAcompanhamentoExecucao();

          this.carregarHistorico();
          this.carregarHistoricoExecucoes();
        }
      },

      error: (err) => {
        console.error('Erro ao consultar status da execução:', err);
      },
    });
  }

  // ==============================
  // PARAR ACOMPANHAMENTO
  // ==============================

  pararAcompanhamentoExecucao() {
    if (this.intervaloStatus) {
      clearInterval(this.intervaloStatus);
      this.intervaloStatus = null;
    }
  }

  // ==============================
  // DESCRIPTOGRAFAR BACKUP
  // ==============================

  descriptografarBackup() {
    this.carregando = true;

    this.resultadoDescriptografia = null;

    if (!this.arquivoCriptografado) {
      this.resultadoDescriptografia = {
        sucesso: false,
        mensagem: 'Informe o caminho do arquivo .sql.enc.',
      };

      this.carregando = false;

      return;
    }

    if (!this.chaveDescriptografia) {
      this.resultadoDescriptografia = {
        sucesso: false,
        mensagem: 'Informe a chave de criptografia.',
      };

      this.carregando = false;

      return;
    }

    const payload = {
      caminhoArquivo: this.arquivoCriptografado,

      chaveCriptografia: this.chaveDescriptografia,
    };

    this.http.post<any>(`${this.API_URL}/backup/descriptografar`, payload).pipe(finalize(() => this.cdr.detectChanges())).subscribe({
      next: (res) => {
        this.resultadoDescriptografia = res;

        this.carregando = false;
      },

      error: (err) => {
        this.resultadoDescriptografia = {
          sucesso: false,

          mensagem: err.error?.mensagem || 'Erro ao descriptografar o arquivo.',

          erro: err.error?.erro || err.message,
        };

        this.carregando = false;
      },
    });
  }

  // ==============================
  // HISTÓRICO DE MANUTENÇÃO
  // ==============================

  carregarHistorico() {
    this.http
      .post<any>(`${this.API_URL}/manutencao/historico`, {
        configBanco: this.configBanco,
      })
      .pipe(finalize(() => this.cdr.detectChanges())).subscribe({
        next: (res) => {
          if (res.sucesso) {
            this.historicoManutencao = res.dados;
          }
        },

        error: (err) => {
          console.error('Erro ao carregar histórico de manutenção:', err);
        },
      });
  }

  // ==============================
  // HISTÓRICO DE EXECUÇÕES
  // ==============================

  carregarHistoricoExecucoes() {
    this.http
      .post<any>(`${this.API_URL}/processo/historico`, {
        configBanco: this.configBanco,
      })
      .pipe(finalize(() => this.cdr.detectChanges())).subscribe({
        next: (res) => {
          if (res.sucesso) {
            this.historicoExecucoes = res.dados;

            // Se já existe uma execução selecionada,
            // tenta atualizar os dados dela.
            if (this.execucaoSelecionada) {
              const execucaoAtualizada = this.historicoExecucoes.find(
                (execucao) => execucao.id === this.execucaoSelecionada.id,
              );

              if (execucaoAtualizada) {
                this.execucaoSelecionada = execucaoAtualizada;
              }
            }
          }
        },

        error: (err) => {
          console.error('Erro ao carregar histórico de execuções:', err);
        },
      });
  }

  // ==============================
  // SELECIONAR EXECUÇÃO
  // ==============================

  selecionarExecucao(execucao: any) {
    this.execucaoSelecionada = execucao;

    this.carregarEtapasExecucao(execucao.id);
  }

  // ==============================
  // CARREGAR ETAPAS DA EXECUÇÃO
  // ==============================

  carregarEtapasExecucao(execucaoId: number) {
    this.carregandoEtapas = true;

    this.etapasExecucao = [];

    this.http
      .post<any>(`${this.API_URL}/processo/etapas`, {
        configBanco: this.configBanco,
        execucaoId: execucaoId,
      })
      .pipe(finalize(() => this.cdr.detectChanges())).subscribe({
        next: (res) => {
          if (res.sucesso) {
            this.etapasExecucao = res.dados;
          }

          this.carregandoEtapas = false;
        },

        error: (err) => {
          console.error('Erro ao carregar etapas da execução:', err);

          this.carregandoEtapas = false;
        },
      });
  }

  // ==============================
  // FECHAR DETALHES DA EXECUÇÃO
  // ==============================

  fecharDetalhesExecucao() {
    this.execucaoSelecionada = null;

    this.etapasExecucao = [];
  }
}