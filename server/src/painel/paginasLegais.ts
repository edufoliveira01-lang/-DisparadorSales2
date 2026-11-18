import type { ConfigPainel } from "./config";
import { escapar } from "./email";

/**
 * TERMOS DE USO E POLÍTICA DE PRIVACIDADE da página de contratação.
 *
 * ⚠️ MINUTA: o texto foi redigido a partir do que o sistema de fato faz (ambiente isolado por escritório, IA como apoio, WhatsApp, cobrança
 * pelo Asaas, modo somente leitura por inadimplência) e deve ser REVISADO pelo advogado responsável antes de ser divulgado. Os dados da
 * empresa vêm do arquivo de configuração do painel (PAINEL_EMPRESA_*, PAINEL_EMAIL_PRIVACIDADE, PAINEL_FORO); o que faltar aparece como
 * «[a definir]» e o painel avisa na tela Contratação.
 */
export const VERSAO_DOS_TEXTOS = "1.0";
export const DATA_DOS_TEXTOS = "18 de novembro de 2026";

const falta = (v: string) => (v ? escapar(v) : "<mark>[a definir]</mark>");

export function dadosLegaisCompletos(cfg: ConfigPainel): { completo: boolean; faltam: string[] } {
  const e = cfg.empresa; const faltam: string[] = [];
  if (!e.nome) faltam.push("PAINEL_EMPRESA_NOME"); if (!e.documento) faltam.push("PAINEL_EMPRESA_CNPJ"); if (!e.endereco) faltam.push("PAINEL_EMPRESA_ENDERECO");
  if (!e.emailPrivacidade) faltam.push("PAINEL_EMAIL_PRIVACIDADE"); if (!e.foro) faltam.push("PAINEL_FORO");
  return { completo: faltam.length === 0, faltam };
}

function pagina(cfg: ConfigPainel, titulo: string, corpo: string): string {
  const base = (cfg.urlPublica || "").replace(/\/+$/, "");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(titulo)} · ${escapar(cfg.nomeProduto)}</title><meta name="robots" content="index,follow">
