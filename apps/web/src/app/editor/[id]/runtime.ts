/**
 * Script injetado DENTRO do iframe do slide (sandbox, origem isolada).
 * Faz a edição direta no DOM do slide — selecionar, arrastar, redimensionar,
 * editar texto — e conversa com a página do editor só por postMessage.
 *
 * Tudo que ele marca no DOM usa atributos data-xe-*, removidos ao serializar,
 * então o HTML salvo fica igual ao gerado, só com as alterações do usuário.
 */
export const EDITOR_RUNTIME = String.raw`
<script data-xe-runtime>
(() => {
  const page = document.querySelector('.xgen-page');
  if (!page) return;
  const post = (msg) => parent.postMessage(Object.assign({ source: 'xgen-editor' }, msg), '*');

  const css = document.createElement('style');
  css.setAttribute('data-xe-runtime', '');
  css.textContent = [
    'html,body{overflow:hidden;margin:0}',
    '[data-xe-hover]{outline:2px dashed rgba(99,102,241,.9)!important;outline-offset:2px}',
    '[data-xe-sel]{outline:3px solid #6366f1!important;outline-offset:2px}',
    '[contenteditable="true"]{outline:3px solid #22c55e!important;cursor:text!important}',
    '#xe-handle{position:fixed;width:22px;height:22px;background:#6366f1;border:3px solid #fff;border-radius:4px;',
    'cursor:nwse-resize;z-index:2147483647;display:none;box-shadow:0 2px 6px rgba(0,0,0,.4)}',
  ].join('');
  document.head.appendChild(css);
  const handle = document.createElement('div');
  handle.id = 'xe-handle';
  document.body.appendChild(handle);

  const PAGE_AREA = page.clientWidth * page.clientHeight;
  let sel = null, hover = null, editing = null, drag = null;
  const history = [];

  const snapshot = () => { history.push(page.innerHTML); if (history.length > 60) history.shift(); };
  const changed = () => { post({ type: 'change' }); scheduleLayers(); };

  // Blocos que cobrem quase a folha toda (raiz w-full h-full, .xgen-content)
  // não são selecionáveis: clicar no "vazio" não pode arrastar o slide inteiro.
  const isObject = (el) => {
    if (!el || el === page || !page.contains(el) || el.id === 'xe-handle') return false;
    if (el.classList.contains('xgen-content') || el.classList.contains('xgen-bg')) return false;
    const r = el.getBoundingClientRect();
    return r.width * r.height < PAGE_AREA * 0.85;
  };
  const isLocked = (el) => !!(el && el.closest && el.closest('[data-xgen-lock]'));
  // Travado (cadeado no painel de camadas) não é pego pelo clique: o clique
  // "atravessa" e seleciona o que estiver em volta/atrás.
  const isSelectable = (el) => isObject(el) && !isLocked(el);
  const pick = (target) => {
    let el = target;
    while (el && el !== page && !isSelectable(el)) el = el.parentElement;
    return isSelectable(el) ? el : null;
  };

  const toHex = (rgb) => {
    const m = String(rgb).match(/\d+(\.\d+)?/g);
    if (!m) return '#000000';
    return '#' + m.slice(0, 3).map(v => Math.round(Number(v)).toString(16).padStart(2, '0')).join('');
  };

  const describe = (el) => {
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName,
      isImage: el.tagName === 'IMG',
      hasText: el.tagName !== 'IMG' && !!el.textContent.trim(),
      fontSize: Math.round(parseFloat(cs.fontSize)),
      color: toHex(cs.color),
      bold: Number(cs.fontWeight) >= 600,
      italic: cs.fontStyle === 'italic',
      align: cs.textAlign,
      canParent: isSelectable(el.parentElement),
      opacity: Math.round(parseFloat(cs.opacity) * 100),
      locked: isLocked(el),
      hidden: cs.visibility === 'hidden',
      isBackground: el.classList.contains('xgen-bg'),
      isShape: el.hasAttribute('data-xgen-shape'),
      fill: /rgba\([^)]*,\s*0\)$|transparent/.test(cs.backgroundColor) ? '#ffffff' : toHex(cs.backgroundColor),
    };
  };

  const placeHandle = () => {
    if (!sel || editing || isLocked(sel) || sel.classList.contains('xgen-bg')) { handle.style.display = 'none'; return; }
    const r = sel.getBoundingClientRect();
    handle.style.display = 'block';
    handle.style.left = (r.right - 11) + 'px';
    handle.style.top = (r.bottom - 11) + 'px';
  };

  const select = (el) => {
    if (sel) sel.removeAttribute('data-xe-sel');
    sel = el;
    if (sel) sel.setAttribute('data-xe-sel', '');
    placeHandle();
    post({ type: 'select', info: sel ? describe(sel) : null });
    scheduleLayers();
  };

  const stopEditing = () => {
    if (!editing) return;
    editing.removeAttribute('contenteditable');
    editing = null;
    placeHandle();
    changed();
  };

  // Com um ponto (duplo clique), o cursor vai para onde o usuário clicou;
  // sem ponto (Enter/botão), vai para o fim do texto. Nunca seleciona tudo:
  // digitar por cima apagaria a formatação interna (cores, negrito por trecho).
  const startEditing = (el, point) => {
    if (!el || el.tagName === 'IMG' || !el.textContent.trim()) return;
    snapshot();
    editing = el;
    el.setAttribute('contenteditable', 'true');
    el.focus();
    let range = point && document.caretRangeFromPoint ? document.caretRangeFromPoint(point.x, point.y) : null;
    if (!range || !el.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(range);
    placeHandle();
  };

  const translateOf = (el) => {
    const parts = (el.style.translate || '0px 0px').split(' ').map(parseFloat);
    return { x: parts[0] || 0, y: parts[1] || 0 };
  };

  // ---- mouse ----
  document.addEventListener('mousemove', (e) => {
    if (drag) {
      const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!drag.moved) { snapshot(); drag.moved = true; }
      if (drag.mode === 'move') {
        drag.el.style.translate = (drag.orig.x + dx) + 'px ' + (drag.orig.y + dy) + 'px';
      } else {
        const w = Math.max(20, drag.w + dx);
        drag.el.style.flex = 'none';
        drag.el.style.maxWidth = 'none';
        drag.el.style.width = w + 'px';
        if (drag.el.tagName === 'IMG' || !drag.el.textContent.trim()) {
          const h = drag.keepRatio ? w * drag.ratio : Math.max(20, drag.h + dy);
          drag.el.style.height = h + 'px';
          drag.el.style.maxHeight = 'none';
        }
      }
      placeHandle();
      return;
    }
    if (editing) return;
    const el = pick(e.target);
    if (el !== hover) {
      if (hover) hover.removeAttribute('data-xe-hover');
      hover = el && el !== sel ? el : null;
      if (hover) hover.setAttribute('data-xe-hover', '');
    }
  });

  handle.addEventListener('mousedown', (e) => {
    if (!sel) return;
    e.preventDefault(); e.stopPropagation();
    const r = sel.getBoundingClientRect();
    drag = { mode: 'resize', el: sel, startX: e.clientX, startY: e.clientY, w: r.width, h: r.height,
             ratio: r.height / Math.max(1, r.width), keepRatio: sel.tagName === 'IMG' && !e.shiftKey, moved: false };
  });

  document.addEventListener('mousedown', (e) => {
    if (e.target === handle) return;
    if (editing && editing.contains(e.target)) return;
    if (editing) stopEditing();
    const el = pick(e.target);
    select(el);
    if (el) {
      e.preventDefault();
      drag = { mode: 'move', el, startX: e.clientX, startY: e.clientY, orig: translateOf(el), moved: false };
    }
  });

  document.addEventListener('mouseup', () => {
    if (drag && drag.moved) changed();
    drag = null;
    if (sel) post({ type: 'select', info: describe(sel) });
  });

  document.addEventListener('dblclick', (e) => {
    const el = pick(e.target);
    if (!el) return;
    // Duplo clique no texto: edita o bloco inteiro (parágrafo/título), não só
    // o trecho <span> colorido em que o clique caiu.
    let target = e.target;
    while (target && target !== page && getComputedStyle(target).display.startsWith('inline')) target = target.parentElement;
    if (!target || target === page || !isSelectable(target) || !target.textContent.trim()) target = el;
    select(target);
    startEditing(target, { x: e.clientX, y: e.clientY });
  });

  document.addEventListener('keydown', (e) => {
    if (editing) {
      if (e.key === 'Escape') { e.preventDefault(); stopEditing(); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    // Colar funciona mesmo sem seleção; a área de transferência fica na página
    // do editor (vale entre slides).
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); post({ type: 'pasteRequest' }); return; }
    if (sel && !sel.classList.contains('xgen-bg') && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      e.preventDefault(); post({ type: 'clipboard', html: floatingClone(sel).outerHTML }); return;
    }
    if (sel && !sel.classList.contains('xgen-bg') && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault(); runCommand({ cmd: 'duplicate' }); return;
    }
    if (!sel || isLocked(sel)) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); return; }
    if (sel.classList.contains('xgen-bg')) return;
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      snapshot();
      const t = translateOf(sel);
      sel.style.translate = (t.x + moves[e.key][0]) + 'px ' + (t.y + moves[e.key][1]) + 'px';
      placeHandle();
      changed();
    }
    if (e.key === 'Enter') { e.preventDefault(); startEditing(sel); }
  });

  // ---- comandos ----
  const scope = () => sel ? [sel].concat(Array.from(sel.querySelectorAll('*'))) : [];
  const remove = () => { if (!sel) return; snapshot(); const el = sel; select(null); el.remove(); changed(); };
  const undo = () => {
    const prev = history.pop();
    if (prev === undefined) return;
    page.innerHTML = prev;
    page.querySelectorAll('[data-xe-sel],[data-xe-hover],[contenteditable]').forEach(n => {
      n.removeAttribute('data-xe-sel'); n.removeAttribute('data-xe-hover'); n.removeAttribute('contenteditable');
    });
    // innerHTML não executa scripts: recria-os para os gráficos (Chart.js) voltarem.
    page.querySelectorAll('script').forEach(old => {
      const fresh = document.createElement('script');
      fresh.textContent = old.textContent;
      old.replaceWith(fresh);
    });
    sel = null; hover = null; editing = null;
    placeHandle();
    post({ type: 'select', info: null });
    changed();
  };

  // ---- camadas ----
  // Lista os "objetos" do slide (como no painel de camadas de um editor
  // gráfico): fundo, textos, imagens, gráficos, ícones e blocos com fundo/borda.
  // Os wrappers de layout sem nada visual não aparecem — seus filhos sobem de nível.
  let layerSeq = 0;
  const transparent = (c) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
  const layerType = (el) => {
    if (el.classList.contains('xgen-bg')) return 'background';
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') return 'image';
    if (tag === 'canvas') return 'chart';
    if (tag === 'svg') return 'icon';
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return null;
    const inline = cs.display === 'inline' || cs.display === 'contents';
    const ownText = Array.from(el.childNodes).some(n =>
      (n.nodeType === 3 && n.textContent.trim()) ||
      (n.nodeType === 1 && getComputedStyle(n).display === 'inline' && n.textContent.trim()));
    if (ownText && !inline) return 'text';
    if (inline) return null;
    const border = (parseFloat(cs.borderTopWidth) + parseFloat(cs.borderLeftWidth)) > 0 && !transparent(cs.borderTopColor);
    if (!transparent(cs.backgroundColor) || cs.backgroundImage !== 'none' || border) return 'shape';
    return null;
  };
  const LABELS = { background: 'Fundo do slide', image: 'Imagem', chart: 'Gráfico', icon: 'Ícone', shape: 'Bloco' };
  const layerLabel = (el, type) => {
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (type === 'text') return text.slice(0, 48) || 'Texto';
    if (type === 'image') return el.alt ? 'Imagem · ' + el.alt.slice(0, 30) : 'Imagem';
    if (type === 'shape' && text) return 'Bloco · ' + text.slice(0, 30);
    return LABELS[type];
  };
  const buildLayers = () => {
    const items = [];
    const walk = (node, depth) => {
      Array.from(node.children).forEach(child => {
        if (items.length >= 300) return;
        const tag = child.tagName.toLowerCase();
        if (tag === 'script' || tag === 'style' || tag === 'link' || child.id === 'xe-handle') return;
        const type = layerType(child);
        const listed = type && (type === 'background' || isObject(child));
        if (listed) {
          if (!child.hasAttribute('data-xe-id')) child.setAttribute('data-xe-id', 'l' + (++layerSeq));
          items.push({
            id: child.getAttribute('data-xe-id'),
            type,
            label: layerLabel(child, type),
            depth,
            hidden: getComputedStyle(child).visibility === 'hidden',
            locked: child.hasAttribute('data-xgen-lock'),
            selected: child === sel,
          });
        }
        if (type !== 'icon' && type !== 'image' && type !== 'chart') walk(child, listed ? depth + 1 : depth);
      });
    };
    walk(page, 0);
    post({ type: 'layers', items });
  };
  let layersTimer = null;
  function scheduleLayers() {
    clearTimeout(layersTimer);
    layersTimer = setTimeout(buildLayers, 120);
  }
  const byLayerId = (id) => page.querySelector('[data-xe-id="' + String(id).replace(/"/g, '') + '"]');
  const contentRoot = () => page.querySelector(':scope > .xgen-content') || page;

  // ---- objetos soltos (ordem de camadas) ----
  // O slide gerado é um layout em fluxo (flex/grid): z-index quase não tem
  // efeito entre elementos de blocos diferentes. Para ordenar camadas como num
  // editor gráfico, o elemento vira um OBJETO SOLTO: posição absoluta no mesmo
  // lugar, estilos herdados congelados nele e um espaço invisível no lugar
  // antigo (os vizinhos não pulam). Entre objetos soltos, a ordem é a ordem no
  // DOM: o último desenhado fica na frente.
  const FREEZE = ['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
    'text-align', 'text-transform', 'white-space', 'word-spacing'];
  const isFloat = (el) => !!el && el.hasAttribute && el.hasAttribute('data-xgen-float');
  const floats = () => Array.from(contentRoot().children).filter(isFloat);
  const freeze = (target, source) => {
    const cs = getComputedStyle(source);
    FREEZE.forEach(p => { if (!target.style.getPropertyValue(p)) target.style.setProperty(p, cs.getPropertyValue(p)); });
  };
  const placeFloat = (el, r) => {
    const base = contentRoot().getBoundingClientRect();
    el.style.position = 'absolute';
    el.style.left = (r.left - base.left) + 'px';
    el.style.top = (r.top - base.top) + 'px';
    el.style.width = r.width + 'px';
    if (el.tagName === 'IMG' || el.tagName === 'CANVAS' || !el.textContent.trim()) el.style.height = r.height + 'px';
    el.style.margin = '0';
    el.style.translate = '';
    el.style.boxSizing = 'border-box';
    el.style.flex = 'none';
    el.style.maxWidth = 'none';
    el.style.zIndex = '20';
    el.setAttribute('data-xgen-float', '');
  };
  const promote = (el) => {
    if (!el || isFloat(el) || el.classList.contains('xgen-bg')) return el;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const slot = document.createElement('div');
    slot.setAttribute('data-xgen-slot', '');
    slot.style.cssText = 'width:' + r.width + 'px;height:' + r.height + 'px;flex:none;visibility:hidden;margin:' + cs.margin + ';' +
      (cs.display.startsWith('inline') ? 'display:inline-block;' : '');
    freeze(el, el);
    el.parentNode.insertBefore(slot, el);
    placeFloat(el, r);
    contentRoot().appendChild(el);
    return el;
  };
  const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
  // Objetos (camadas) que encostam no elemento — só os de nível mais alto.
  const overlapping = (el) => {
    const r = el.getBoundingClientRect();
    const hits = Array.from(page.querySelectorAll('*')).filter(n =>
      n !== el && !n.contains(el) && !el.contains(n) && !n.hasAttribute('data-xgen-slot') &&
      !n.classList.contains('xgen-bg') && isObject(n) && layerType(n) && intersects(r, n.getBoundingClientRect()));
    return hits.filter(n => !hits.some(o => o !== n && o.contains(n)));
  };
  const reorder = (mode) => {
    const el = promote(sel);
    // Quem se sobrepõe entra na mesma pilha, abaixo do elemento (em fluxo,
    // tudo era desenhado abaixo de um objeto solto), mantendo a ordem entre si.
    overlapping(el)
      .filter(n => !isFloat(n))
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      .forEach(n => { promote(n); contentRoot().insertBefore(n, el); });
    const stack = floats();
    const near = new Set(overlapping(el));
    const i = stack.indexOf(el);
    if (mode === 'top') contentRoot().appendChild(el);
    if (mode === 'bottom' && stack[0] !== el) contentRoot().insertBefore(el, stack[0]);
    if (mode === 'forward') {
      const next = stack.slice(i + 1).find(n => near.has(n));
      if (next) next.after(el);
    }
    if (mode === 'backward') {
      const prev = stack.slice(0, i).reverse().find(n => near.has(n));
      if (prev) prev.before(el);
    }
  };
  // Cópia já solta, na posição atual do original (serve para duplicar e para
  // colar em outro slide). Gráficos viram imagem: o canvas copiado nasce vazio.
  const floatingClone = (el) => {
    const r = el.getBoundingClientRect();
    const snap = (canvas) => {
      const img = document.createElement('img');
      try { img.src = canvas.toDataURL('image/png'); } catch (err) { /* canvas protegido */ }
      return img;
    };
    let node;
    if (el.tagName === 'CANVAS') {
      node = snap(el);
    } else {
      node = el.cloneNode(true);
      const copies = Array.from(node.querySelectorAll('canvas'));
      Array.from(el.querySelectorAll('canvas')).forEach((c, i) => {
        const img = snap(c);
        const cr = c.getBoundingClientRect();
        img.style.cssText = 'width:' + cr.width + 'px;height:' + cr.height + 'px;display:block';
        if (copies[i]) copies[i].replaceWith(img);
      });
    }
    [node].concat(Array.from(node.querySelectorAll('*'))).forEach(n => {
      ['data-xe-sel', 'data-xe-hover', 'data-xe-id', 'contenteditable', 'data-xgen-lock', 'id'].forEach(a => n.removeAttribute(a));
    });
    node.querySelectorAll('script').forEach(s => s.remove());
    freeze(node, el);
    placeFloat(node, r);
    return node;
  };
  const insertFloat = (node) => {
    // Não empilha a cópia exatamente em cima de um objeto (o original ou outra
    // cópia): desloca em diagonal até achar um lugar livre.
    const base = contentRoot().getBoundingClientRect();
    const objects = Array.from(page.querySelectorAll('*')).filter(n => isObject(n) && layerType(n)).map(n => n.getBoundingClientRect());
    const taken = (l, t) => objects.some(o =>
      Math.abs(o.left - (base.left + parseFloat(l))) < 3 && Math.abs(o.top - (base.top + parseFloat(t))) < 3);
    while (taken(node.style.left, node.style.top)) {
      node.style.left = (parseFloat(node.style.left) + 24) + 'px';
      node.style.top = (parseFloat(node.style.top) + 24) + 'px';
    }
    contentRoot().appendChild(node);
    select(node);
  };

  const commands = {
    fontScale: ({ factor }) => {
      const nodes = scope();
      const sizes = nodes.map(n => parseFloat(getComputedStyle(n).fontSize));
      nodes.forEach((n, i) => { n.style.fontSize = (sizes[i] * factor).toFixed(1) + 'px'; });
    },
    color: ({ value }) => scope().forEach(n => { n.style.color = value; }),
    bold: () => {
      const on = Number(getComputedStyle(sel).fontWeight) < 600;
      scope().forEach(n => { n.style.fontWeight = on ? '700' : '400'; });
    },
    italic: () => {
      const on = getComputedStyle(sel).fontStyle !== 'italic';
      scope().forEach(n => { n.style.fontStyle = on ? 'italic' : 'normal'; });
    },
    align: ({ value }) => { sel.style.textAlign = value; },
    replaceImage: ({ src }) => { if (sel && sel.tagName === 'IMG') { sel.removeAttribute('srcset'); sel.src = src; } },
    replaceBackground: ({ src }) => {
      let bg = page.querySelector(':scope > img.xgen-bg');
      if (!bg) {
        // Slide sem fundo: cria a camada de fundo e embrulha o conteúdo por cima dela.
        const wrap = document.createElement('div');
        wrap.className = 'xgen-content';
        while (page.firstChild) wrap.appendChild(page.firstChild);
        bg = document.createElement('img');
        bg.className = 'xgen-bg';
        bg.setAttribute('data-xgen-bg', 'custom');
        bg.alt = '';
        // Inline: slides do modo literal não têm o CSS de fundo no <head>.
        bg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;max-width:none;object-fit:cover;z-index:0';
        wrap.style.cssText = 'position:relative;z-index:1;width:100%;height:100%';
        page.appendChild(bg);
        page.appendChild(wrap);
      }
      bg.src = src;
    },
    addText: () => {
      const p = document.createElement('p');
      p.textContent = 'Novo texto';
      p.style.cssText = 'position:absolute;left:760px;top:500px;margin:0;font-size:56px;font-weight:600;color:#111111;z-index:10;white-space:pre-wrap';
      contentRoot().appendChild(p);
      select(p);
      startEditing(p);
    },
    addImage: ({ src }) => {
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      img.setAttribute('data-fit', 'contain');
      img.style.cssText = 'position:absolute;left:660px;top:290px;width:600px;height:500px;object-fit:contain;z-index:10';
      contentRoot().appendChild(img);
      select(img);
    },
    opacity: ({ value }) => { sel.style.opacity = String(Math.max(0, Math.min(100, Number(value))) / 100); },
    toggleHidden: ({ id }) => {
      const el = byLayerId(id);
      if (!el) return;
      const hidden = getComputedStyle(el).visibility === 'hidden';
      el.style.visibility = hidden ? 'visible' : 'hidden';
    },
    toggleLock: ({ id }) => {
      const el = byLayerId(id);
      if (!el) return;
      if (el.hasAttribute('data-xgen-lock')) el.removeAttribute('data-xgen-lock');
      else el.setAttribute('data-xgen-lock', '');
    },
    toTop: () => reorder('top'),
    forward: () => reorder('forward'),
    backward: () => reorder('backward'),
    toBottom: () => reorder('bottom'),
    duplicate: () => insertFloat(floatingClone(sel)),
    paste: ({ html }) => {
      const t = document.createElement('template');
      t.innerHTML = String(html || '');
      t.content.querySelectorAll('script').forEach(s => s.remove());
      const node = t.content.firstElementChild;
      if (node) insertFloat(node);
    },
    fill: ({ value }) => { sel.style.backgroundImage = 'none'; sel.style.backgroundColor = value; },
    addShape: ({ kind }) => {
      const sizes = { rect: [480, 280, '0'], rounded: [480, 280, '28px'], circle: [320, 320, '50%'], line: [640, 6, '3px'] };
      const [w, h, radius] = sizes[kind] || sizes.rect;
      const shape = document.createElement('div');
      shape.setAttribute('data-xgen-shape', kind in sizes ? kind : 'rect');
      shape.setAttribute('data-xgen-float', '');
      shape.style.cssText = 'position:absolute;box-sizing:border-box;z-index:20;margin:0;background-color:#C8553D;' +
        'left:' + (960 - w / 2) + 'px;top:' + (540 - h / 2) + 'px;width:' + w + 'px;height:' + h + 'px;border-radius:' + radius;
      contentRoot().appendChild(shape);
      select(shape);
    },
  };

  const serialize = () => {
    stopEditing();
    const clone = page.cloneNode(true);
    [clone].concat(Array.from(clone.querySelectorAll('*'))).forEach(n => {
      ['data-xe-sel', 'data-xe-hover', 'data-xe-id', 'contenteditable'].forEach(a => n.removeAttribute(a));
    });
    return clone.outerHTML;
  };

  let lastCmd = '', lastCmdAt = 0;
  window.addEventListener('message', (e) => {
    const msg = e.data || {};
    if (msg.target !== 'xgen-editor') return;
    runCommand(msg);
  });
  function runCommand(msg) {
    if (msg.cmd === 'serialize') { post({ type: 'html', html: serialize(), requestId: msg.requestId }); return; }
    if (msg.cmd === 'undo') { undo(); return; }
    if (msg.cmd === 'delete') { remove(); return; }
    if (msg.cmd === 'deselect') { stopEditing(); select(null); return; }
    if (msg.cmd === 'parent') { if (sel && isSelectable(sel.parentElement)) select(sel.parentElement); return; }
    if (msg.cmd === 'edit') { if (sel && !isLocked(sel)) startEditing(sel); return; }
    if (msg.cmd === 'copy') {
      if (sel && !sel.classList.contains('xgen-bg')) post({ type: 'clipboard', html: floatingClone(sel).outerHTML });
      return;
    }
    if (msg.cmd === 'selectLayer') { stopEditing(); select(byLayerId(msg.id)); return; }
    if (msg.cmd === 'hoverLayer') {
      if (hover) hover.removeAttribute('data-xe-hover');
      hover = msg.id ? byLayerId(msg.id) : null;
      if (hover && hover !== sel) hover.setAttribute('data-xe-hover', ''); else hover = null;
      return;
    }
    const fn = commands[msg.cmd];
    if (!fn) return;
    const needsSelection = !['replaceBackground', 'addText', 'addImage', 'toggleHidden', 'toggleLock', 'paste', 'addShape'].includes(msg.cmd);
    if (needsSelection && !sel) return;
    if (needsSelection && isLocked(sel) && msg.cmd !== 'opacity') return;
    // Arrastar o controle de opacidade manda dezenas de comandos: vira UM passo de desfazer.
    const now = Date.now();
    if (msg.cmd !== 'addText' && (msg.cmd !== lastCmd || now - lastCmdAt > 800)) snapshot();
    lastCmd = msg.cmd; lastCmdAt = now;
    fn(msg);
    placeHandle();
    if (sel) post({ type: 'select', info: describe(sel) });
    changed();
  }

  // Fontes usadas no slide: o editor lista para o usuário instalar
  // (quem abrir o PPTX sem a fonte vê uma fonte substituta).
  const fonts = new Set();
  page.querySelectorAll('*').forEach(n => {
    if (!n.childNodes.length || !n.textContent.trim()) return;
    const f = getComputedStyle(n).fontFamily.split(',')[0].replace(/["']/g, '').trim();
    const generic = /^(ui-|system-ui|-apple-system|sans-serif|serif|monospace|cursive|fantasy|arial|helvetica|times|courier|georgia|verdana|segoe ui)/i;
    if (f && !generic.test(f)) fonts.add(f);
  });
  const ready = () => {
    post({ type: 'ready', fonts: Array.from(fonts), hasBackground: !!page.querySelector(':scope > img.xgen-bg') });
    buildLayers();
  };
  if (document.readyState === 'complete') ready(); else window.addEventListener('load', ready);
})();
</script>`;
