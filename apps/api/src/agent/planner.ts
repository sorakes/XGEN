import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ask, extractJsonObject } from './llm';
import { renderImageCatalog } from './vision';
import { DESIGN_PRINCIPLES, pickStyleDirections } from './styles';
import { SHEETS, fitsSheet } from './format';
import type { DetailLevel, ImageInsight, ImageRole, PageFormat } from '../types';

export interface PageImage {
  id: string;      // 'img-1'...
  role: ImageRole; // background cobre a folha inteira; os outros ficam dentro do conteúdo
  note: string;    // o que a imagem ilustra nesta página
}

export interface PagePlan {
  n: number;
  role: string;   // 'capa' | 'sumario' | 'capitulo' | 'dados' | 'encerramento' | ...
  title: string;
  brief: string;  // o que EXATAMENTE vai nesta página
  chart?: string; // descrição do gráfico, se esta página tiver um
  images?: PageImage[];
}

export interface DocumentPlan {
  format: PageFormat;
  language: string;     // idioma do pedido — o documento inteiro sai nele
  theme: string;
  designSystem: string; // paleta, fontes e regras visuais compartilhadas por TODAS as páginas
  docRef: string;       // código/identificação do documento, IDÊNTICO em todas as páginas
  footer: string;       // formato do rodapé, reproduzido igual em todas as páginas
  pages: PagePlan[];
}

const PLANNER_SYSTEM =
  "Você é um Diretor de Arte editorial. Responde SOMENTE com JSON válido, sem comentários, sem markdown, sem explicações.";

const IMAGE_ROLES: ImageRole[] = ['background', 'hero', 'inline', 'logo'];

/**
 * Capas e páginas divisórias têm layout deliberadamente livre: não levam
 * rodapé numerado e podem ter muito espaço vazio por decisão de design.
 * Aplicar as regras de rodapé e de ocupação nelas seria errado.
 */
export function isFreeformPage(page: PagePlan): boolean {
  const role = `${page.role} ${page.title}`.toLowerCase();
  return /capa|cover|abertura|divisor|separador|contracapa|folha de rosto|obrigado/.test(role);
}

