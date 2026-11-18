'use strict';
const $app = document.getElementById('app');
const state = { config: null, planos: [], escritorios: [], pagina: 'geral', busca: '', filtro: '', filtroPlano: '', ordem: 'nome', resumo: null, eventos: null, contratacao: null, versao: '' };
const ROT = { ativa: 'Ativa', teste: 'Em teste', carencia: 'Em carência', suspensa: 'Suspensa', cancelada: 'Cancelada' };

function h(tag, attrs, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) el.append(f.nodeType ? f : document.createTextNode(String(f)));
  return el;
}
async function api(metodo, caminho, corpo) {
  const r = await fetch('/api/admin' + caminho, { method: metodo, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'painel' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && caminho !== '/login') { mostrarLogin(); throw new Error('Sessão expirada.'); }
  if (!r.ok) throw new Error(j.error || 'Erro ' + r.status);
  return j;
}
function aviso(msg) { const t = h('div', { class: 'toast' }, msg); document.body.append(t); setTimeout(() => t.remove(), 3500); }
const reais = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dia = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');
const quando = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : 'nunca');
const badge = (s) => h('span', { class: 'badge b-' + s }, ROT[s] || s);
const copiar = async (txt) => { try { await navigator.clipboard.writeText(txt); aviso('Copiado.'); } catch { aviso('Não foi possível copiar; selecione o texto.'); } };
function bloco(titulo, txt) { return txt ? h('div', {}, h('div', { class: 'row2' }, h('b', {}, titulo), h('button', { onclick: () => copiar(txt) }, 'Copiar')), h('pre', {}, txt)) : null; }

function mostrarLogin() {
  const erro = h('div', { class: 'note err', hidden: true });
  const usuario = h('input', { id: 'usuario', autocomplete: 'username', value: 'admin' }), senha = h('input', { id: 'senha', type: 'password', autocomplete: 'current-password' });
  const form = h('form', { class: 'login', onsubmit: async (e) => { e.preventDefault(); try { await api('POST', '/login', { usuario: usuario.value, senha: senha.value }); await iniciar(); } catch (x) { erro.textContent = x.message; erro.hidden = false; } } },
    h('h1', {}, 'Painel de assinaturas'), erro,
    h('div', { class: 'field' }, h('label', { for: 'usuario' }, 'Usuário'), usuario),
    h('div', { class: 'field' }, h('label', { for: 'senha' }, 'Senha'), senha),
    h('button', { class: 'pri', style: 'width:100%' }, 'Entrar'));
  $app.replaceChildren(form); senha.focus();
}

/* ===================== PAINEL DE ASSINATURAS (interface reformulada) ===================== */

const PAGINAS = [
  ['geral', 'Visão geral', 'M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10'],
  ['escritorios', 'Escritórios', 'M4 21V6l8-3 8 3v15M9 21v-5h6v5M9 9h.01M15 9h.01M9 13h.01M15 13h.01'],
  ['planos', 'Planos', 'M4 7h16M4 12h16M4 17h10'],
  ['contratacao', 'Contratação', 'M12 3v12m0 0l-4-4m4 4l4-4M5 21h14'],
  ['atividade', 'Atividade', 'M3 12h4l3-8 4 16 3-8h4'],
  ['servidor', 'Servidor', 'M4 6h16v5H4zM4 13h16v5H4zM8 8.5h.01M8 15.5h.01'],
];
const ROTULO_EVENTO = {
  escritorio_criado: 'Escritório criado', escritorio_excluido: 'Escritório excluído por completo', contratacao_publica: 'Contratação pela página pública',
  suspenso: 'Suspenso', reativado: 'Reativado', cancelado: 'Assinatura cancelada', pagamento_manual: 'Pagamento registrado à mão',
  pagamento_recebido: 'Pagamento recebido', pagamento_confirmado: 'Pagamento confirmado', cobranca_criada: 'Cobrança criada', cobranca_erro: 'Erro na cobrança',
  instancia_criada: 'Sistema criado no servidor', instancia_adotada: 'Sistema existente adotado', instancia_erro: 'Erro ao criar o sistema', instancia_removida: 'Sistema removido do servidor',
  chave_rotacionada: 'Nova chave de licença', chave_aplicada_na_instancia: 'Chave aplicada na instância', servidor_reiniciado: 'Sistemas reiniciados',
  plano_criado: 'Plano criado', plano_atualizado: 'Plano alterado', escritorio_atualizado: 'Dados alterados',
};
const rotuloEvento = (t) => ROTULO_EVENTO[t] || (t.charAt(0).toUpperCase() + t.slice(1).replaceAll('_', ' '));
const icone = (d) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ico'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.append(p); return s; };
const diasAte = (iso) => (iso ? Math.round((Date.parse(iso.slice(0, 10) + 'T12:00:00Z') - Date.parse(new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10) + 'T12:00:00Z')) / 864e5) : null);
const textoDias = (n) => (n === null ? '' : n < 0 ? `venceu há ${-n} dia${n === -1 ? '' : 's'}` : n === 0 ? 'vence hoje' : `em ${n} dia${n === 1 ? '' : 's'}`);
const quantoTempo = (iso) => { if (!iso) return null; const m = (Date.now() - Date.parse(iso)) / 60000; return m < 2 ? 'agora' : m < 60 ? Math.round(m) + ' min' : m < 1440 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' d'; };

async function carregar() {
  [state.escritorios, state.planos, state.resumo] = await Promise.all([api('GET', '/escritorios'), api('GET', '/planos'), api('GET', '/resumo')]);
  desenhar();
}
function ir(pagina, extra = {}) { Object.assign(state, { pagina }, extra); desenhar(); window.scrollTo(0, 0); }

function desenhar() {
  const nav = h('nav', { class: 'menu', 'aria-label': 'Seções' }, PAGINAS.map(([id, rot, d]) => h('button', { class: 'item' + (state.pagina === id ? ' ativo' : ''), onclick: () => ir(id), 'aria-current': state.pagina === id ? 'page' : null }, icone(d), h('span', {}, rot))));
  const lateral = h('aside', { class: 'lateral' },
    h('div', { class: 'marca' }, h('span', { class: 'selo' }, (state.config.produto_nome || 'DZ').split(' ').map((p) => p.charAt(0)).join('').slice(0, 2).toUpperCase()), h('div', {}, h('b', {}, state.config.produto_nome || 'DisparaZap'), h('small', {}, 'Assinaturas'))),
    nav,
    h('div', { class: 'rodape' }, h('small', {}, 'Painel ' + (state.versao || '')), h('button', { class: 'sair', onclick: async () => { await api('POST', '/logout', {}); mostrarLogin(); } }, 'Sair')));
  const telas = { geral: telaGeral, escritorios: telaEscritorios, planos: telaPlanos, contratacao: telaContratacao, atividade: telaAtividade, servidor: telaServidor };
  const corpo = (telas[state.pagina] || telaGeral)();
  $app.replaceChildren(h('div', { class: 'shell' }, lateral, h('main', { class: 'conteudo' }, corpo)));
}
function cabecalho(titulo, sub, ...acoes) { return h('header', { class: 'pagina-topo' }, h('div', {}, h('h1', {}, titulo), sub ? h('p', { class: 'sub' }, sub) : null), h('div', { class: 'acoes' }, acoes)); }
function cartao(titulo, corpo, { acao, classe = '' } = {}) { return h('section', { class: 'cartao ' + classe }, h('div', { class: 'cartao-topo' }, h('h2', {}, titulo), acao || null), corpo); }
const vazio = (t) => h('p', { class: 'vazio' }, t);

