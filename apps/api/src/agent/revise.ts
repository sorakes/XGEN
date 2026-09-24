import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import puppeteer from 'puppeteer';
import { ask, extractHtmlFragment, extractJsonObject, mapLimit } from './llm';
import { generatePage, renderImageRules } from './pages';
import { digestPage, type PageDigest } from './digest';
import { validateAndRepair } from './paginated';
import { knownImageInsight, renderImageCatalog } from './vision';
import { SHEETS } from './format';
import type { DocumentPlan, PageImage, PagePlan } from './planner';
import { RESTRICTED_LAUNCH_ARGS } from '../converters';
import { normalizeImage } from '../services/images.service';
import type { Deck } from '../services/decks.service';
import type { ImageInsight, ImageRole, PageFormat } from '../types';

/**
 * REVISÃO de um documento já gerado: em vez de refazer do zero (e perder
 * conteúdo, pesquisa e layout), carrega os slides salvos e aplica SÓ o que o
 * usuário pediu — "põe essas imagens de fundo em todos", "troca o slide 3",
 * "deixa mais curto". Slides não afetados saem idênticos.
 */

interface ParsedSlide {
  fragment: string;             // miolo do slide, com as imagens trocadas por marcadores
  background: string | null;    // chave da imagem de fundo (em `sources`)
  inline: string[];             // chaves das imagens de conteúdo, na ordem
}

