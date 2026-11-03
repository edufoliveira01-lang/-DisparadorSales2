'use strict';
const $app = document.getElementById('app');
const state = { config: null, planos: [], escritorios: [], aba: 'escritorios', busca: '', filtro: '' };
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

async function carregar() {
  [state.escritorios, state.planos] = await Promise.all([api('GET', '/escritorios'), api('GET', '/planos')]);
  desenhar();
}
function desenhar() {
  const cont = (s) => state.escritorios.filter((e) => e.status === s).length;
  const lista = state.escritorios.filter((e) => (!state.filtro || e.status === state.filtro) && (!state.busca || (e.nome + e.slug + e.email).toLowerCase().includes(state.busca.toLowerCase())));
  const tile = (rot, n, f) => h('button', { class: 'tile', style: 'text-align:left;cursor:pointer', onclick: () => { state.filtro = state.filtro === f ? '' : f; desenhar(); } }, h('b', {}, n), h('span', {}, rot));
  const topo = h('header', { class: 'top' }, h('h1', {}, 'DisparaZap · Assinaturas'),
    h('nav', {}, h('button', { class: state.aba === 'escritorios' ? 'pri' : '', onclick: () => { state.aba = 'escritorios'; desenhar(); } }, 'Escritórios'), h('button', { class: state.aba === 'planos' ? 'pri' : '', onclick: () => { state.aba = 'planos'; desenhar(); } }, 'Planos'), h('button', { onclick: abrirConfig }, 'Configuração')),
    h('button', { onclick: async () => { await api('POST', '/logout', {}); mostrarLogin(); } }, 'Sair'));
  let corpo;
  if (state.aba === 'planos') corpo = telaPlanos();
  else corpo = h('div', {},
    h('div', { class: 'tiles' }, tile('Ativos', cont('ativa'), 'ativa'), tile('Em teste', cont('teste'), 'teste'), tile('Em carência', cont('carencia'), 'carencia'), tile('Suspensos', cont('suspensa'), 'suspensa'), tile('Cancelados', cont('cancelada'), 'cancelada')),
    h('div', { class: 'bar' }, h('input', { placeholder: 'Buscar escritório, endereço ou e-mail…', value: state.busca, style: 'flex:1;min-width:220px', oninput: (e) => { state.busca = e.target.value; clearTimeout(desenhar.t); desenhar.t = setTimeout(() => { desenhar(); document.querySelector('.bar input')?.focus(); }, 250); } }), h('button', { class: 'pri', onclick: abrirNovo }, '+ Novo escritório')),
    h('div', { class: 'card' }, h('table', {}, h('thead', {}, h('tr', {}, ['Escritório', 'Endereço', 'Plano', 'Situação', 'Vence em', 'Último contato'].map((t) => h('th', {}, t)))),
      h('tbody', {}, lista.length ? lista.map((e) => h('tr', { class: 'row', onclick: () => abrirDetalhe(e.id) }, h('td', {}, h('b', {}, e.nome), h('div', { class: 'mut sm' }, e.email)), h('td', {}, e.slug), h('td', {}, e.plano_nome), h('td', {}, badge(e.status)), h('td', {}, dia(e.vence_em)), h('td', {}, quando(e.ultimo_contato_em)))) : h('tr', {}, h('td', { colspan: 6, class: 'mut' }, 'Nenhum escritório.'))))));
  $app.replaceChildren(topo, h('main', {}, corpo));
}

function modal(titulo, conteudo, { lateral = false } = {}) {
  const fechar = () => ov.remove();
  const ov = h('div', { class: 'overlay' + (lateral ? '' : ' center'), onclick: (e) => { if (e.target === ov) fechar(); } },
    h('div', { class: lateral ? 'panel' : 'modal', role: 'dialog', 'aria-label': titulo }, h('div', { class: 'row2', style: 'justify-content:space-between' }, h('h2', { style: 'margin:0;font-size:18px' }, titulo), h('button', { class: 'ghost', onclick: fechar }, 'Fechar')), conteudo));
  document.body.append(ov); return { fechar };
}
const slugDe = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

