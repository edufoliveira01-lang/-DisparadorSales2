import { db } from "../../db";
import { hojeSaoPaulo } from "../djen/cache";
import { somarMeses } from "./financeiro";

const somarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const mesValido = (m: unknown) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(String(m)) ? String(m) : hojeSaoPaulo().slice(0, 7));
const n = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { v: number }).v;

/** Indicadores de gestão. A parte de receita só é calculada para quem pode ver o financeiro. */
export function indicadores(mesBruto: unknown, incluirReceita: boolean) {
  const hoje = hojeSaoPaulo();
  const mes = mesValido(mesBruto), ini = `${mes}-01`, fim = somarMeses(ini, 1);
  const abertas = "status IN ('pendente','em_andamento')";

  const produtividade = (db.prepare("SELECT id, COALESCE(NULLIF(display_name,''),username) AS nome FROM users WHERE active=1 ORDER BY nome COLLATE NOCASE").all() as { id: number; nome: string }[]).map((u) => {
    const concluidas = n(`SELECT COUNT(*) v FROM gestao_tarefas WHERE responsavel_user_id=? AND concluida_em>=? AND concluida_em<?`, u.id, ini, fim);
    const comPrazo = n(`SELECT COUNT(*) v FROM gestao_tarefas WHERE responsavel_user_id=? AND concluida_em>=? AND concluida_em<? AND prazo IS NOT NULL`, u.id, ini, fim);
    const noPrazo = n(`SELECT COUNT(*) v FROM gestao_tarefas WHERE responsavel_user_id=? AND concluida_em>=? AND concluida_em<? AND prazo IS NOT NULL AND concluida_em<=prazo`, u.id, ini, fim);
    return {
      usuario_id: u.id, nome: u.nome,
      atribuidas: n(`SELECT COUNT(*) v FROM gestao_tarefas WHERE responsavel_user_id=? AND prazo>=? AND prazo<?`, u.id, ini, fim),
      concluidas, atrasadas: n(`SELECT COUNT(*) v FROM gestao_tarefas WHERE responsavel_user_id=? AND ${abertas} AND prazo<?`, u.id, hoje),
      no_prazo_percentual: comPrazo ? Math.round((noPrazo / comPrazo) * 100) : null,
      processos_ativos: n("SELECT COUNT(*) v FROM gestao_processos WHERE responsavel_user_id=? AND status='ativo'", u.id),
    };
  }).filter((p) => p.atribuidas + p.concluidas + p.atrasadas + p.processos_ativos > 0).sort((a, b) => b.concluidas - a.concluidas || a.nome.localeCompare(b.nome));

  const tarefas = {
    atribuidas: n("SELECT COUNT(*) v FROM gestao_tarefas WHERE prazo>=? AND prazo<?", ini, fim),
    concluidas: n("SELECT COUNT(*) v FROM gestao_tarefas WHERE concluida_em>=? AND concluida_em<?", ini, fim),
    atrasadas: n(`SELECT COUNT(*) v FROM gestao_tarefas WHERE ${abertas} AND prazo<?`, hoje),
    prazos_fatais_5_dias: n(`SELECT COUNT(*) v FROM gestao_tarefas WHERE ${abertas} AND prazo_fatal=1 AND prazo BETWEEN ? AND ?`, hoje, somarDias(hoje, 5)),
    sem_responsavel: n(`SELECT COUNT(*) v FROM gestao_tarefas WHERE ${abertas} AND responsavel_user_id IS NULL`),
  };

  const limiteParado = somarDias(hoje, -60);
  const parados = db.prepare(`SELECT id,numero,pasta,titulo,ultimo FROM (
      SELECT p.id,p.numero,p.pasta,p.titulo,
        MAX(substr(p.criado_em,1,10),
            COALESCE((SELECT MAX(substr(d.data_disponibilizacao,1,10)) FROM djen_publicacoes d WHERE d.cancelada=0 AND d.processo_chave IN (p.chave, COALESCE(p.djen_chave,p.chave))),'0000'),
            COALESCE((SELECT MAX(substr(a.criado_em,1,10)) FROM gestao_anotacoes a WHERE a.processo_id=p.id),'0000'),
            COALESCE((SELECT MAX(substr(f.criado_em,1,10)) FROM gestao_arquivos f WHERE f.processo_id=p.id),'0000'),
            COALESCE((SELECT MAX(t.concluida_em) FROM gestao_tarefas t WHERE t.processo_id=p.id),'0000')) AS ultimo
      FROM gestao_processos p WHERE p.status='ativo') WHERE ultimo<? ORDER BY ultimo LIMIT 10`).all(limiteParado) as { id: number; numero: string; pasta: string; titulo: string; ultimo: string }[];
  const totalParados = n(`SELECT COUNT(*) v FROM (SELECT p.id,
        MAX(substr(p.criado_em,1,10),
            COALESCE((SELECT MAX(substr(d.data_disponibilizacao,1,10)) FROM djen_publicacoes d WHERE d.cancelada=0 AND d.processo_chave IN (p.chave, COALESCE(p.djen_chave,p.chave))),'0000'),
            COALESCE((SELECT MAX(substr(a.criado_em,1,10)) FROM gestao_anotacoes a WHERE a.processo_id=p.id),'0000'),
            COALESCE((SELECT MAX(substr(f.criado_em,1,10)) FROM gestao_arquivos f WHERE f.processo_id=p.id),'0000'),
            COALESCE((SELECT MAX(t.concluida_em) FROM gestao_tarefas t WHERE t.processo_id=p.id),'0000')) AS ultimo
      FROM gestao_processos p WHERE p.status='ativo') WHERE ultimo<?`, limiteParado);

  const estoque = {
    por_status: db.prepare("SELECT status, COUNT(*) AS quantidade FROM gestao_processos GROUP BY status ORDER BY quantidade DESC").all(),
    por_area: db.prepare("SELECT COALESCE(NULLIF(area,''),'(sem área)') AS area, COUNT(*) AS quantidade FROM gestao_processos WHERE status='ativo' GROUP BY 1 ORDER BY quantidade DESC").all(),
    por_responsavel: db.prepare(`SELECT COALESCE(NULLIF(u.display_name,''),u.username,'(sem responsável)') AS responsavel, COUNT(*) AS quantidade FROM gestao_processos p LEFT JOIN users u ON u.id=p.responsavel_user_id WHERE p.status='ativo' GROUP BY 1 ORDER BY quantidade DESC`).all(),
    por_tribunal: db.prepare("SELECT COALESCE(NULLIF(tribunal,''),'(não informado)') AS tribunal, COUNT(*) AS quantidade FROM gestao_processos WHERE status='ativo' GROUP BY 1 ORDER BY quantidade DESC LIMIT 8").all(),
    sem_movimentacao_60_dias: totalParados, parados,
    sem_responsavel: n("SELECT COUNT(*) v FROM gestao_processos WHERE status='ativo' AND responsavel_user_id IS NULL"),
  };

  const meses = Array.from({ length: 6 }, (_, i) => somarMeses(`${hoje.slice(0, 7)}-01`, i - 5));
  const prospeccao = {
    novos_clientes_por_mes: meses.map((m) => ({ mes: m.slice(0, 7), quantidade: n("SELECT COUNT(*) v FROM gestao_pessoas WHERE tipo='cliente' AND substr(criado_em,1,10)>=? AND substr(criado_em,1,10)<?", m, somarMeses(m, 1)) })),
    novos_processos_por_mes: meses.map((m) => ({ mes: m.slice(0, 7), quantidade: n("SELECT COUNT(*) v FROM gestao_processos WHERE substr(criado_em,1,10)>=? AND substr(criado_em,1,10)<?", m, somarMeses(m, 1)) })),
    por_origem: db.prepare("SELECT COALESCE(NULLIF(origem,''),'(não informada)') AS origem, COUNT(*) AS quantidade FROM gestao_pessoas WHERE tipo='cliente' AND substr(criado_em,1,10)>=? GROUP BY 1 ORDER BY quantidade DESC LIMIT 8").all(somarMeses(`${hoje.slice(0, 7)}-01`, -11)),
  };

  let receita = null;
  if (incluirReceita) {
    receita = {
      recebido_no_mes_centavos: n("SELECT COALESCE(SUM(COALESCE(valor_pago_centavos,valor_centavos)),0) v FROM gestao_lancamentos WHERE tipo='receber' AND categoria='honorarios' AND cancelado=0 AND pago_em>=? AND pago_em<?", ini, fim),
      contratado_no_mes_centavos: n("SELECT COALESCE(SUM(valor_total_centavos),0) v FROM gestao_contratos WHERE status<>'cancelado' AND substr(criado_em,1,10)>=? AND substr(criado_em,1,10)<?", ini, fim),
      inadimplencia_centavos: n("SELECT COALESCE(SUM(valor_centavos),0) v FROM gestao_lancamentos WHERE tipo='receber' AND cancelado=0 AND pago_em IS NULL AND vencimento<?", hoje),
      por_area: db.prepare(`SELECT COALESCE(NULLIF(p.area,''),'(sem área)') AS area, COALESCE(SUM(COALESCE(l.valor_pago_centavos,l.valor_centavos)),0) AS centavos
        FROM gestao_lancamentos l LEFT JOIN gestao_processos p ON p.id=l.processo_id WHERE l.tipo='receber' AND l.categoria='honorarios' AND l.cancelado=0 AND l.pago_em>=? AND l.pago_em<? GROUP BY 1 ORDER BY centavos DESC`).all(ini, fim),
      por_responsavel: db.prepare(`SELECT COALESCE(NULLIF(u.display_name,''),u.username,'(sem responsável)') AS responsavel, COALESCE(SUM(COALESCE(l.valor_pago_centavos,l.valor_centavos)),0) AS centavos
        FROM gestao_lancamentos l LEFT JOIN gestao_processos p ON p.id=l.processo_id LEFT JOIN users u ON u.id=p.responsavel_user_id WHERE l.tipo='receber' AND l.categoria='honorarios' AND l.cancelado=0 AND l.pago_em>=? AND l.pago_em<? GROUP BY 1 ORDER BY centavos DESC`).all(ini, fim),
    };
  }
  return { mes, tarefas, produtividade, estoque, prospeccao, receita };
}