export async function planDocument(
  model: BaseChatModel,
  instructions: string,
  format: PageFormat = 'A4',
  images: ImageInsight[] = [],
  detailLevel: DetailLevel | null = null
): Promise<DocumentPlan> {
  const sheet = SHEETS[format];
  const isSlide = format === 'SLIDE';

  const kind = isSlide
    ? `uma APRESENTAÇÃO DE SLIDES 16:9, SLIDE POR SLIDE`
    : `um documento A4 PÁGINA POR PÁGINA`;

  const sizing = isSlide
    ? `CADA SLIDE É UMA TELA 16:9 FECHADA (1920px x 1080px). Slide não é página de relatório: UMA ideia por slide,
título forte e curto, no máximo ~60 palavras de texto corrido por slide (dados, números grandes, gráficos
e imagens comunicam melhor que parágrafos). Se o usuário NÃO disse quantos slides, ${
      detailLevel === 'simples' ? 'use de 4 a 5 (nível SIMPLES: direto ao ponto, só o essencial)'
      : detailLevel === 'avancado' ? 'use de 8 a 12 (nível AVANÇADO: completo, com dados, gráficos e mais profundidade)'
      : 'escolha entre 6 e 12'}.`
    : `CADA PÁGINA É UMA FOLHA A4 FECHADA (210mm x 297mm). O conteúdo do brief precisa CABER confortavelmente
nessa folha — seja realista: uma folha comporta aproximadamente 400 a 600 palavras SE não houver gráficos,
cards ou imagens. Com um gráfico ou imagem grande, comporta bem menos. NÃO empilhe conteúdo demais numa página só.
Se o usuário NÃO disse quantas páginas, ${
      detailLevel === 'simples' ? 'use de 2 a 4 (nível SIMPLES: direto ao ponto, só o essencial)'
      : detailLevel === 'avancado' ? 'use de 7 a 12 (nível AVANÇADO: completo, com dados, gráficos e mais profundidade)'
      : 'escolha entre 4 e 8 conforme o volume de conteúdo'}.`;

  const imageSection = images.length
    ? `
IMAGENS ENVIADAS PELO USUÁRIO (${images.length}) — já analisadas:
${renderImageCatalog(images, format)}

REGRAS DAS IMAGENS:
- TODA imagem da lista precisa aparecer em pelo menos uma página (campo "images" da página).
- Se o pedido diz onde/como usar uma imagem ("foto de fundo na capa", "logo no topo"), OBEDEÇA exatamente.
- Se o pedido não diz, use o "uso sugerido" e o conteúdo da imagem para escolher a página onde ela faz sentido.
- role "background": a imagem cobre a ${isSlide ? 'tela' : 'folha'} INTEIRA com o texto por cima. Só uma por página.
  Use para fotos/texturas e para as marcadas como FUNDO PRONTO (nunca para prints ou logos soltos).
- Imagens FUNDO PRONTO são a base visual do documento (ex: fundos de slide de uma identidade visual):
  use-as como "background" e REPITA-AS ao longo das páginas — alterne entre elas conforme o papel da página
  (ex: uma para capa/divisórias, outras para as páginas de conteúdo). Uma mesma imagem pode estar em várias páginas.
- role "hero": destaque grande dentro do conteúdo. role "inline": ilustra um trecho, tamanho médio.
  role "logo": marca pequena, nunca cortada.
- Imagem com texto importante (prints, gráficos, cartazes) precisa ficar grande o bastante para ser lida.
- Planeje o texto da página contando com o espaço que a imagem ocupa.
- A paleta do design system deve CONVERSAR com as cores das imagens.`
    : '';

  const prompt = `Você é o Diretor de Arte de uma revista de luxo. Vai planejar ${kind}.

PEDIDO DO USUÁRIO:
"""
${instructions}
"""
${imageSection}

TAREFA:
1. Leia o pedido e RESPEITE RIGOROSAMENTE toda exigência explícita do usuário:
   - Se ele pediu um número de ${isSlide ? 'slides' : 'páginas'}, o array "pages" DEVE ter EXATAMENTE esse número.
   - Se ele pediu algo numa ${isSlide ? 'slide' : 'página'} específica (ex: "gráfico na 3", "conclusão na última"),
     essa exigência DEVE aparecer no brief daquela ${isSlide ? 'slide' : 'página'} exata.
   - Se ele pediu capítulos nomeados, distribua-os na ordem pedida.
   - Se ele pediu um estilo, cores ou fontes, o design system segue o pedido.
2. Defina um DESIGN SYSTEM único que todas as ${isSlide ? 'telas' : 'páginas'} vão seguir (é o que dá coesão visual).
3. IDIOMA: escreva TUDO (títulos, textos, rodapé) no MESMO idioma do pedido do usuário, a não ser que ele peça outro.
4. AMBIÇÃO PROPORCIONAL: o tamanho e a elaboração do documento seguem o pedido. Pedido curto e simples → documento enxuto.
5. NADA DE DADOS INVENTADOS: use conhecimento geral verdadeiro, mas NUNCA invente dados específicos que você não tem
   (métricas, resultados, clientes, preços, nomes de pessoas, e-mails, telefones, endereços). Onde eles fariam falta,
   use marcadores claros entre colchetes, ex: [Nome do cliente], [00%], [contato@empresa.com].
   Se o pedido é um TEMPLATE, o conteúdo é ilustrativo: títulos e textos de exemplo que mostram como usar cada página.

${sizing}

${DESIGN_PRINCIPLES}

Se o pedido NÃO define a estética, estas direções podem servir de inspiração (escolha, misture ou crie outra
que combine melhor com o tema):
${pickStyleDirections(3).map(s => `- ${s}`).join('\n')}

Responda SOMENTE com este objeto JSON:
{
  "language": "idioma do documento, ex: 'português do Brasil'",
  "theme": "resumo do tema em uma linha",
  "designSystem": "Descrição precisa e AUTOSSUFICIENTE do sistema visual, que outro designer vai seguir sem ver as outras páginas. Inclua: paleta com códigos hex exatos (fundo, texto, destaque, acento), famílias tipográficas (Google Fonts), tratamento de títulos, estilo de cabeçalho e rodapé, e o estilo dos cards/blocos. Seja específico com valores.",
  "docRef": "código curto e fixo de identificação do documento, ex: 'REL-2025-001'. Será repetido IDÊNTICO em todas as páginas.",
  "footer": "o texto EXATO do rodapé que TODAS as páginas de conteúdo vão reproduzir, usando {n} para o número e {total} para o total. MÁXIMO DE 60 CARACTERES. Ex: 'REL-2025-001 · {n}/{total}'",
  "pages": [
    {
      "n": 1,
      "role": "capa",
      "title": "título curto",
      "brief": "descrição DETALHADA do que vai aqui: textos, números, seções, blocos. Escreva o conteúdo real, não instruções vagas.",
      "chart": "opcional — tipo, rótulos e valores reais do gráfico. Omita se não houver gráfico.",
      "images": [{"id": "img-1", "role": "background", "note": "o que a imagem representa aqui"}]
    }
  ]
}
O campo "images" de cada página é opcional — omita nas páginas sem imagem.`;

  // O plano é o alicerce do documento: se ele falhar, nada é gerado. Vale uma
  // segunda tentativa reforçando o formato antes de desistir do job inteiro.
  let plan: DocumentPlan;
  try {
    plan = extractJsonObject<DocumentPlan>(await ask(model, PLANNER_SYSTEM, prompt));
  } catch (error: any) {
    console.warn(`[Planner] JSON inválido (${error.message}). Tentando novamente...`);
    const retryPrompt =
      `${prompt}\n\n⚠️ ATENÇÃO: a resposta anterior não era JSON válido. ` +
      `Responda com JSON ESTRITO: sem markdown, sem comentários e SEM QUEBRAS DE LINHA ` +
      `dentro dos valores de texto (escreva cada valor em uma única linha).`;
    plan = extractJsonObject<DocumentPlan>(await ask(model, PLANNER_SYSTEM, retryPrompt));
  }

  if (!plan.pages?.length) throw new Error("O planner não retornou nenhuma página.");

  plan.format = format;
  plan.language = String(plan.language || '').trim() || 'o mesmo idioma do pedido do usuário';

  // Rodapé e código do documento precisam existir mesmo se a LLM omitir —
  // é o que impede cada página de inventar a própria identificação.
  plan.docRef = (plan.docRef || 'DOC-XGEN-01').trim();
  plan.footer = (plan.footer || `${plan.docRef} · {n}/{total}`).trim();

  // Rodapé longo demais quebra em duas linhas e suja o pé da página.
  // Se a LLM ignorar o limite, cai para um formato curto garantido.
  if (plan.footer.replace(/\{n\}|\{total\}/g, '00').length > 70) {
    plan.footer = `${plan.docRef} · {n}/{total}`;
  }

  // Normaliza a numeração para bater com a ordem real do array.
  plan.pages = plan.pages.map((page, index) => ({ ...page, n: index + 1 }));

  normalizePlanImages(plan, images, format);

  console.log(
    `[Planner] ${plan.pages.length} ${sheet.format === 'SLIDE' ? 'slides' : 'páginas'}` +
    (images.length
      ? ` | imagens: ${plan.pages
          .filter(p => p.images?.length)
          .map(p => `p${p.n}[${p.images!.map(i => `${i.id}:${i.role}`).join(',')}]`)
          .join(' ')}`
      : '')
  );

  return plan;
}