function campoLimites(valores) {
  const defs = state.config.entitlements, entradas = {};
  const caixa = h('div', {});
  for (const [chave, def] of Object.entries(defs)) {
    const atual = valores && chave in valores ? valores[chave] : undefined;
    let sel, num;
    if (def.tipo === 'recurso') {
      sel = h('select', {}, h('option', { value: 'herdar' }, 'Herdar do plano'), h('option', { value: 'on' }, 'Ligado'), h('option', { value: 'off' }, 'Desligado'));
      sel.value = atual === undefined ? 'herdar' : atual ? 'on' : 'off';
      entradas[chave] = () => (sel.value === 'herdar' ? undefined : sel.value === 'on');
      caixa.append(h('div', { class: 'field' }, h('label', {}, def.rotulo), sel));
    } else {
      sel = h('select', {}, h('option', { value: 'herdar' }, 'Herdar do plano'), h('option', { value: 'ilim' }, 'Ilimitado'), h('option', { value: 'lim' }, 'Limite…'));
      num = h('input', { type: 'number', min: 0, step: 1, style: 'margin-top:6px', hidden: true });
      sel.value = atual === undefined ? 'herdar' : atual === null ? 'ilim' : 'lim'; if (typeof atual === 'number') num.value = atual;
      const sync = () => { num.hidden = sel.value !== 'lim'; }; sel.addEventListener('change', sync); sync();
      entradas[chave] = () => (sel.value === 'herdar' ? undefined : sel.value === 'ilim' ? null : Number(num.value));
      caixa.append(h('div', { class: 'field' }, h('label', {}, def.rotulo), sel, num));
    }
  }
  return { el: caixa, valor: () => Object.fromEntries(Object.entries(entradas).map(([k, f]) => [k, f()]).filter(([, v]) => v !== undefined)) };
}

function abrirNovo() {
  const f = {}; const campo = (id, rot, extra = {}) => { f[id] = h('input', { id, ...extra }); return h('div', { class: 'field' }, h('label', { for: id }, rot), f[id]); };
  const planos = h('select', {}, state.planos.filter((p) => p.ativo).map((p) => h('option', { value: p.id }, `${p.nome} — ${p.preco_centavos ? reais(p.preco_centavos) + '/mês' : 'sem cobrança automática'}`)));
  const cortesia = h('input', { type: 'checkbox', id: 'cortesia', style: 'min-height:auto' });
  const erro = h('div', { class: 'note err', hidden: true });
  const limites = campoLimites({});
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault(); erro.hidden = true;
    try {
      const r = await api('POST', '/escritorios', { nome: f.nome.value, slug: f.slug.value, email: f.email.value, documento: f.documento.value, telefone: f.telefone.value, plano_id: planos.value, teste_dias: f.teste.value, cortesia: cortesia.checked, porta: f.porta.value, entitlements: limites.valor() });
      m.fechar(); await carregar(); mostrarProvisionamento(r);
    } catch (x) { erro.textContent = x.message; erro.hidden = false; }
  } }, erro,
    h('div', { class: 'grid' }, campo('nome', 'Nome do escritório', { required: true, oninput: () => { if (!f.slug.dataset.manual) f.slug.value = slugDe(f.nome.value); } }), campo('slug', 'Endereço (subdomínio)', { required: true, pattern: '[a-z0-9][a-z0-9\\-]{2,40}[a-z0-9]', oninput: () => { f.slug.dataset.manual = '1'; } }),
      campo('email', 'E-mail do responsável', { type: 'email', required: true }), campo('documento', 'CNPJ/CPF'), campo('telefone', 'Telefone'), h('div', { class: 'field' }, h('label', {}, 'Plano'), planos),
      campo('teste', 'Dias de teste', { type: 'number', min: 0, max: 365, value: String(state.config.teste_padrao_dias) }), campo('porta', state.config.provisionamento_automatico ? 'Porta (deixe vazio: automática)' : 'Porta da instância (servidor)', { type: 'number', min: 1024, max: 65535, value: state.config.provisionamento_automatico ? '' : '3400' })),
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