/* ---------- Visão geral ---------- */
function telaGeral() {
  const r = state.resumo; const s = r.situacao;
  const kpi = (rot, valor, nota, cls, aoClicar) => h('button', { class: 'kpi ' + (cls || ''), onclick: aoClicar }, h('span', { class: 'kpi-rot' }, rot), h('b', { class: 'kpi-valor' }, valor), nota ? h('span', { class: 'kpi-nota' }, nota) : null);
  const filtrar = (st) => () => ir('escritorios', { filtro: st });
  const linha = (e, extra) => h('li', {}, h('button', { class: 'lista-item', onclick: () => abrirDetalhe(e.id) }, h('span', {}, h('b', {}, e.nome), h('small', {}, e.slug)), h('span', { class: 'fim' }, extra)));
  const maxReceita = Math.max(1, ...r.por_plano.map((p) => p.receita_centavos));
  return h('div', { class: 'pagina' },
    cabecalho('Visão geral', 'Como estão as assinaturas agora.', h('button', { class: 'pri', onclick: abrirNovo }, '+ Novo escritório')),
    faixaAtendimento(),
    h('div', { class: 'kpis' },
      kpi('Receita mensal prevista', reais(r.receita_mensal_centavos), `${r.pagantes} escritório${r.pagantes === 1 ? '' : 's'} pagando`, 'destaque', () => ir('planos')),
      kpi('Escritórios', String(r.total), 'no total', '', filtrar('')),
      kpi('Ativos', String(s.ativa), 'em dia', 'ok', filtrar('ativa')),
      kpi('Em teste', String(s.teste), 'ainda sem pagar', 'info', filtrar('teste')),
      kpi('Em carência', String(s.carencia), 'venceu, ainda liberado', s.carencia ? 'aviso' : '', filtrar('carencia')),
      kpi('Suspensos', String(s.suspensa), 'somente leitura', s.suspensa ? 'erro' : '', filtrar('suspensa')),
      kpi('Cancelados', String(s.cancelada), 'fora da cobrança', '', filtrar('cancelada'))),
    h('div', { class: 'duas-colunas' },
      cartao('Precisa de atenção', h('div', {},
        h('h3', { class: 'mini' }, 'Testes acabando (3 dias)'), r.testes_acabando.length ? h('ul', { class: 'lista' }, r.testes_acabando.map((e) => linha(e, textoDias(e.dias)))) : vazio('Nenhum teste acabando.'),
        h('h3', { class: 'mini' }, 'Vencendo em 7 dias'), r.vencendo.length ? h('ul', { class: 'lista' }, r.vencendo.map((e) => linha(e, textoDias(e.dias)))) : vazio('Nenhum vencimento próximo.'),
        h('h3', { class: 'mini' }, 'Em carência'), r.em_carencia.length ? h('ul', { class: 'lista' }, r.em_carencia.map((e) => linha(e, 'até ' + dia(e.carencia_ate)))) : vazio('Ninguém em carência.'),
        h('h3', { class: 'mini' }, 'Sistema sem falar com o painel há 3+ dias'), r.sem_contato.length ? h('ul', { class: 'lista' }, r.sem_contato.map((e) => linha(e, e.ultimo_contato_em ? 'há ' + quantoTempo(e.ultimo_contato_em) : 'nunca falou'))) : vazio('Todos os sistemas estão se comunicando.'))),
      h('div', { class: 'coluna' },
        cartao('Receita por plano', r.por_plano.length ? h('ul', { class: 'barras' }, r.por_plano.map((p) => h('li', {}, h('div', { class: 'barra-topo' }, h('b', {}, p.plano), h('span', {}, `${p.ativos}/${p.escritorios} ativos · ${reais(p.receita_centavos)}`)), h('div', { class: 'barra' }, h('i', { style: `width:${Math.round((p.receita_centavos / maxReceita) * 100)}%` }))))) : vazio('Sem dados ainda.')),
        cartao('Contratações pela página pública', r.contratacoes_recentes.length ? h('ul', { class: 'lista' }, r.contratacoes_recentes.map((c) => h('li', {}, h('button', { class: 'lista-item', onclick: () => c.escritorio_id && abrirDetalhe(c.escritorio_id) }, h('span', {}, h('b', {}, c.nome || '(excluído)'), h('small', {}, c.slug || '')), h('span', { class: 'fim' }, quando(c.criado_em)))))) : vazio('Nenhuma contratação pela página ainda.'), { acao: h('button', { class: 'ghost', onclick: () => ir('contratacao') }, 'Ver página') }))));
}