/**
 * Garante por código o que o prompt pediu: ids válidos, papéis válidos, no
 * máximo um fundo por página, fundo nunca em imagem com texto/logo, e TODA
 * imagem enviada usada ao menos uma vez.
 */
function normalizePlanImages(plan: DocumentPlan, images: ImageInsight[], format: PageFormat) {
  const byId = new Map(images.map(img => [img.id, img]));

  for (const page of plan.pages) {
    if (!Array.isArray(page.images) || images.length === 0) {
      delete page.images;
      continue;
    }
    let hasBackground = false;
    const seen = new Set<string>();
    page.images = page.images
      .filter(item => item && byId.has(String(item.id)) && !seen.has(String(item.id)))
      .map(item => {
        const id = String(item.id);
        seen.add(id);
        const info = byId.get(id)!;
        let role: ImageRole = IMAGE_ROLES.includes(item.role) ? item.role : info.suggestedRole;
        // Fundo pronto (mesma proporção da folha) cobre sem cortar: pode ter texto/logo.
        const unsuitableForCover = (info.hasText || info.kind === 'logo') && !fitsSheet(info, format);
        if (role === 'background' && (hasBackground || unsuitableForCover)) role = unsuitableForCover && info.kind === 'logo' ? 'logo' : 'hero';
        if (role === 'background') hasBackground = true;
        return { id, role, note: String(item.note || info.description) };
      });
    if (page.images.length === 0) delete page.images;
  }

  // Imagem que a LLM esqueceu: entra na página que mais combina com o uso sugerido.
  const used = new Set(plan.pages.flatMap(p => (p.images || []).map(i => i.id)));
  for (const img of images) {
    if (used.has(img.id)) continue;
    const wantsCover = fitsSheet(img, format) ||
      (img.suggestedRole === 'background' && !img.hasText && img.kind !== 'logo');
    let target: PagePlan | undefined;
    if (wantsCover) {
      target = plan.pages.find(p => isFreeformPage(p) && !p.images?.some(i => i.role === 'background'))
        ?? plan.pages.find(p => !p.images?.some(i => i.role === 'background'));
    } else if (img.suggestedRole === 'logo' || img.kind === 'logo') {
      target = plan.pages[0];
    } else {
      target = plan.pages.find(p => !isFreeformPage(p) && !p.images?.length && !p.chart)
        ?? plan.pages.find(p => !isFreeformPage(p) && !p.images?.length)
        ?? plan.pages[plan.pages.length - 1];
    }
    if (!target) continue;
    const role: ImageRole = wantsCover && !target.images?.some(i => i.role === 'background')
      ? 'background'
      : img.suggestedRole === 'background' ? 'hero' : img.suggestedRole;
    target.images = [...(target.images || []), { id: img.id, role, note: img.description }];
    console.log(`[Planner] ${img.id} não tinha sido usada — adicionada à página ${target.n} como ${role}`);
  }
}