async function abrirDetalhe(id) {
  const e = await api('GET', '/escritorios/' + id);
  const f = {}; const campo = (k, rot, v, extra = {}) => { f[k] = h('input', { value: v ?? '', ...extra }); return h('div', { class: 'field' }, h('label', {}, rot), f[k]); };
  const planos = h('select', {}, state.planos.map((p) => h('option', { value: p.id }, p.nome))); planos.value = e.plano_id;
  const limites = campoLimites(e.entitlements);
  const obs = h('textarea', { rows: 3, style: 'width:100%' }, e.observacoes);
  const act = (rot, fn, cls = '') => h('button', { class: cls, onclick: async (ev) => { ev.target.disabled = true; try { await fn(); } catch (x) { aviso(x.message); } finally { ev.target.disabled = false; } } }, rot);
  const recarregar = async () => { painel.fechar(); await carregar(); abrirDetalhe(id); };
  const conteudo = h('div', {},
    h('div', { class: 'row2' }, badge(e.status), h('span', { class: 'mut' }, `${e.endereco} · criado em ${dia(e.criado_em)}`)),
    h('div', { class: 'grid' },
      h('div', { class: 'tile' }, h('span', {}, 'Vencimento (fim do período pago/teste)'), h('b', { style: 'font-size:18px' }, dia(e.vence_em))),
      h('div', { class: 'tile' }, h('span', {}, 'Último contato da instância'), h('b', { style: 'font-size:18px' }, quando(e.ultimo_contato_em)), h('span', {}, e.ultima_versao ? 'versão ' + e.ultima_versao : ''))),
    e.link_fatura ? h('p', {}, 'Fatura: ', h('a', { href: e.link_fatura, target: '_blank', rel: 'noopener noreferrer' }, 'abrir link de pagamento')) : null,
    state.config.provisionamento_automatico ? h('div', { class: 'sec' }, 'Sistema no servidor') : null,
    state.config.provisionamento_automatico ? secaoInstancia(id, recarregar) : null,
    h('div', { class: 'sec' }, 'Ações'),
    h('div', { class: 'row2' },
      act('Registrar pagamento…', async () => { const ate = prompt('Uso pago até (AAAA-MM-DD):', e.pago_ate || ''); if (!ate) return; await api('POST', `/escritorios/${id}/pagamento-manual`, { ate }); aviso('Pagamento registrado.'); await recarregar(); }),
      e.status_manual ? act('Reativar', async () => { await api('POST', `/escritorios/${id}/reativar`, {}); await recarregar(); }, 'pri') : act('Suspender', async () => { if (!confirm('Suspender? A instância entra em modo somente leitura na próxima verificação (até 6 h).')) return; await api('POST', `/escritorios/${id}/suspender`, {}); await recarregar(); }, 'dg'),
      !e.asaas_subscription_id && e.preco_centavos > 0 ? act('Criar cobrança no Asaas', async () => { const r = await api('POST', `/escritorios/${id}/cobranca`, {}); aviso(r.aviso || 'Cobrança criada.'); await recarregar(); }) : null,
      act('Nova chave de licença…', async () => { const nova = confirm('Gerar nova chave? A chave atual deixa de funcionar. OK = também gerar o bloco para uma instância NOVA.'); if (!confirm('Confirma gerar uma nova chave de licença?')) return; const r = await api('POST', `/escritorios/${id}/nova-chave`, { nova_instancia: nova }); if (r.instancia_atualizada) { aviso('Nova chave aplicada e instância reiniciada.'); return; } mostrarProvisionamento({ chave: r.chave, provisionamento: r.provisionamento }); }),
      e.status !== 'cancelada' ? act('Cancelar assinatura', async () => { if (!confirm('Cancelar a assinatura deste escritório? Os dados dele não são apagados.')) return; await api('POST', `/escritorios/${id}/cancelar`, {}); await recarregar(); }, 'dg') : null),
    h('div', { class: 'sec' }, 'Dados'),
    h('div', { class: 'grid' }, campo('nome', 'Nome', e.nome), campo('email', 'E-mail', e.email), campo('documento', 'CNPJ/CPF', e.documento), campo('telefone', 'Telefone', e.telefone), h('div', { class: 'field' }, h('label', {}, 'Plano'), planos), campo('carencia', 'Carência (dias; vazio = padrão ' + state.config.carencia_padrao_dias + ')', e.carencia_dias, { type: 'number', min: 0, max: 90 })),
    h('div', { class: 'field' }, h('label', {}, 'Observações internas'), obs),
    h('div', { class: 'sec' }, 'Limites específicos deste escritório'), limites.el,
    act('Salvar alterações', async () => { await api('PUT', '/escritorios/' + id, { nome: f.nome.value, email: f.email.value, documento: f.documento.value, telefone: f.telefone.value, plano_id: planos.value, carencia_dias: f.carencia.value === '' ? null : Number(f.carencia.value), observacoes: obs.value, entitlements: limites.valor() }); aviso('Salvo.'); await recarregar(); }, 'pri'),
    h('div', { class: 'sec' }, 'Pagamentos'),
    h('div', { class: 'card' }, h('table', {}, h('thead', {}, h('tr', {}, ['Evento', 'Valor', 'Vencimento', 'Pago em'].map((t) => h('th', {}, t)))), h('tbody', {}, e.pagamentos.length ? e.pagamentos.map((p) => h('tr', {}, h('td', {}, p.evento.replace('PAYMENT_', '')), h('td', {}, p.valor_centavos != null ? reais(p.valor_centavos) : '—'), h('td', {}, p.vencimento || '—'), h('td', {}, p.pago_em || '—'))) : h('tr', {}, h('td', { colspan: 4, class: 'mut' }, 'Sem pagamentos registrados.'))))),
    h('div', { class: 'sec' }, 'Histórico'),
    h('div', { class: 'card' }, h('table', {}, h('tbody', {}, e.eventos.map((ev) => h('tr', {}, h('td', { class: 'mut sm' }, quando(ev.criado_em)), h('td', {}, ev.tipo.replaceAll('_', ' '))))))));
  const painel = modal(e.nome, conteudo, { lateral: true });
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

function telaPlanos() {
  const linhas = state.planos.map((p) => h('tr', { class: 'row', onclick: () => editarPlano(p) }, h('td', {}, h('b', {}, p.nome)), h('td', {}, p.preco_centavos ? reais(p.preco_centavos) + '/mês' : 'sem cobrança automática'), h('td', {}, Object.entries(p.entitlements).map(([k, v]) => `${state.config.entitlements[k]?.rotulo || k}: ${v === null ? 'ilimitado' : v === true ? 'ligado' : v === false ? 'desligado' : v}`).join(' · ') || 'Padrão do sistema (ilimitado)'), h('td', {}, p.ativo ? 'Ativo' : 'Inativo')));
  return h('div', {}, h('div', { class: 'bar' }, h('span', { class: 'mut', style: 'flex:1' }, 'Os limites do plano valem para todos os escritórios dele, salvo ajuste específico. Hoje: advogados e usuários ilimitados.'), h('button', { class: 'pri', onclick: () => editarPlano(null) }, '+ Novo plano')),
    h('div', { class: 'card' }, h('table', {}, h('thead', {}, h('tr', {}, ['Plano', 'Preço', 'Limites', 'Situação'].map((t) => h('th', {}, t)))), h('tbody', {}, linhas))));
}
function editarPlano(p) {
  const nome = h('input', { value: p?.nome || '', required: true }), preco = h('input', { type: 'number', min: 0, step: '0.01', value: p ? (p.preco_centavos / 100).toFixed(2) : '' });
  const ativo = h('input', { type: 'checkbox', style: 'min-height:auto' }); ativo.checked = p ? p.ativo : true;
  const limites = campoLimites(p?.entitlements || {}); const erro = h('div', { class: 'note err', hidden: true });
  const m = modal(p ? 'Editar plano' : 'Novo plano', h('form', { onsubmit: async (e) => { e.preventDefault(); try { const corpo = { nome: nome.value, preco_centavos: Math.round(Number(preco.value || 0) * 100), entitlements: limites.valor(), ativo: ativo.checked }; if (p) await api('PUT', '/planos/' + p.id, corpo); else await api('POST', '/planos', corpo); m.fechar(); await carregar(); } catch (x) { erro.textContent = x.message; erro.hidden = false; } } },
    erro, h('div', { class: 'field' }, h('label', {}, 'Nome'), nome), h('div', { class: 'field' }, h('label', {}, 'Preço mensal (R$) — 0 = sem cobrança automática'), preco),
    h('label', {}, ativo, ' Plano ativo (disponível para novos escritórios)'), h('div', { class: 'sec' }, 'Limites e recursos'), limites.el, h('button', { class: 'pri' }, 'Salvar')));
}
function abrirConfig() {
  const c = state.config;
  modal('Configuração', h('div', {},
    h('div', { class: 'note' + (c.cobranca_configurada ? '' : ' err') }, c.cobranca_configurada ? 'Cobrança automática (Asaas) configurada.' : 'Asaas não configurado: defina ASAAS_API_KEY. Enquanto isso, use “Registrar pagamento”.'),
    h('div', { class: 'note' + (c.webhook_configurado ? '' : ' err') }, c.webhook_configurado ? 'Webhook configurado.' : 'Defina ASAAS_WEBHOOK_TOKEN para receber os pagamentos.'),
    c.webhook_url ? bloco('URL do webhook (cadastre no Asaas)', c.webhook_url) : h('p', { class: 'mut sm' }, 'Defina PAINEL_PUBLIC_URL para exibir a URL do webhook.'),
    bloco('Chave pública de licença (LICENSE_PUBLIC_KEY_B64 recebe esta chave em base64; o bloco de provisionamento já a inclui)', c.chave_publica),
    h('p', { class: 'mut sm' }, 'Domínio base dos escritórios: ' + c.base_domain)));
}

async function iniciar() {
  try { await api('GET', '/me'); } catch { return mostrarLogin(); }
  state.config = await api('GET', '/config'); await carregar();
}
iniciar();