/* ---------- Escritórios ---------- */
function telaEscritorios() {
  const f = state.filtro || ''; const fp = state.filtroPlano || ''; const busca = (state.busca || '').toLowerCase();
  const ord = state.ordem || 'nome';
  let lista = state.escritorios.filter((e) => (!f || e.status === f) && (!fp || e.plano_id === fp) && (!busca || (e.nome + ' ' + e.slug + ' ' + e.email).toLowerCase().includes(busca)));
  const chave = { nome: (a, b) => a.nome.localeCompare(b.nome), vencimento: (a, b) => (a.vence_em || '9').localeCompare(b.vence_em || '9'), contato: (a, b) => (b.ultimo_contato_em || '').localeCompare(a.ultimo_contato_em || ''), criado: (a, b) => b.criado_em.localeCompare(a.criado_em) }[ord];
  lista = [...lista].sort(chave);
  const sel = (valor, opcoes, aoMudar) => { const s = h('select', { onchange: (e) => aoMudar(e.target.value) }, opcoes.map(([v, r]) => h('option', { value: v }, r))); s.value = valor; return s; };
  const busc = h('input', { type: 'search', placeholder: 'Buscar por nome, endereço ou e-mail…', value: state.busca || '', 'aria-label': 'Buscar escritório', oninput: (e) => { state.busca = e.target.value; clearTimeout(telaEscritorios.t); telaEscritorios.t = setTimeout(() => { desenhar(); const i = document.querySelector('.filtros input[type=search]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); } });
  const ponto = (e) => { if (!e.porta) return h('span', { class: 'ponto cinza', title: 'Sistema não criado neste servidor' }); const m = e.ultimo_contato_em ? (Date.now() - Date.parse(e.ultimo_contato_em)) / 3600e3 : 9e9; return h('span', { class: 'ponto ' + (m < 12 ? 'verde' : m < 72 ? 'amarelo' : 'vermelho'), title: e.ultimo_contato_em ? 'Último contato ' + quando(e.ultimo_contato_em) : 'Nunca falou com o painel' }); };
  const linhas = lista.map((e) => { const d = diasAte(e.vence_em); return h('tr', { class: 'row', tabindex: 0, onclick: () => abrirDetalhe(e.id), onkeydown: (ev) => { if (ev.key === 'Enter') abrirDetalhe(e.id); } },
    h('td', {}, h('b', {}, e.nome), h('div', { class: 'mut sm' }, e.email)),
    h('td', {}, h('a', { href: e.endereco, target: '_blank', rel: 'noopener noreferrer', onclick: (ev) => ev.stopPropagation() }, e.slug)),
    h('td', {}, e.plano_nome),
    h('td', {}, badge(e.status)),
    h('td', {}, e.vence_em ? [dia(e.vence_em), h('div', { class: 'mut sm' }, textoDias(d))] : '—'),
    h('td', {}, ponto(e), ' ', e.ultimo_contato_em ? quantoTempo(e.ultimo_contato_em) : 'nunca')); });
  return h('div', { class: 'pagina' },
    cabecalho('Escritórios', `${lista.length} de ${state.escritorios.length} escritórios`, h('button', { class: 'pri', onclick: abrirNovo }, '+ Novo escritório')),
    h('div', { class: 'filtros' }, busc,
      sel(f, [['', 'Todas as situações'], ['ativa', 'Ativas'], ['teste', 'Em teste'], ['carencia', 'Em carência'], ['suspensa', 'Suspensas'], ['cancelada', 'Canceladas']], (v) => { state.filtro = v; desenhar(); }),
      sel(fp, [['', 'Todos os planos'], ...state.planos.map((p) => [p.id, p.nome])], (v) => { state.filtroPlano = v; desenhar(); }),
      sel(ord, [['nome', 'Ordenar: nome'], ['vencimento', 'Ordenar: vencimento'], ['contato', 'Ordenar: último contato'], ['criado', 'Ordenar: mais novos']], (v) => { state.ordem = v; desenhar(); })),
    h('div', { class: 'tabela' }, h('table', {}, h('thead', {}, h('tr', {}, ['Escritório', 'Endereço', 'Plano', 'Situação', 'Vence em', 'Último contato'].map((t) => h('th', {}, t)))), h('tbody', {}, linhas.length ? linhas : h('tr', {}, h('td', { colspan: 6, class: 'vazio' }, 'Nenhum escritório com esses filtros.'))))));
}

/* ---------- Planos ---------- */
function resumoDoPlano(p) {
  const e = p.entitlements || {}; const def = state.config.entitlements;
  const val = (k) => (k in e ? e[k] : def[k].padrao);
  const num = (k) => (val(k) === null ? 'ilimitado' : String(val(k)));
  return { limites: [['max_usuarios', 'usuários'], ['max_advogados', 'advogados'], ['max_processos', 'processos'], ['max_numeros_whatsapp', 'WhatsApp']].map(([k, r]) => `${num(k)} ${r}`), modulos: Object.entries(def).filter(([, d]) => d.tipo === 'recurso').map(([k, d]) => [d.rotulo, val(k) !== false]) };
}
function telaPlanos() {
  const qtd = (id) => state.escritorios.filter((e) => e.plano_id === id && e.status !== 'cancelada').length;
  const cards = [...state.planos].sort((a, b) => (a.preco_centavos || 1e12) - (b.preco_centavos || 1e12)).map((p) => { const r = resumoDoPlano(p); return h('article', { class: 'plano-card' + (p.ativo ? '' : ' inativo'), tabindex: 0, onclick: () => editarPlano(p), onkeydown: (ev) => { if (ev.key === 'Enter') editarPlano(p); } },
    h('div', { class: 'plano-topo' }, h('b', {}, p.nome), h('span', { class: 'etiquetas' }, p.ativo ? null : h('span', { class: 'tag' }, 'inativo'), p.publico ? h('span', { class: 'tag azul' }, 'à venda') : null, p.destaque ? h('span', { class: 'tag' }, 'destaque') : null)),
    h('div', { class: 'preco' }, p.preco_centavos ? reais(p.preco_centavos) : 'Sem cobrança', p.preco_centavos ? h('small', {}, '/mês') : null),
    p.resumo ? h('p', { class: 'mut sm' }, p.resumo) : null,
    h('p', { class: 'limites' }, r.limites.join(' · ')),
    h('ul', { class: 'modulos' }, r.modulos.map(([rot, on]) => h('li', { class: on ? 'on' : 'off' }, rot.replace(/ \(.*\)$/, '')))),
    h('div', { class: 'plano-fim' }, `${qtd(p.id)} escritório${qtd(p.id) === 1 ? '' : 's'}`)); });
  return h('div', { class: 'pagina' },
    cabecalho('Planos', 'O que cada plano libera e limita. A alteração vale para todos os escritórios do plano.', h('button', { class: 'pri', onclick: () => editarPlano(null) }, '+ Novo plano')),
    h('div', { class: 'planos-grade' }, cards));
}
function campoLimites(valores, { plano = false } = {}) {
  const defs = state.config.entitlements, entradas = {}, caixa = h('div', { class: 'limites-form' });
  const herdar = plano ? 'Padrão do sistema' : 'Herdar do plano';
  const grupos = state.config.grupos || [{ titulo: 'Limites e recursos', chaves: Object.keys(defs) }];
  for (const g of grupos) {
    const bloco = h('fieldset', { class: 'grupo' }, h('legend', {}, g.titulo));
    for (const chave of g.chaves) {
      const def = defs[chave]; if (!def) continue;
      const atual = valores && chave in valores ? valores[chave] : undefined;
      let sel, num;
      if (def.tipo === 'recurso') {
        sel = h('select', {}, h('option', { value: 'herdar' }, herdar), h('option', { value: 'on' }, 'Incluído'), h('option', { value: 'off' }, 'Não incluído'));
        sel.value = atual === undefined ? 'herdar' : atual ? 'on' : 'off';
        entradas[chave] = () => (sel.value === 'herdar' ? undefined : sel.value === 'on');
        bloco.append(h('label', { class: 'campo-lin' }, h('span', {}, def.rotulo), sel));
      } else {
        sel = h('select', {}, h('option', { value: 'herdar' }, herdar), h('option', { value: 'ilim' }, 'Ilimitado'), h('option', { value: 'lim' }, 'Limite…'));
        num = h('input', { type: 'number', min: 0, step: 1, hidden: true, 'aria-label': def.rotulo + ' (limite)' });
        sel.value = atual === undefined ? 'herdar' : atual === null ? 'ilim' : 'lim'; if (typeof atual === 'number') num.value = atual;
        const sync = () => { num.hidden = sel.value !== 'lim'; }; sel.addEventListener('change', sync); sync();
        entradas[chave] = () => (sel.value === 'herdar' ? undefined : sel.value === 'ilim' ? null : Number(num.value));
        bloco.append(h('label', { class: 'campo-lin' }, h('span', {}, def.rotulo), h('span', { class: 'par' }, sel, num)));
      }
    }
    caixa.append(bloco);
  }
  return { el: caixa, valor: () => Object.fromEntries(Object.entries(entradas).map(([k, f]) => [k, f()]).filter(([, v]) => v !== undefined)) };
}
function editarPlano(p) {
  const nome = h('input', { value: p?.nome || '', required: true }), preco = h('input', { type: 'number', min: 0, step: '0.01', value: p ? (p.preco_centavos / 100).toFixed(2) : '' });
  const marca = (v) => { const c = h('input', { type: 'checkbox' }); c.checked = v; return c; };
  const ativo = marca(p ? p.ativo : true), publico = marca(p ? Boolean(p.publico) : false), destaque = marca(p ? Boolean(p.destaque) : false);
  const resumo = h('input', { value: p?.resumo || '', maxlength: 200, placeholder: 'Frase curta mostrada na página de contratação' });
  const limites = campoLimites(p?.entitlements || {}, { plano: true }); const erro = h('div', { class: 'note err', hidden: true });
  const m = modal(p ? 'Editar plano ' + p.nome : 'Novo plano', h('form', { class: 'formulario', onsubmit: async (e) => { e.preventDefault(); try { const corpo = { nome: nome.value, preco_centavos: Math.round(Number(preco.value || 0) * 100), entitlements: limites.valor(), ativo: ativo.checked, publico: publico.checked, destaque: destaque.checked, resumo: resumo.value }; if (p) await api('PUT', '/planos/' + p.id, corpo); else await api('POST', '/planos', corpo); m.fechar(); await carregar(); aviso('Plano salvo.'); } catch (x) { erro.textContent = x.message; erro.hidden = false; } } },
    erro, h('div', { class: 'grid' }, h('div', { class: 'field' }, h('label', {}, 'Nome'), nome), h('div', { class: 'field' }, h('label', {}, 'Preço mensal (R$) — 0 = sem cobrança automática'), preco)),
    h('div', { class: 'field' }, h('label', {}, 'Resumo (página de contratação)'), resumo),
    h('div', { class: 'marcas' }, h('label', {}, ativo, ' Ativo (disponível para novos escritórios)'), h('label', {}, publico, ' À venda na página de contratação'), h('label', {}, destaque, ' Destacar como “mais escolhido”')),
    limites.el, h('div', { class: 'rodape-form' }, h('button', { type: 'button', onclick: () => m.fechar() }, 'Cancelar'), h('button', { class: 'pri' }, 'Salvar plano'))), { larga: true });
}

/* ---------- Contratação pública ---------- */
function telaContratacao() {
  const c = state.contratacao; const corpo = h('div', {}, h('p', { class: 'vazio' }, 'Carregando…'));
  if (!c) { api('GET', '/contratacao').then((r) => { state.contratacao = r; if (state.pagina === 'contratacao') desenhar(); }).catch((x) => corpo.replaceChildren(h('div', { class: 'note err' }, x.message))); return h('div', { class: 'pagina' }, cabecalho('Contratação', 'A página pública onde o cliente escolhe um plano e começa o teste.'), corpo); }
  const linha = (rot, ok, textoOk, textoNao) => h('li', { class: 'status-lin' }, h('span', { class: 'ponto ' + (ok ? 'verde' : 'amarelo') }), h('span', {}, h('b', {}, rot), h('small', {}, ok ? textoOk : textoNao)));
  return h('div', { class: 'pagina' },
    cabecalho('Contratação', 'A página pública onde o cliente escolhe um plano e começa o teste.'),
    c.aberta ? null : h('div', { class: 'note' }, 'A contratação online está FECHADA: a página mostra os planos, mas o formulário vira “Contratação em breve”. Para abrir, defina PAINEL_CONTRATACAO_PUBLICA=1 no arquivo de configuração do painel e reinicie o painel.'),
    h('div', { class: 'duas-colunas' },
      cartao('Página', h('div', {},
        c.link ? h('div', { class: 'linkbox' }, h('a', { href: c.link, target: '_blank', rel: 'noopener noreferrer' }, c.link), h('button', { onclick: () => copiar(c.link) }, 'Copiar')) : h('p', { class: 'vazio' }, 'Defina PAINEL_PUBLIC_URL para mostrar o endereço.'),
        h('ul', { class: 'status-lista' },
          linha('Formulário de contratação', c.aberta, 'Aberto: qualquer pessoa com o link pode se cadastrar.', 'Fechado.'),
          linha('Teste grátis', true, `${c.teste_dias} dias (PAINEL_TESTE_DIAS).`, ''),
          linha('Criação automática do sistema', c.provisionamento_automatico, 'Cada cadastro cria o sistema do escritório no servidor na hora.', 'Desligada: o cadastro só entra no painel e você cria o sistema depois.'),
          linha('Cobrança automática (Asaas)', c.cobranca_configurada, 'A cobrança é criada com vencimento no fim do teste.', 'Sem ASAAS_API_KEY: registre o pagamento à mão.')))),
      cartao('Planos à venda', c.planos_a_venda.length ? h('ul', { class: 'lista' }, c.planos_a_venda.map((p) => h('li', {}, h('div', { class: 'lista-item estatico' }, h('b', {}, p.nome), h('span', { class: 'fim' }, reais(p.preco_centavos) + '/mês'))))) : vazio('Nenhum plano marcado como “à venda”. Edite um plano e marque essa opção.'), { acao: h('button', { class: 'ghost', onclick: () => ir('planos') }, 'Editar planos') })),
    h('div', { class: 'duas-colunas' },
      cartao('Termos de uso e privacidade', h('div', {},
        c.textos_legais.completo ? h('div', { class: 'note ok' }, 'Dados da empresa completos nos textos.') : h('div', { class: 'note' }, 'Faltam dados da empresa nos textos (aparecem como “[a definir]” na página). Defina no arquivo de configuração do painel: ' + c.textos_legais.faltam.join(', ') + '.'),
        h('div', { class: 'linkbox' }, c.textos_legais.termos ? h('a', { href: c.textos_legais.termos, target: '_blank', rel: 'noopener noreferrer' }, 'Termos de uso') : 'Termos de uso', c.textos_legais.privacidade ? h('a', { href: c.textos_legais.privacidade, target: '_blank', rel: 'noopener noreferrer' }, 'Política de privacidade') : null),
        h('p', { class: 'mut sm' }, 'Os textos são uma minuta redigida a partir do que o sistema faz. Peça ao advogado responsável para revisar (prazos de reajuste, limite de responsabilidade, retenção de dados e foro) antes de divulgar o link.'))),
      cartao('E-mails ao cliente', h('div', {},
        c.email.configurado ? h('div', { class: 'note ok' }, 'E-mail configurado' + (c.email.de ? ' (remetente: ' + c.email.de + ')' : '') + '. O cliente recebe a confirmação do cadastro' + (c.email.aviso_admin ? ' e você recebe um aviso em ' + c.email.aviso_admin : '') + '.') : h('div', { class: 'note' }, 'E-mail não configurado: o cliente só vê a confirmação na tela. Defina PAINEL_SMTP_HOST, PAINEL_SMTP_USER, PAINEL_SMTP_PASS (e PAINEL_EMAIL_DE) no arquivo de configuração do painel. Para receber aviso de cada cadastro, defina PAINEL_EMAIL_AVISO.'),
        c.email.configurado ? h('div', { class: 'acoes' }, h('button', { onclick: async (ev) => { const para = prompt('Enviar e-mail de teste para:', c.email.aviso_admin || ''); if (!para) return; ev.target.disabled = true; try { await api('POST', '/email/teste', { para }); aviso('E-mail de teste enviado para ' + para + '.'); } catch (x) { aviso(x.message); } finally { ev.target.disabled = false; } } }, 'Enviar e-mail de teste')) : null))),
    c.aberta && c.provisionamento_automatico ? h('div', { class: 'note' }, 'Atenção: com a criação automática ligada, cada cadastro cria um sistema de verdade no servidor. Acompanhe a Visão geral e a Atividade, e use a exclusão definitiva para limpar testes.') : null);
}

/* ---------- Atividade ---------- */
function telaAtividade() {
  const tipos = Object.keys(ROTULO_EVENTO); const filtro = state.tipoEvento || '';
  const corpo = h('div', { class: 'tabela' }, h('p', { class: 'vazio' }, 'Carregando…'));
  const sel = h('select', { 'aria-label': 'Tipo de evento', onchange: (e) => { state.tipoEvento = e.target.value; state.eventos = null; desenhar(); } }, h('option', { value: '' }, 'Todas as ações'), tipos.map((t) => h('option', { value: t }, ROTULO_EVENTO[t]))); sel.value = filtro;
  const pintar = (ev) => corpo.replaceChildren(h('table', {}, h('thead', {}, h('tr', {}, ['Quando', 'Escritório', 'Ação', 'Detalhe'].map((t) => h('th', {}, t)))), h('tbody', {}, ev.length ? ev.map((e) => h('tr', {}, h('td', { class: 'mut sm nowrap' }, quando(e.criado_em)), h('td', {}, e.nome ? h('a', { href: '#', onclick: (x) => { x.preventDefault(); abrirDetalhe(e.escritorio_id); } }, e.nome) : (e.detalhe?.slug || '—')), h('td', {}, rotuloEvento(e.tipo)), h('td', { class: 'mut sm' }, resumirDetalhe(e.detalhe)))) : h('tr', {}, h('td', { colspan: 4, class: 'vazio' }, 'Nada registrado.')))));
  if (state.eventos) pintar(state.eventos); else api('GET', '/eventos?limite=150' + (filtro ? '&tipo=' + encodeURIComponent(filtro) : '')).then((ev) => { state.eventos = ev; if (state.pagina === 'atividade') pintar(ev); }).catch((x) => corpo.replaceChildren(h('div', { class: 'note err' }, x.message)));
  return h('div', { class: 'pagina' }, cabecalho('Atividade', 'Tudo o que aconteceu no painel, do mais recente para o mais antigo.', sel, h('button', { onclick: () => { state.eventos = null; desenhar(); } }, 'Atualizar')), corpo);
}
function resumirDetalhe(d) { if (!d || typeof d !== 'object') return ''; return Object.entries(d).filter(([k]) => !['ip'].includes(k)).slice(0, 4).map(([k, v]) => `${k.replaceAll('_', ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · '); }

/* ---------- Servidor ---------- */
function telaServidor() {
  const c = state.config;
  const saida = h('div', { class: 'resultado' });
  const rodar = (alvo, rotulo, cls = '') => h('button', { class: cls, onclick: async (ev) => {
    if (alvo !== 'escritorios' && !confirm('O painel fica indisponível por alguns segundos e a página será recarregada. Continuar?')) return;
    ev.target.disabled = true; saida.replaceChildren(h('p', { class: 'mut' }, 'Reiniciando…'));
    try {
      const r = await api('POST', '/servidor/reiniciar', { alvo });
      const feitos = r.escritorios.filter((e) => e.ok && !e.ignorado), ign = r.escritorios.filter((e) => e.ignorado), falhas = r.escritorios.filter((e) => !e.ok);
      saida.replaceChildren(
        feitos.length ? h('p', { class: 'ok-txt' }, '✓ Reiniciados: ' + feitos.map((e) => e.slug).join(', ')) : null,
        ign.length ? h('p', { class: 'mut' }, '— Sem sistema neste servidor (ignorados): ' + ign.map((e) => e.slug).join(', ')) : null,
        falhas.length ? h('div', { class: 'note err' }, '✗ Falharam: ' + falhas.map((e) => e.slug + (e.erro ? ' — ' + String(e.erro).replace(/\x1b\[[0-9;]*m/g, '') : '')).join(' · ')) : null,
        !r.escritorios.length && alvo !== 'painel' ? h('p', { class: 'mut' }, 'Nenhum escritório com sistema para reiniciar.') : null);
      if (r.painel) { saida.append(h('p', { class: 'mut' }, 'Reiniciando o painel… a página recarrega sozinha.')); setTimeout(() => location.reload(), 5000); }
    } catch (x) { saida.replaceChildren(h('div', { class: 'note err' }, x.message)); }
    finally { ev.target.disabled = false; }
  } }, rotulo);
  return h('div', { class: 'pagina' },
    cabecalho('Servidor', 'Atualizações, versões e a configuração do painel.'),
    faixaAtendimento(),
    cartao('Reiniciar sistemas', c.provisionamento_automatico ? h('div', {}, h('p', { class: 'mut' }, 'Use depois de cada atualização (deploy). Escritórios cancelados e sem sistema no servidor são ignorados. Os demais ficam fora do ar por alguns segundos.'), h('div', { class: 'acoes' }, rodar('tudo', 'Reiniciar tudo (escritórios + painel)', 'pri'), rodar('escritorios', 'Só os escritórios'), rodar('painel', 'Só o painel')), saida) : h('p', { class: 'vazio' }, 'O provisionamento automático não está ligado neste servidor (PAINEL_AUTO_PROVISIONAR=1).')),
    h('div', { class: 'duas-colunas' },
      cartao('Cobrança (Asaas)', h('div', {}, h('div', { class: 'note' + (c.cobranca_configurada ? ' ok' : ' err') }, c.cobranca_configurada ? 'Cobrança automática configurada.' : 'Asaas não configurado: defina ASAAS_API_KEY. Enquanto isso, use “Registrar pagamento” no escritório.'), h('div', { class: 'note' + (c.webhook_configurado ? ' ok' : ' err') }, c.webhook_configurado ? 'Webhook configurado.' : 'Defina ASAAS_WEBHOOK_TOKEN para receber os pagamentos.'), c.webhook_url ? bloco('URL do webhook (cadastre no Asaas)', c.webhook_url) : h('p', { class: 'mut sm' }, 'Defina PAINEL_PUBLIC_URL para exibir a URL do webhook.'))),
      cartao('Regras padrão', h('ul', { class: 'status-lista' }, h('li', { class: 'status-lin' }, h('span', {}, h('b', {}, 'Teste grátis'), h('small', {}, c.teste_padrao_dias + ' dias'))), h('li', { class: 'status-lin' }, h('span', {}, h('b', {}, 'Carência após vencer'), h('small', {}, c.carencia_padrao_dias + ' dias'))), h('li', { class: 'status-lin' }, h('span', {}, h('b', {}, 'Domínio dos escritórios'), h('small', {}, '*.' + c.base_domain)))))),
    cartao('Chave pública de licença', h('div', {}, bloco('LICENSE_PUBLIC_KEY_B64 recebe esta chave em base64; o bloco de provisionamento já a inclui', c.chave_publica))));
}

/* ---------- Detalhe do escritório (abas) ---------- */
const ABAS = [['resumo', 'Resumo'], ['plano', 'Plano e limites'], ['cobranca', 'Cobrança'], ['sistema', 'Sistema'], ['historico', 'Histórico'], ['perigo', 'Zona de perigo']];
async function abrirDetalhe(id, aba = 'resumo') {
  let e; try { e = await api('GET', '/escritorios/' + id); } catch (x) { return aviso(x.message); }
  const act = (rot, fn, cls = '') => h('button', { class: cls, onclick: async (ev) => { ev.target.disabled = true; try { await fn(); } catch (x) { aviso(x.message); } finally { ev.target.disabled = false; } } }, rot);
  const recarregar = async (abaAtual) => { painel.fechar(); await carregar(); abrirDetalhe(id, abaAtual || aba); };
  const f = {}; const campo = (k, rot, v, extra = {}) => { f[k] = h('input', { value: v ?? '', ...extra }); return h('div', { class: 'field' }, h('label', {}, rot), f[k]); };
  const painelDe = {};

  const planos = h('select', {}, state.planos.map((p) => h('option', { value: p.id }, p.nome))); planos.value = e.plano_id;
  const obs = h('textarea', { rows: 3 }, e.observacoes);
  const dvc = diasAte(e.vence_em);
  painelDe.resumo = () => h('div', {},
    h('div', { class: 'kpis-mini' },
      h('div', { class: 'mini-kpi' }, h('span', {}, 'Vencimento'), h('b', {}, dia(e.vence_em)), h('small', {}, e.vence_em ? textoDias(dvc) : 'sem vencimento')),
      h('div', { class: 'mini-kpi' }, h('span', {}, 'Carência até'), h('b', {}, dia(e.carencia_ate)), h('small', {}, (e.carencia_dias ?? state.config.carencia_padrao_dias) + ' dias')),
      h('div', { class: 'mini-kpi' }, h('span', {}, 'Último contato'), h('b', {}, e.ultimo_contato_em ? quantoTempo(e.ultimo_contato_em) : 'nunca'), h('small', {}, e.ultima_versao ? 'versão ' + e.ultima_versao : (e.porta ? 'porta ' + e.porta : 'sem sistema'))),
      h('div', { class: 'mini-kpi' }, h('span', {}, 'Criado em'), h('b', {}, dia(e.criado_em)), h('small', {}, e.teste_ate ? 'teste até ' + e.teste_ate.split('-').reverse().join('/') : 'cortesia'))),
    h('p', {}, 'Endereço: ', h('a', { href: e.endereco, target: '_blank', rel: 'noopener noreferrer' }, e.endereco)),
    h('div', { class: 'grid' }, campo('nome', 'Nome', e.nome), campo('email', 'E-mail', e.email), campo('documento', 'CNPJ/CPF', e.documento), campo('telefone', 'Telefone', e.telefone), campo('carencia', 'Carência (dias; vazio = padrão ' + state.config.carencia_padrao_dias + ')', e.carencia_dias, { type: 'number', min: 0, max: 90 })),
    h('div', { class: 'field' }, h('label', {}, 'Observações internas'), obs),
    act('Salvar dados', async () => { await api('PUT', '/escritorios/' + id, { nome: f.nome.value, email: f.email.value, documento: f.documento.value, telefone: f.telefone.value, carencia_dias: f.carencia.value === '' ? null : Number(f.carencia.value), observacoes: obs.value }); aviso('Salvo.'); await recarregar('resumo'); }, 'pri'));

  const limites = campoLimites(e.entitlements);
  painelDe.plano = () => h('div', {},
    h('div', { class: 'field' }, h('label', {}, 'Plano'), planos),
    h('p', { class: 'mut sm' }, 'O escritório recebe os limites e módulos do plano. Abaixo você pode abrir uma exceção só para ele (por exemplo, mais usuários que o plano permite). “Herdar do plano” significa seguir o plano.'),
    limites.el,
    act('Salvar plano e limites', async () => { await api('PUT', '/escritorios/' + id, { plano_id: planos.value, entitlements: limites.valor() }); aviso('Salvo. A instância recebe os novos limites na próxima verificação (até 6 h) ou ao sincronizar.'); await recarregar('plano'); }, 'pri'));

  painelDe.cobranca = () => h('div', {},
    h('div', { class: 'kpis-mini' }, h('div', { class: 'mini-kpi' }, h('span', {}, 'Plano'), h('b', {}, e.plano_nome), h('small', {}, e.preco_centavos ? reais(e.preco_centavos) + '/mês' : 'sem cobrança')), h('div', { class: 'mini-kpi' }, h('span', {}, 'Pago até'), h('b', {}, e.pago_ate ? e.pago_ate.split('-').reverse().join('/') : '—'), h('small', {}, e.asaas_subscription_id ? 'assinatura no Asaas' : 'sem assinatura no Asaas'))),
    e.link_fatura ? h('p', {}, 'Fatura: ', h('a', { href: e.link_fatura, target: '_blank', rel: 'noopener noreferrer' }, 'abrir link de pagamento')) : null,
    h('div', { class: 'acoes' },
      act('Registrar pagamento…', async () => { const ate = prompt('Uso pago até (AAAA-MM-DD):', e.pago_ate || ''); if (!ate) return; await api('POST', `/escritorios/${id}/pagamento-manual`, { ate }); aviso('Pagamento registrado.'); await recarregar('cobranca'); }),
      !e.asaas_subscription_id && e.preco_centavos > 0 ? act('Criar cobrança no Asaas', async () => { const r = await api('POST', `/escritorios/${id}/cobranca`, {}); aviso(r.aviso || 'Cobrança criada.'); await recarregar('cobranca'); }) : null),
    h('h3', { class: 'mini' }, 'Pagamentos'),
    h('div', { class: 'tabela' }, h('table', {}, h('thead', {}, h('tr', {}, ['Evento', 'Valor', 'Vencimento', 'Pago em'].map((t) => h('th', {}, t)))), h('tbody', {}, e.pagamentos.length ? e.pagamentos.map((p) => h('tr', {}, h('td', {}, p.evento.replace('PAYMENT_', '')), h('td', {}, p.valor_centavos != null ? reais(p.valor_centavos) : '—'), h('td', {}, p.vencimento || '—'), h('td', {}, p.pago_em || '—'))) : h('tr', {}, h('td', { colspan: 4, class: 'vazio' }, 'Sem pagamentos registrados.'))))));

  painelDe.sistema = () => h('div', {},
    state.config.atendimento_configurado ? [h('h3', { class: 'mini' }, 'Atendimento (WhatsApp com IA)'), secaoAtendimento(e, id, () => recarregar('sistema'))] : null,
    state.config.provisionamento_automatico ? [h('h3', { class: 'mini' }, 'Sistema no servidor'), secaoInstancia(id, () => recarregar('sistema'))] : h('p', { class: 'vazio' }, 'O provisionamento automático não está ligado neste servidor.'),
    h('h3', { class: 'mini' }, 'Chave de licença'),
    h('p', { class: 'mut sm' }, 'Chave atual começa com ' + e.chave_prefixo + '… (o valor completo não fica guardado). Gerar uma nova invalida a atual.'),
    act('Nova chave de licença…', async () => { const nova = confirm('Gerar nova chave? A chave atual deixa de funcionar. OK = também gerar o bloco para uma instância NOVA.'); if (!confirm('Confirma gerar uma nova chave de licença?')) return; const r = await api('POST', `/escritorios/${id}/nova-chave`, { nova_instancia: nova }); if (r.instancia_atualizada) { aviso('Nova chave aplicada e instância reiniciada.'); return; } mostrarProvisionamento({ chave: r.chave, provisionamento: r.provisionamento }); }));

  painelDe.historico = () => h('div', { class: 'linha-tempo' }, e.eventos.length ? e.eventos.map((ev) => h('div', { class: 'evento' }, h('span', { class: 'bolinha' }), h('div', {}, h('b', {}, rotuloEvento(ev.tipo)), h('small', {}, quando(ev.criado_em) + (resumirDetalhe(ev.detalhe) ? ' · ' + resumirDetalhe(ev.detalhe) : ''))))) : vazio('Sem registros.'));

  painelDe.perigo = () => h('div', { class: 'perigo' },
    h('div', { class: 'perigo-lin' }, h('div', {}, h('b', {}, e.status_manual ? 'Reativar' : 'Suspender'), h('small', {}, e.status_manual ? 'Volta a funcionar normalmente na próxima verificação.' : 'O sistema entra em modo somente leitura na próxima verificação (até 6 h). Os dados ficam guardados.')),
      e.status_manual ? act('Reativar', async () => { await api('POST', `/escritorios/${id}/reativar`, {}); await recarregar('perigo'); }, 'pri') : act('Suspender', async () => { if (!confirm('Suspender este escritório?')) return; await api('POST', `/escritorios/${id}/suspender`, {}); await recarregar('perigo'); }, 'dg')),
    e.status !== 'cancelada' ? h('div', { class: 'perigo-lin' }, h('div', {}, h('b', {}, 'Cancelar assinatura'), h('small', {}, 'Encerra a cobrança e o acesso. Os dados NÃO são apagados.')), act('Cancelar assinatura', async () => { if (!confirm('Cancelar a assinatura deste escritório? Os dados dele não são apagados.')) return; await api('POST', `/escritorios/${id}/cancelar`, {}); await recarregar('perigo'); }, 'dg')) : null,
    h('div', { class: 'perigo-lin grave' }, h('div', {}, h('b', {}, 'Excluir por completo'), h('small', {}, e.status === 'cancelada' ? 'Apaga o cadastro, os pagamentos, o histórico e o sistema do servidor com todos os dados. Não tem volta.' : 'Disponível só depois de cancelar a assinatura.')),
      h('button', { class: 'perigo-botao', disabled: e.status !== 'cancelada', onclick: () => confirmarExclusao(e, () => { painel.fechar(); }) }, 'Excluir por completo…')));

  const abas = h('div', { class: 'abas', role: 'tablist' });
  const area = h('div', { class: 'aba-corpo' });
  const mostrar = (a) => { abas.querySelectorAll('button').forEach((b) => { b.classList.toggle('ativa', b.dataset.aba === a); b.setAttribute('aria-selected', b.dataset.aba === a ? 'true' : 'false'); }); area.replaceChildren(painelDe[a]()); };
  for (const [a, rot] of ABAS) abas.append(h('button', { role: 'tab', 'data-aba': a, class: a === 'perigo' ? 'perigo-aba' : '', onclick: () => mostrar(a) }, rot));
  const conteudo = h('div', {}, h('div', { class: 'detalhe-topo' }, badge(e.status), h('span', { class: 'mut' }, e.plano_nome + ' · ' + e.slug)), abas, area);
  const painel = modal(e.nome, conteudo, { lateral: true });
  mostrar(aba);
}

/** Exclusão definitiva: explica o que some e só libera o botão quando o endereço é digitado. */
function confirmarExclusao(e, aoExcluir) {
  const campo = h('input', { placeholder: e.slug, autocomplete: 'off', 'aria-label': 'Digite o endereço para confirmar' });
  const erro = h('div', { class: 'note err', hidden: true });
  const botao = h('button', { class: 'perigo-botao', disabled: true }, 'Excluir por completo');
  campo.addEventListener('input', () => { botao.disabled = campo.value.trim() !== e.slug; });
  botao.addEventListener('click', async () => {
    botao.disabled = true; botao.textContent = 'Excluindo…'; erro.hidden = true;
    try {
      const r = await api('DELETE', '/escritorios/' + e.id, { confirmar: campo.value.trim() });
      m.fechar(); aoExcluir(); await carregar();
      aviso(r.servidor.instancia_e_dados_apagados ? `“${e.nome}” excluído por completo (sistema e dados apagados do servidor).` : `“${e.nome}” excluído do painel. ${r.servidor.aviso}`);
    } catch (x) { erro.textContent = x.message; erro.hidden = false; botao.textContent = 'Excluir por completo'; botao.disabled = campo.value.trim() !== e.slug; }
  });
  const m = modal('Excluir por completo', h('div', {},
    h('div', { class: 'note err forte' }, h('b', {}, 'Isto apaga tudo e não tem volta.')),
    h('p', {}, 'Ao excluir “' + e.nome + '” (' + e.slug + ') serão removidos:'),
    h('ul', { class: 'consequencias' }, h('li', {}, 'o cadastro, os pagamentos e o histórico no painel;'), h('li', {}, 'o sistema do escritório no servidor (processo e endereço);'), h('li', {}, 'a pasta do escritório no servidor, com o banco de dados e os arquivos dele.')),
    h('p', { class: 'mut sm' }, 'A assinatura no Asaas já foi cancelada ao cancelar o escritório. O cadastro dele no atendimento (Deskcomm), se existir, não é apagado por aqui.'),
    h('div', { class: 'field' }, h('label', {}, 'Para confirmar, digite o endereço: ', h('b', {}, e.slug)), campo), erro,
    h('div', { class: 'rodape-form' }, h('button', { onclick: () => m.fechar() }, 'Cancelar'), botao)));
  campo.focus();
}

/** Faixa de versão do atendimento (DeskcommCRM): em uso x mais nova do original. Só aparece com o atendimento configurado. */
async function carregarVersaoAtendimento(forcar = false) {
  if (!state.config?.atendimento_configurado) return;
  try { state.versaoAtendimento = await api('GET', '/atendimento/versao' + (forcar ? '?forcar=1' : '')); }
  catch (x) { state.versaoAtendimento = { erro: x.message }; }
  desenhar();
}
function faixaAtendimento() {
  if (!state.config?.atendimento_configurado) return null;
  const v = state.versaoAtendimento;
  const verificar = h('button', { onclick: async (ev) => { ev.target.disabled = true; await carregarVersaoAtendimento(true); } }, 'Verificar agora');
  if (!v) return h('div', { class: 'note' }, 'Atendimento (Deskcomm): verificando a versão…');
  if (v.erro) return h('div', { class: 'note err' }, 'Atendimento (Deskcomm): ' + v.erro + ' ', verificar);
  const uso = v.em_uso ? `${v.em_uso.base} (imagem ${v.em_uso.imagem})` : 'versão em uso desconhecida';
  if (v.atualizacao_disponivel) return h('div', { class: 'note warn' }, h('b', {}, 'Atendimento (Deskcomm): há versão nova do original. '), `Em uso: ${uso} · nova: ${v.original} `,
    v.notas_url ? h('a', { href: v.notas_url, target: '_blank', rel: 'noopener noreferrer' }, 'ver novidades') : null, ' · peça ao Claude para trazer a versão nova. ', verificar);
  const avisos = (v.avisos || []).length ? h('span', { class: 'mut sm' }, ' ' + v.avisos.join(' ')) : null;
  return h('div', { class: 'note ' + (v.em_uso && v.original ? 'ok' : '') }, `Atendimento (Deskcomm): em uso ${uso}` + (v.original ? ` · original: ${v.original}` + (v.em_uso ? ' · em dia ✔' : '') : ''), avisos, ' ', verificar);
}

function modal(titulo, conteudo, { lateral = false, larga = false } = {}) {
  const fechar = () => ov.remove();
  const ov = h('div', { class: 'overlay' + (lateral ? '' : ' center'), onclick: (e) => { if (e.target === ov) fechar(); } },
    h('div', { class: lateral ? 'panel' : 'modal' + (larga ? ' larga' : ''), role: 'dialog', 'aria-label': titulo }, h('div', { class: 'row2', style: 'justify-content:space-between' }, h('h2', { style: 'margin:0;font-size:18px' }, titulo), h('button', { class: 'ghost', onclick: fechar }, 'Fechar')), conteudo));
  document.body.append(ov); return { fechar };
}
const slugDe = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

function abrirNovo() {
  const f = {}; const campo = (id, rot, extra = {}) => { f[id] = h('input', { id, ...extra }); return h('div', { class: 'field' }, h('label', { for: id }, rot), f[id]); };
  const planos = h('select', {}, state.planos.filter((p) => p.ativo).map((p) => h('option', { value: p.id }, `${p.nome} — ${p.preco_centavos ? reais(p.preco_centavos) + '/mês' : 'sem cobrança automática'}`)));
  const cortesia = h('input', { type: 'checkbox', id: 'cortesia', style: 'min-height:auto' });
  const erro = h('div', { class: 'note err', hidden: true });
  const limites = campoLimites({});
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); erro.hidden = true;
    try {
      const r = await api('POST', '/escritorios', { nome: f.nome.value, slug: f.slug.value, email: f.email.value, documento: f.documento.value, telefone: f.telefone.value, plano_id: planos.value, teste_dias: f.teste.value, cortesia: cortesia.checked, porta: f.porta.value, admin_usuario: f.admin_usuario.value, admin_senha: f.admin_senha.value, entitlements: limites.valor() });
      m.fechar(); await carregar(); mostrarProvisionamento(r);
    } catch (x) { erro.textContent = x.message; erro.hidden = false; }
  } }, erro,
    h('div', { class: 'grid' }, campo('nome', 'Nome do escritório', { required: true, oninput: () => { if (!f.slug.dataset.manual) f.slug.value = slugDe(f.nome.value); } }), campo('slug', 'Endereço (subdomínio)', { required: true, pattern: '[a-z0-9][a-z0-9\\-]{2,40}[a-z0-9]', oninput: () => { f.slug.dataset.manual = '1'; } }),
      campo('email', 'E-mail do responsável', { type: 'email', required: true }), campo('documento', 'CNPJ/CPF'), campo('telefone', 'Telefone'), h('div', { class: 'field' }, h('label', {}, 'Plano'), planos),
      campo('teste', 'Dias de teste', { type: 'number', min: 0, max: 365, value: String(state.config.teste_padrao_dias) }), campo('porta', state.config.provisionamento_automatico ? 'Porta (deixe vazio: automática)' : 'Porta da instância (servidor)', { type: 'number', min: 1024, max: 65535, value: state.config.provisionamento_automatico ? '' : '3400' })),
    h('div', { class: 'sec' }, 'Acesso do administrador do escritório'),
    h('div', { class: 'grid' }, campo('admin_usuario', 'Usuário', { value: 'admin', pattern: '[A-Za-z0-9._@\\-]{3,60}', autocomplete: 'off' }), h('div', { class: 'field' }, h('label', { for: 'admin_senha' }, 'Senha inicial (12+ caracteres; vazio = gerar)'), h('div', { class: 'row2' }, f.admin_senha = h('input', { id: 'admin_senha', type: 'text', autocomplete: 'off', minlength: 12, maxlength: 100, placeholder: 'gerada automaticamente' }), h('button', { type: 'button', onclick: () => { const a = new Uint8Array(12); crypto.getRandomValues(a); f.admin_senha.value = Array.from(a, (b) => 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 56]).join('') + '7'; } }, 'Gerar')))),
    h('p', { class: 'mut sm' }, 'No primeiro acesso, o sistema pede que a pessoa crie a própria senha. A senha inicial não fica guardada no painel.'),
    h('div', { class: 'field' }, h('label', {}, cortesia, ' Cortesia (sem teste, sem vencimento e sem cobrança)')),
    h('div', { class: 'sec' }, 'Ajustes de limites deste escritório (opcional)'), limites.el,
    h('button', { class: 'pri' }, 'Criar escritório'));
  const m = modal('Novo escritório', form);
}

function detalhesTecnicos(r) {
  const p = r.provisionamento; if (!p) return null;
  return h('details', {}, h('summary', {}, 'Detalhes técnicos (chave de licença e configuração manual)'),
    h('div', { class: 'sec' }, 'Chave de licença'), h('pre', {}, r.chave || ''),
    bloco('Arquivo .env da instância', p.env), bloco('Comandos (PM2)', p.pm2), bloco('Proxy (nginx)', p.nginx), p.observacao ? h('p', { class: 'mut sm' }, p.observacao) : null);
}
function mostrarProvisionamento(r) {
  const i = r.instancia;
  if (i && i.ok) {
    modal('Escritório pronto', h('div', {},
      r.aviso ? h('div', { class: 'note' }, r.aviso) : null,
      h('p', {}, 'O sistema do escritório já está no ar. Envie ao responsável:'),
      h('div', { class: 'tile' }, h('span', {}, 'Endereço'), h('b', { style: 'font-size:16px' }, h('a', { href: i.url, target: '_blank', rel: 'noopener noreferrer' }, i.url))),
      i.senha_inicial ? h('div', { class: 'tile' }, h('span', {}, 'Usuário: ' + (i.usuario || 'admin') + ' · Senha inicial (aparece só agora; peça para trocar no 1º acesso)'), h('b', { style: 'font-size:16px' }, i.senha_inicial), h('button', { onclick: () => copiar(i.senha_inicial) }, 'Copiar senha')) : null,
      h('button', { class: 'pri', onclick: () => copiar(`Acesso ao DisparaZap\nEndereço: ${i.url}\nUsuário: ${i.usuario || 'admin'}\nSenha inicial: ${i.senha_inicial || ''}\nTroque a senha no primeiro acesso.`) }, 'Copiar mensagem de acesso'),
      (i.avisos || []).map((a) => h('p', { class: 'mut sm' }, a)), detalhesTecnicos(r)));
    return;
  }
  modal(i ? 'Escritório criado — falta ativar o sistema' : 'Escritório criado — guarde estas informações', h('div', {},
    i ? h('div', { class: 'note err' }, 'O escritório foi cadastrado, mas a instância não foi criada automaticamente: ' + i.erro + ' Abra o escritório e use “Criar/ativar sistema no servidor” para tentar de novo.') : null,
    r.aviso ? h('div', { class: 'note' }, r.aviso) : null,
    h('div', { class: 'note' }, 'A chave de licença e o ENCRYPTION_KEY são exibidos somente agora e não ficam guardados no painel. Copie e guarde com segurança.'),
    h('div', { class: 'sec' }, 'Chave de licença'), h('pre', {}, r.chave || ''),
    r.provisionamento ? [bloco('Arquivo .env da instância', r.provisionamento.env), bloco('Comandos (PM2)', r.provisionamento.pm2), bloco('Proxy (nginx)', r.provisionamento.nginx), r.provisionamento.observacao ? h('p', { class: 'mut sm' }, r.provisionamento.observacao) : null] : null));
}

/** Estado do escritório no atendimento (DeskcommCRM): o painel cria, suspende e reativa sozinho conforme o plano e o pagamento. */
function secaoAtendimento(e, id, recarregar) {
  const rotulo = e.atendimento_estado === 'ativo' ? 'Ativo' : e.atendimento_estado === 'suspenso' ? 'Suspenso' : 'Ainda não criado';
  const erro = e.atendimento_erro ? h('div', { class: 'note err' }, 'Última tentativa falhou: ' + e.atendimento_erro) : null;
  const botao = h('button', { class: 'pri', onclick: async (ev) => { ev.target.disabled = true; try { await api('POST', `/escritorios/${id}/atendimento/sincronizar`, {}); aviso('Atendimento sincronizado.'); await recarregar(); } catch (x) { aviso(x.message); } finally { ev.target.disabled = false; } } }, 'Sincronizar agora');
  return h('div', {},
    h('div', { class: 'row2' }, h('span', { class: 'badge b-' + (e.atendimento_estado === 'ativo' ? 'ativa' : 'suspensa') }, rotulo),
      h('span', { class: 'mut' }, e.atendimento_disponivel ? 'O plano inclui o atendimento; ele é criado e mantido em dia automaticamente.' : 'O plano deste escritório não inclui o módulo de atendimento (ligue “Atendimento e vendas” em Limites do plano ou do escritório).'),
      e.atendimento_disponivel || e.atendimento_estado ? botao : null),
    erro);
}

function secaoInstancia(id, recarregar) {
  const caixa = h('div', { class: 'row2' }, h('span', { class: 'mut' }, 'Verificando…'));
  const rodar = (rot, fn, cls = '') => h('button', { class: cls, onclick: async (ev) => { ev.target.disabled = true; try { await fn(); } catch (x) { aviso(x.message); } finally { ev.target.disabled = false; } } }, rot);
  api('GET', `/escritorios/${id}/instancia`).then((s) => {
    caixa.replaceChildren();
    const est = s.status === 'online' ? 'No ar' : s.status === 'parada' ? 'Parada' : 'Não criada';
    caixa.append(h('span', { class: 'badge b-' + (s.status === 'online' ? 'ativa' : 'suspensa') }, est), h('span', { class: 'mut' }, s.url));
    if (s.status === 'ausente' || !s.existe_no_disco || !s.no_mapa) caixa.append(rodar('Criar/ativar sistema no servidor', async () => {
      const r = await api('POST', `/escritorios/${id}/instancia`, {});
      mostrarProvisionamento({ instancia: { ok: true, url: r.url, usuario: 'admin', senha_inicial: r.senha_inicial, avisos: r.avisos } }); await recarregar();
    }, 'pri'));
    else {
      caixa.append(rodar('Reiniciar', async () => { await api('POST', `/escritorios/${id}/instancia/reiniciar`, {}); aviso('Reiniciada.'); }));
      caixa.append(rodar('Remover do servidor…', async () => { if (!confirm('Parar o sistema deste escritório e tirar o endereço do ar? Os dados dele ficam guardados no servidor.')) return; await api('POST', `/escritorios/${id}/instancia/remover`, {}); aviso('Removido do ar.'); await recarregar(); }, 'dg'));
    }
  }).catch((x) => { caixa.replaceChildren(h('span', { class: 'mut' }, x.message)); });
  return caixa;
}

async function iniciar() {
  let me; try { me = await api('GET', '/me'); } catch { return mostrarLogin(); }
  state.versao = me.versao || '';
  state.config = await api('GET', '/config'); await carregar(); void carregarVersaoAtendimento();
}

iniciar();