/** Formato da folha, lido do CSS salvo junto com o deck. */
export function deckFormat(deck: Deck): PageFormat {
  const size = deck.before.match(/@page\s*\{\s*size:\s*([^;]+);/)?.[1] || '';
  if (/1920px/.test(size)) return 'SLIDE';
  if (/^297mm\s+210mm/.test(size.trim())) return 'A4L';
  return 'A4';
}

/**
 * Separa cada slide em miolo + imagens. As imagens (data URLs enormes) viram
 * marcadores <img data-xgen-img="k0">: a LLM revisa o HTML sem pagar
 * milhares de tokens de base64 e o sistema devolve as imagens no fim.
 * O parse roda num Chromium sem rede (o HTML pode ter sido editado no editor).
 */
async function parseDeck(deck: Deck): Promise<{ slides: ParsedSlide[]; sources: Record<string, string> }> {
  const browser = await puppeteer.launch({ headless: true, args: RESTRICTED_LAUNCH_ARGS });
  try {
    const page = await browser.newPage();
    return await page.evaluate((slidesHtml: string[]) => {
      const sources: Record<string, string> = {};
      const keyOf = new Map<string, string>();
      const keyFor = (src: string) => {
        if (!keyOf.has(src)) {
          const key = 'k' + keyOf.size;
          keyOf.set(src, key);
          sources[key] = src;
        }
        return keyOf.get(src)!;
      };
      const slides = slidesHtml.map(html => {
        const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
        const section = doc.querySelector('.xgen-page');
        if (!section) return { fragment: html, background: null, inline: [] as string[] };
        const bg = section.querySelector(':scope > img.xgen-bg') as HTMLImageElement | null;
        const background = bg && bg.getAttribute('src')?.startsWith('data:') ? keyFor(bg.getAttribute('src')!) : null;
        const root = (section.querySelector(':scope > .xgen-content') as HTMLElement | null) || (section as HTMLElement);
        if (bg && root === section) bg.remove();
        const inline: string[] = [];
        root.querySelectorAll('img').forEach(img => {
          const src = img.getAttribute('src') || '';
          if (!src.startsWith('data:')) return;
          const key = keyFor(src);
          inline.push(key);
          img.removeAttribute('src');
          img.removeAttribute('data-xgen-img');
          img.setAttribute('data-xgen-img', key);
        });
        return { fragment: root.innerHTML.trim(), background, inline };
      });
      return { slides, sources };
    }, deck.slides);
  } finally {
    await browser.close();
  }
}

interface RevisionPlanSlide {
  n: number;
  action: 'keep' | 'edit' | 'delete';
  change?: string;
  images?: { id: string; role: ImageRole }[];
}
interface RevisionPlan {
  slides: RevisionPlanSlide[];
  insert?: { after: number; title: string; brief: string; images?: { id: string; role: ImageRole }[] }[];
}

const REVISE_SYSTEM = "Você revisa documentos existentes com precisão cirúrgica. Responde SOMENTE com JSON válido.";
const PAGE_SYSTEM = "Você gera APENAS código HTML. Nunca explique, nunca comente, nunca converse. Saída pura.";
const ROLES: ImageRole[] = ['background', 'hero', 'inline', 'logo'];

export interface ReviseOptions {
  model: BaseChatModel;
  deck: Deck;
  instructions: string;
  newImages: ImageInsight[];   // imagens anexadas/geradas AGORA (img-1..img-N)
  maxRetries: number;
  onProgress?: (step: string) => Promise<void>;
}

export async function reviseDeck(options: ReviseOptions): Promise<{ html: string; format: PageFormat }> {
  const { model, deck, instructions, newImages, maxRetries, onProgress } = options;
  const report = async (step: string) => { console.log(`[Revise] ${step}`); if (onProgress) await onProgress(step); };
  const format = deckFormat(deck);
  const noun = format === 'SLIDE' ? 'slide' : 'página';

  await report('Lendo a versão anterior...');
  const parsed = await parseDeck(deck);

  // Imagens já existentes no documento viram assets como as novas (img-N+1...).
  const images: ImageInsight[] = [...newImages];
  const idOfKey = new Map<string, string>();
  const bgKeys = new Set(parsed.slides.map(s => s.background).filter(Boolean) as string[]);
  for (const [key, src] of Object.entries(parsed.sources)) {
    try {
      const asset = await normalizeImage(Buffer.from(src.slice(src.indexOf(',') + 1), 'base64'), images.length + 1);
      const id = `img-${images.length + 1}`;
      images.push(knownImageInsight({ ...asset, id }, bgKeys.has(key) ? 'imagem de fundo já usada no documento' : 'imagem já usada no documento', 'foto', bgKeys.has(key)));
      idOfKey.set(key, id);
    } catch { /* imagem ilegível: fica de fora */ }
  }
  const fragmentWithIds = (s: ParsedSlide) =>
    s.fragment.replace(/data-xgen-img="(k\d+)"/g, (_, key) => `data-xgen-img="${idOfKey.get(key) || key}"`);
  const currentImages = (s: ParsedSlide): PageImage[] => [
    ...(s.background && idOfKey.get(s.background) ? [{ id: idOfKey.get(s.background)!, role: 'background' as ImageRole, note: 'fundo atual' }] : []),
    ...s.inline.filter(k => idOfKey.get(k)).map(k => ({ id: idOfKey.get(k)!, role: 'inline' as ImageRole, note: 'imagem atual' })),
  ];

  const digests: PageDigest[] = parsed.slides.map((s, i) => digestPage(i + 1, `${noun} ${i + 1}`, s.fragment));

  // 1. Plano da revisão: o que muda em cada slide.
  await report('Planejando a alteração...');
  const overview = parsed.slides.map((s, i) => {
    const imgs = currentImages(s).map(p => `${p.id}(${p.role})`).join(', ') || 'nenhuma';
    return `--- ${noun.toUpperCase()} ${i + 1} --- imagens: ${imgs}\nTítulos: ${digests[i].headings.join(' | ') || '(sem títulos)'}\nTexto: ${digests[i].excerpt.slice(0, 280)}`;
  }).join('\n\n');
  const prompt = `Documento atual com ${parsed.slides.length} ${noun}s:

${overview}

PEDIDO DE ALTERAÇÃO DO USUÁRIO:
"""
${instructions}
"""
${newImages.length ? `\nIMAGENS NOVAS (enviadas agora):\n${renderImageCatalog(newImages, format)}\n` : ''}
Decida o que fazer em CADA ${noun}:
- "keep": não muda nada (use sempre que o pedido não afeta esse ${noun}).
- "edit": muda; em "change" descreva EXATAMENTE o que alterar neste ${noun} (específico e acionável).
- "delete": remover (só se o pedido mandar).
Se o pedido vale para todos (ex: "fundo em todas as páginas", "traduza tudo"), marque "edit" em todos.
"images": só quando as imagens do ${noun} mudam — liste TODAS as imagens que ele deve ter depois (as antigas que ficam e as novas),
com role "background" (cobre a folha inteira; no máximo uma), "hero", "inline" ou "logo". Omita se as imagens não mudam.
Para ACRESCENTAR ${noun}s novos, use "insert" (after = número do ${noun} anterior; brief = conteúdo real).

Responda SOMENTE com: {"slides":[{"n":1,"action":"keep"},{"n":2,"action":"edit","change":"...","images":[{"id":"img-1","role":"background"}]}],"insert":[]}`;

  let revision: RevisionPlan;
  try {
    revision = extractJsonObject<RevisionPlan>(await ask(model, REVISE_SYSTEM, prompt));
  } catch {
    // Sem plano: aplica o pedido a todos os slides (mais caro, mas nunca ignora o pedido).
    revision = { slides: parsed.slides.map((_, i) => ({ n: i + 1, action: 'edit', change: instructions })) };
  }
  const byN = new Map((revision.slides || []).map(s => [Number(s.n), s]));
  const validImages = (list?: { id: string; role: ImageRole }[]) => {
    if (!Array.isArray(list)) return undefined;
    let hasBg = false;
    return list
      .filter(i => i && images.some(img => img.id === i.id))
      .map(i => {
        let role: ImageRole = ROLES.includes(i.role) ? i.role : 'inline';
        if (role === 'background') { if (hasBg) role = 'hero'; hasBg = true; }
        return { id: i.id, role, note: '' };
      });
  };

  // 2. Monta a lista final de páginas (mantidas, editadas, novas).
  interface Entry { page: PagePlan; html: string; kind: 'keep' | 'edit' | 'new'; change: string }
  const entries: Entry[] = [];
  parsed.slides.forEach((s, i) => {
    const r = byN.get(i + 1);
    if (r?.action === 'delete') return;
    const imgs = (r?.action === 'edit' && validImages(r.images)) || currentImages(s);
    entries.push({
      page: { n: 0, role: i === 0 ? 'capa' : 'conteúdo', title: digests[i].headings[0] || `${noun} ${i + 1}`, brief: '', images: imgs },
      html: fragmentWithIds(s),
      kind: r?.action === 'edit' ? 'edit' : 'keep',
      change: r?.change || instructions,
    });
    for (const ins of (revision.insert || []).filter(x => Number(x.after) === i + 1)) {
      entries.push({
        page: { n: 0, role: 'conteúdo', title: String(ins.title || 'Novo'), brief: String(ins.brief || ''), images: validImages(ins.images) },
        html: '',
        kind: 'new',
        change: '',
      });
    }
  });
  if (!entries.length) throw new Error('A revisão removeria todas as páginas.');
  entries.forEach((e, i) => { e.page.n = i + 1; });

  const plan: DocumentPlan = {
    format,
    language: 'o mesmo idioma dos slides atuais',
    theme: deck.title,
    designSystem:
      `Siga EXATAMENTE o estilo visual dos ${noun}s existentes (cores, fontes, espaçamentos, cabeçalho e rodapé). ` +
      `Exemplo de ${noun} existente:\n${entries.find(e => e.kind !== 'new')?.html.slice(0, 3000) || ''}`,
    docRef: '',
    footer: '',
    pages: entries.map(e => e.page),
  };

  const revisePage = async (entry: Entry, repairNote?: string) => {
    const sheet = SHEETS[format];
    const p = `Você está REVISANDO ${format === 'SLIDE' ? 'um slide' : 'uma página'} existente de um documento.

HTML ATUAL DO MIOLO (imagens aparecem como <img data-xgen-img="...">, sem src — é assim mesmo):
${entry.html}

ALTERAÇÃO PEDIDA: ${entry.change}
${renderImageRules(entry.page, images, plan)}
REGRAS:
1. Mantenha TODO o conteúdo (textos, números, gráficos, estrutura) e o estilo, EXCETO o que a alteração pede.
2. ${sheet.label}: nada pode passar da área. Raiz \`w-full h-full\`, sem vw/vh, sem larguras fixas grandes.
3. Não escreva src nas imagens nem invente URLs. Não remova marcadores de imagem que continuam na lista acima.
4. Devolva SOMENTE o miolo HTML revisado (sem <html>, <head>, <body> ou <section class="xgen-page">).${repairNote ? `\n\n⚠️ CORREÇÃO OBRIGATÓRIA: ${repairNote}` : ''}`;
    return extractHtmlFragment(await ask(model, PAGE_SYSTEM, p));
  };

  const pageHtmls = entries.map(e => e.html);
  const toDo = entries.map((e, i) => ({ e, i })).filter(x => x.e.kind !== 'keep');
  await report(`Aplicando a alteração em ${toDo.length} ${noun}(s)...`);
  await mapLimit(toDo, 3, async ({ e, i }) => {
    pageHtmls[i] = e.kind === 'new'
      ? await generatePage(model, plan, e.page, digests.slice(0, i), undefined, images)
      : await revisePage(e);
  });

  // 3. Mesma conferência de layout da geração — só nas páginas alteradas.
  const html = await validateAndRepair({
    plan,
    pageHtmls,
    images,
    maxRetries,
    report,
    onlyPages: new Set(toDo.map(x => x.i + 1)),
    redraw: async (index, note) => {
      const e = entries[index - 1];
      pageHtmls[index - 1] = e.kind === 'new'
        ? await generatePage(model, plan, e.page, digests.slice(0, index - 1), note, images)
        : await revisePage({ ...e, html: pageHtmls[index - 1] }, note);
    },
  });
  return { html, format };
}