<style>
:root{--tx:#14181f;--mut:#5b6472;--bd:#e4e4e7;--bg:#fff;--ac:#1678dc}
@media(prefers-color-scheme:dark){:root{--tx:#eef1f6;--mut:#9aa5b5;--bd:#2a313c;--bg:#0c1016;--ac:#3b95f0}}
body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.7 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{border-bottom:1px solid var(--bd);padding:14px clamp(16px,4vw,48px);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:center}
header a{color:var(--ac);font-weight:700;text-decoration:none}
main{max-width:820px;margin:0 auto;padding:28px clamp(16px,4vw,32px) 64px}
h1{font-size:clamp(1.6rem,4vw,2.2rem);margin:0 0 6px;letter-spacing:-.02em}h2{font-size:1.15rem;margin:30px 0 6px}
p,li{color:var(--tx)}.mut{color:var(--mut);font-size:14px}ul,ol{padding-left:22px}li{margin:4px 0}
mark{background:#fff0b3;color:#4a3b00;padding:0 4px;border-radius:4px}
nav.legal{display:flex;gap:16px;font-size:14px;margin:6px 0 22px}nav.legal a{color:var(--ac)}
footer{border-top:1px solid var(--bd);padding:18px clamp(16px,4vw,48px);color:var(--mut);font-size:13px}
</style></head><body>
<header><a href="${escapar(base)}/contratar">← ${escapar(cfg.nomeProduto)}</a><span class="mut">Versão ${VERSAO_DOS_TEXTOS} · ${DATA_DOS_TEXTOS}</span></header>
<main><h1>${escapar(titulo)}</h1>
<nav class="legal"><a href="${escapar(base)}/termos">Termos de uso</a><a href="${escapar(base)}/privacidade">Política de privacidade</a></nav>
${corpo}</main>
<footer>${escapar(cfg.nomeProduto)}${cfg.empresa.nome ? " · " + escapar(cfg.empresa.nome) : ""}</footer></body></html>`;
}

export function paginaTermos(cfg: ConfigPainel): string {
  const p = escapar(cfg.nomeProduto); const e = cfg.empresa; const teste = cfg.testePadraoDias; const carencia = cfg.carenciaPadraoDias;
  return pagina(cfg, "Termos de uso", `
<p class="mut">Leia com atenção. Ao marcar “Li e aceito” no cadastro, o escritório contratante (“<b>Contratante</b>”) concorda com estes termos, firmados com ${falta(e.nome)}, inscrita no CNPJ ${falta(e.documento)}, com sede em ${falta(e.endereco)} (“<b>Contratada</b>”).</p>

<h2>1. O que é o serviço</h2>
<p>O ${p} é um sistema, oferecido na internet, para escritórios de advocacia. Reúne, conforme o plano contratado: acompanhamento de publicações do Diário de Justiça Eletrônico Nacional (DJEN) com apoio de inteligência artificial; gestão de clientes, processos, arquivos, tarefas e indicadores; módulo financeiro; contratos com assinatura e cobrança; captação de clientes; e atendimento por WhatsApp com inteligência artificial. Cada plano tem limites e módulos próprios, descritos na página de contratação, e podem ser alterados pela Contratada com aviso prévio, sem reduzir o que o Contratante já pagou para o período em curso.</p>

<h2>2. Cadastro e ambiente</h2>
<p>O cadastro deve ser feito por pessoa com poderes para contratar em nome do escritório e com informações verdadeiras. Cada escritório recebe um ambiente próprio e isolado, com endereço, banco de dados, equipe e credenciais separados dos demais. O Contratante é responsável por guardar o usuário e a senha, por cadastrar apenas pessoas autorizadas e por encerrar o acesso de quem deixar a equipe.</p>

<h2>3. Teste gratuito</h2>
<p>O Contratante tem ${teste} dias de teste gratuito, sem necessidade de informar cartão. Durante o teste, todos os recursos do plano escolhido ficam disponíveis. Ao final do teste, se o Contratante não regularizar o pagamento, o ambiente passa para o modo somente leitura (item 5). Cada escritório tem direito a um período de teste.</p>

<h2>4. Planos, preços e pagamento</h2>
<p>O preço mensal de cada plano é o informado na página de contratação no momento do cadastro. A cobrança é recorrente e feita por meio de provedor de pagamentos (Asaas), com boleto, Pix ou cartão à escolha do Contratante, com vencimento próximo ao fim do teste. Reajustes serão comunicados com antecedência mínima de 30 dias e valem para as cobranças seguintes. A emissão de nota fiscal segue a legislação aplicável.</p>

<h2>5. Atraso, suspensão e cancelamento</h2>
<ul>
<li><b>Carência.</b> Vencida a assinatura, o ambiente continua normal por ${carencia} dias, com aviso de atraso.</li>
<li><b>Somente leitura.</b> Esgotada a carência, ou em caso de suspensão ou cancelamento, o ambiente passa ao modo somente leitura: o Contratante continua podendo consultar, gerar relatórios e <b>exportar seus dados</b>, mas deixam de funcionar alterações, envios e rotinas automáticas (como a captura do DJEN, a análise por inteligência artificial e as notificações).</li>
<li><b>Seus dados não são apagados por inadimplência.</b></li>
<li><b>Cancelamento.</b> O Contratante pode cancelar a qualquer momento, sem multa, pelo canal de suporte. O cancelamento encerra as cobranças futuras; não há devolução proporcional do mês em curso, salvo disposição legal em contrário.</li>
<li><b>Exclusão dos dados.</b> A exclusão definitiva do ambiente e dos dados ocorre a pedido do Contratante ou após o cancelamento, em prazo razoável informado pela Contratada, depois de o Contratante ter tido a oportunidade de exportar suas informações.</li>
</ul>

<h2>6. Inteligência artificial e conferência do advogado</h2>
<p>As funcionalidades com inteligência artificial (por exemplo, classificar publicações, sugerir prazos e conduzir a triagem de atendimento) são <b>ferramentas de apoio</b>. Podem errar, omitir ou interpretar mal um texto. <b>O sistema fornece lembretes e sugestões operacionais, não é prova de prazo nem substitui a conferência do advogado.</b> A decisão sobre qualquer prazo, providência processual ou resposta a cliente é sempre do Contratante, que deve conferir as informações nos autos e nos meios oficiais.</p>
<p>Para executar esses recursos, o conteúdo necessário (por exemplo, o texto de uma publicação ou de uma conversa) pode ser enviado ao provedor de inteligência artificial configurado para o ambiente. Isso está detalhado na <a href="/privacidade">Política de Privacidade</a>.</p>

<h2>7. WhatsApp e outros canais</h2>
<p>O atendimento por WhatsApp depende de serviços e regras de terceiros. A conexão de números por leitura de QR Code utiliza meios não oficiais e <b>pode levar ao bloqueio do número pelo próprio WhatsApp</b>, sem responsabilidade da Contratada. O Contratante deve respeitar os termos do WhatsApp, a legislação de proteção de dados e de publicidade (inclusive a obtenção de consentimento para mensagens) e as regras de ética da advocacia, em especial quanto à captação de clientela e à publicidade.</p>

<h2>8. Uso aceitável</h2>
<p>É vedado usar o serviço para fins ilícitos; enviar spam ou mensagens em massa sem base legal; tentar acessar ambientes de outros escritórios; sobrecarregar ou comprometer a infraestrutura; copiar, revender ou sublicenciar o sistema sem autorização; ou inserir conteúdo que viole direitos de terceiros. A violação grave pode levar à suspensão imediata do ambiente.</p>

<h2>9. Dados, sigilo e proteção de dados pessoais</h2>
<p>Os dados inseridos no ambiente (clientes, processos, documentos, conversas) são do Contratante, que os trata como <b>controlador</b>, nos termos da Lei Geral de Proteção de Dados (Lei 13.709/2018). A Contratada os trata como <b>operadora</b>, apenas para prestar o serviço e seguindo as instruções do Contratante. O Contratante é responsável por ter base legal para tratar esses dados e por observar o sigilo profissional. A Contratada adota medidas técnicas e administrativas razoáveis de segurança, incluindo isolamento por escritório, controle de acesso e criptografia de credenciais, e comunicará ao Contratante incidentes de segurança que afetem seus dados, nos termos da lei.</p>

<h2>10. Disponibilidade e suporte</h2>
<p>A Contratada empenha esforços razoáveis para manter o serviço disponível, mas não garante funcionamento ininterrupto. Poderão ocorrer paradas para manutenção, atualizações e falhas de provedores e redes. O suporte é prestado pelos canais informados no ambiente${e.emailSuporte ? " e pelo e-mail " + escapar(e.emailSuporte) : ""}.</p>

<h2>11. Limitação de responsabilidade</h2>
<p>Na máxima extensão permitida em lei, a Contratada não responde por lucros cessantes, perda de prazos, de oportunidades ou de clientes, nem por danos indiretos decorrentes do uso do sistema, das integrações de terceiros ou de decisões tomadas com base em sugestões de inteligência artificial. A responsabilidade total da Contratada, em qualquer hipótese, fica limitada ao valor pago pelo Contratante nos 12 meses anteriores ao fato.</p>

<h2>12. Alterações destes termos</h2>
<p>A Contratada pode atualizar estes termos. Mudanças relevantes serão comunicadas ao e-mail do responsável com antecedência razoável. O uso do serviço após a vigência da nova versão indica concordância; o Contratante que não concordar pode cancelar.</p>

<h2>13. Lei aplicável e foro</h2>
<p>Estes termos são regidos pelas leis brasileiras. Fica eleito o foro da comarca de ${falta(e.foro)} para resolver controvérsias, ressalvado o foro do consumidor quando aplicável.</p>

<p class="mut">Dúvidas sobre estes termos: ${e.emailSuporte ? escapar(e.emailSuporte) : "<mark>[e-mail de suporte a definir]</mark>"}.</p>`);
}

export function paginaPrivacidade(cfg: ConfigPainel): string {
  const p = escapar(cfg.nomeProduto); const e = cfg.empresa;
  return pagina(cfg, "Política de privacidade", `
<p class="mut">Esta política explica como tratamos dados pessoais no ${p}, em conformidade com a Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018). Ela vale para dois grupos de dados, que tratamos de formas diferentes: os <b>dados de cadastro e cobrança do escritório contratante</b> e os <b>dados que o escritório coloca no sistema</b>.</p>

<h2>1. Quem é o responsável</h2>
<ul>
<li><b>Dados de cadastro e cobrança:</b> a controladora é ${falta(e.nome)}, CNPJ ${falta(e.documento)}, ${falta(e.endereco)}.</li>
<li><b>Dados que o escritório insere no sistema</b> (clientes, processos, documentos, conversas): o <b>escritório contratante é o controlador</b>. Nós atuamos como <b>operadores</b>, tratando esses dados apenas para prestar o serviço e conforme as instruções do escritório.</li>
</ul>
<p>Encarregado pelo tratamento de dados (contato para exercer direitos e tirar dúvidas): ${e.emailPrivacidade ? escapar(e.emailPrivacidade) : "<mark>[e-mail do encarregado a definir]</mark>"}.</p>

<h2>2. Quais dados coletamos no cadastro</h2>
<ul>
<li>Do escritório e do responsável: nome, CNPJ ou CPF (opcional), e-mail, telefone/WhatsApp, usuário de acesso e o endereço escolhido para o sistema.</li>
<li>A senha é guardada de forma protegida (hash) e nunca é enviada por e-mail.</li>
<li>De uso e segurança: endereço IP e data/hora do cadastro, registros de acesso e de ações no painel de assinaturas, e informações técnicas da instalação (versão do sistema e horário do último contato com o painel).</li>
<li>De cobrança: plano, valores, vencimentos e situação dos pagamentos. Os dados de cartão ou conta são tratados diretamente pelo provedor de pagamentos e não ficam conosco.</li>
</ul>

<h2>3. Para que usamos e em que base legal</h2>
<ul>
<li><b>Criar e manter o ambiente, prestar o serviço e dar suporte</b> — execução de contrato (art. 7º, V).</li>
<li><b>Cobrar, emitir documentos fiscais e cumprir obrigações</b> — execução de contrato e obrigação legal (art. 7º, II e V).</li>
<li><b>Segurança, prevenção a fraude e abuso</b> — legítimo interesse (art. 7º, IX).</li>
<li><b>Avisos sobre o teste, a cobrança e mudanças do serviço</b> — execução de contrato.</li>
</ul>
<p>Não vendemos dados pessoais nem os usamos para publicidade de terceiros.</p>

<h2>4. Dados que o escritório coloca no sistema</h2>
<p>Esses dados ficam no ambiente isolado do escritório (banco de dados e pastas próprios). Nós os tratamos só para operar o serviço e para as finalidades que o próprio escritório configurar. Quem decide a base legal, o prazo de guarda e as comunicações com seus clientes é o escritório. Nas funcionalidades com inteligência artificial e com WhatsApp, trechos desses dados podem ser enviados aos provedores descritos no item 5.</p>

<h2>5. Com quem compartilhamos</h2>
<ul>
<li><b>Provedor de pagamentos (Asaas)</b> — para criar a assinatura e cobrar.</li>
<li><b>Provedores de infraestrutura e rede (por exemplo, Cloudflare e a hospedagem do servidor)</b> — para entregar o serviço com segurança.</li>
<li><b>Provedores de inteligência artificial configurados no ambiente</b> — recebem apenas o conteúdo necessário para a função usada (por exemplo, o texto de uma publicação para classificação ou o histórico de uma conversa para a triagem).</li>
<li><b>WhatsApp e outros canais de mensagem</b> — quando o escritório os conecta.</li>
<li><b>Serviço de envio de e-mail</b> — para os avisos do cadastro.</li>
<li><b>Autoridades</b>, quando houver ordem legal.</li>
</ul>
<p>Alguns desses provedores podem estar fora do Brasil. Nesses casos, a transferência observa a LGPD, com cláusulas e salvaguardas adequadas.</p>

<h2>6. Por quanto tempo guardamos</h2>
<p>Os dados de cadastro e cobrança são guardados enquanto durar o contrato e, depois, pelo prazo necessário para cumprir obrigações legais, fiscais e de defesa em processos. Os dados do ambiente do escritório ficam disponíveis enquanto o ambiente existir; após o cancelamento, são excluídos a pedido ou em prazo razoável, depois de o escritório poder exportá-los. Dados não são apagados por inadimplência.</p>

<h2>7. Seus direitos</h2>
<p>Você pode pedir: confirmação de que tratamos seus dados; acesso; correção; anonimização, bloqueio ou eliminação de dados desnecessários; portabilidade; informações sobre compartilhamento; e a revogação de consentimento quando for a base utilizada. Para dados que o escritório inseriu no sistema sobre seus próprios clientes, o pedido deve ser feito ao escritório (controlador); nós o apoiamos no atendimento. Para exercer seus direitos, escreva ao encarregado indicado no item 1. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).</p>

<h2>8. Segurança</h2>
<p>Usamos isolamento por escritório, controle de acesso por perfil, senhas protegidas, criptografia das chaves e credenciais de integração, comunicação segura (HTTPS) e registro de ações administrativas. Nenhum sistema é totalmente invulnerável; em caso de incidente que possa causar risco ou dano relevante, comunicaremos os afetados e a ANPD, nos termos da lei.</p>

<h2>9. Cookies</h2>
<p>A página de contratação não usa cookies de rastreamento nem de publicidade. Os ambientes e o painel usam apenas cookies estritamente necessários para manter a sessão de quem está autenticado.</p>

<h2>10. Mudanças nesta política</h2>
<p>Podemos atualizar esta política. A versão em vigor e a data aparecem no topo desta página; mudanças relevantes serão comunicadas ao e-mail do responsável.</p>`);
}
