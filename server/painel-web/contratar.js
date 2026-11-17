'use strict';
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reais = function (c) { return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); };
  function el(tag, attrs, filhos) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (filhos || []).forEach(function (f) { if (f) n.append(f); });
    return n;
  }

  /* ---------- animações: sem suporte nativo a rolagem guiada, o IntersectionObserver faz o mesmo papel ---------- */
  var nativo = window.CSS && CSS.supports && CSS.supports('animation-timeline: view()');
  var reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function observar(nos) {
    if (nativo || reduzido) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('on'); io.unobserve(e.target); } });
    }, { threshold: 0.15 });
    nos.forEach(function (n) { io.observe(n); });
  }
  if (!nativo && !reduzido) document.documentElement.classList.add('js-fallback');
  observar($$('.revela'));

  function cenaFallback() {
    if (nativo || reduzido) return;
    var cena = $('.cena');
    if (!cena) return;
    var lis = $$('.passos li'), mods = $$('.modulo'), trilho = $('.trilho i'), barra = $('.progresso');
    function atualizar() {
      var r = cena.getBoundingClientRect(), vh = window.innerHeight;
      var total = r.height + vh, vistos = Math.min(Math.max(vh - r.top, 0), total), p = vistos / total;
      var ativo = Math.min(5, Math.max(0, Math.floor((p - 0.2) / 0.12) + 1));
      lis.forEach(function (li, i) { li.classList.toggle('on', i === ativo - 1); });
      mods.forEach(function (m, i) { m.classList.toggle('on', i < ativo); });
      if (trilho) trilho.style.transform = 'scaleY(' + Math.min(1, Math.max(0, (p - 0.2) / 0.6)) + ')';
      var h = document.documentElement;
      if (barra) barra.style.transform = 'scaleX(' + (h.scrollTop / Math.max(1, h.scrollHeight - h.clientHeight)) + ')';
    }
    window.addEventListener('scroll', atualizar, { passive: true });
    window.addEventListener('resize', atualizar);
    atualizar();
  }
  cenaFallback();

  /* ---------- planos ---------- */
  var CHAVES = ['max_usuarios', 'max_advogados', 'max_processos', 'max_numeros_whatsapp', 'max_armazenamento_mb', 'modulo_financeiro', 'modulo_indicadores', 'modulo_captacao', 'modulo_atendimento'];
  var ROTULOS = {
    max_usuarios: ['usuário', 'usuários'], max_advogados: ['advogado (OAB)', 'advogados (OABs)'], max_processos: ['processo', 'processos'],
    max_numeros_whatsapp: ['número de WhatsApp', 'números de WhatsApp'], max_armazenamento_mb: ['de armazenamento', 'de armazenamento']
  };
  function textoDoLimite(k, it) {
    var par = ROTULOS[k];
    if (it.texto === 'Ilimitado') return (k === 'max_armazenamento_mb' ? 'Armazenamento' : par[1].charAt(0).toUpperCase() + par[1].slice(1)) + ' ilimitado' + (k === 'max_armazenamento_mb' ? '' : 's');
    return it.texto + ' ' + (it.texto === '1' ? par[0] : par[1]);
  }

  function pintarPlanos(dados) {
    $$('.dias-teste').forEach(function (n) { n.textContent = dados.teste_dias + ' dias'; });
    $('#dominio').textContent = '.' + dados.dominio;
    var grade = $('#planos-grade');
    grade.textContent = '';
    var select = $('select[name=plano_id]');
    select.textContent = '';
    dados.planos.forEach(function (p) {
      var itens = [];
      p.grupos.forEach(function (g) { g.itens.forEach(function (it) { itens.push(it); }); });
      var lis = CHAVES.map(function (k) {
        var it = itens.filter(function (x) { return x.chave === k; })[0];
        if (!it) return null;
        if (it.tipo === 'recurso') return el('li', { class: it.incluido ? '' : 'nao', text: it.rotulo.replace(/ \(.*\)$/, '') });
        return el('li', { text: textoDoLimite(k, it) });
      }).filter(Boolean);
      var card = el('article', { class: 'plano revela' + (p.destaque ? ' destaque-plano' : '') }, [
        p.destaque ? el('span', { class: 'faixa', text: 'Mais escolhido' }) : null,
        el('h3', { text: p.nome }),
        el('p', { class: 'resumo', text: p.resumo }),
        el('div', { class: 'preco' }, [document.createTextNode(reais(p.preco_centavos)), el('small', { text: ' /mês' })]),
        el('ul', {}, lis),
        el('a', { class: 'botao' + (p.destaque ? '' : ' claro'), href: '#contratar', 'data-plano': p.id, text: 'Testar ' + dados.teste_dias + ' dias grátis' })
      ]);
      grade.append(card);
      select.append(el('option', { value: p.id, text: p.nome + ' — ' + reais(p.preco_centavos) + '/mês' }));
    });
    observar($$('.plano.revela'));
    $$('[data-plano]').forEach(function (a) {
      a.addEventListener('click', function () { select.value = a.getAttribute('data-plano'); });
    });
    var pre = (location.hash.match(/plano=([a-z0-9-]+)/) || [])[1];
    if (pre && dados.planos.some(function (p) { return p.id === pre; })) select.value = pre;

    var tb = $('#tabela-comparar');
    tb.textContent = '';
    tb.append(el('thead', {}, [el('tr', {}, [el('th', { text: 'Recurso' })].concat(dados.planos.map(function (p) { return el('th', { text: p.nome }); })))]));
    var corpo = el('tbody');
    dados.planos[0].grupos.forEach(function (g, gi) {
      corpo.append(el('tr', { class: 'grupo' }, [el('td', { colspan: String(dados.planos.length + 1), text: g.titulo })]));
      g.itens.forEach(function (it, ii) {
        corpo.append(el('tr', {}, [el('td', { text: it.rotulo })].concat(dados.planos.map(function (p) {
          var v = p.grupos[gi].itens[ii];
          return el('td', { class: v.tipo === 'recurso' ? (v.incluido ? 'sim' : 'nao') : '', text: v.tipo === 'recurso' ? (v.incluido ? '✓' : '—') : v.texto });
        }))));
      });
    });
    tb.append(corpo);
  }

  /* ---------- formulário ---------- */
  var form = $('#form-contratar'), aviso = $('#aviso-form');
  function erro(t) { aviso.textContent = t; aviso.hidden = false; aviso.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  var slugEl = form.elements.slug, nomeEl = form.elements.nome, slugTocado = false;
  slugEl.addEventListener('input', function () {
    slugTocado = true;
    slugEl.value = slugEl.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
  });
  nomeEl.addEventListener('input', function () {
    if (slugTocado) return;
    slugEl.value = nomeEl.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    aviso.hidden = true;
    if (!form.checkValidity()) { form.reportValidity(); return; }
    var corpo = {};
    Array.prototype.forEach.call(form.elements, function (c) {
      if (!c.name) return;
      corpo[c.name] = c.type === 'checkbox' ? c.checked : c.value;
    });
    var botao = form.querySelector('button[type=submit]');
    botao.disabled = true;
    botao.textContent = 'Criando seu escritório…';
    fetch('/api/publico/contratar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (r) {
        if (!r.ok) throw new Error(r.j.error || 'Não foi possível concluir agora.');
        form.hidden = true;
        $('.contratar-texto').hidden = true;
        var s = $('#sucesso');
        s.hidden = false;
        $('#sucesso-msg').textContent = r.j.mensagem;
        var a = $('#sucesso-link');
        a.textContent = r.j.endereco.replace('https://', '');
        a.href = r.j.endereco;
        $('#sucesso-nota').textContent = 'Usuário: ' + r.j.usuario + (r.j.teste_ate ? ' · teste grátis até ' + r.j.teste_ate.split('-').reverse().join('/') : '');
        s.scrollIntoView({ block: 'center', behavior: 'smooth' });
      })
      .catch(function (x) {
        erro(x.message);
        botao.disabled = false;
        botao.textContent = 'Criar meu escritório e testar ' + (window.__teste || 7) + ' dias';
      });
  });

  fetch('/api/publico/planos').then(function (r) { return r.json(); }).then(function (d) {
    window.__teste = d.teste_dias;
    if (!d.planos.length) $('#planos-grade').textContent = 'Planos em breve.';
    else pintarPlanos(d);
    if (!d.contratacao_aberta) {
      form.hidden = true;
      $('.contratar-texto').hidden = true;
      $('#fechado').hidden = false;
      $$('[data-plano]').forEach(function (a) { a.textContent = 'Quero testar'; });
    }
    var h = $('.contratar-texto h2');
    if (h) h.textContent = d.teste_dias + ' dias grátis, sem cartão';
    $$('.botao.grande').forEach(function (b) { if (/Começar/.test(b.textContent)) b.textContent = 'Começar ' + d.teste_dias + ' dias grátis'; });
    document.title = 'DisparaZap · Teste grátis por ' + d.teste_dias + ' dias';
  }).catch(function () { $('#planos-grade').textContent = 'Não foi possível carregar os planos agora. Atualize a página.'; });
})();
