import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { extractPureHtml, extractPureJson } from './agent/llm';
import { runPaginatedAgent } from './agent/paginated';
import { renderImageCatalog } from './agent/vision';
import type { DocumentType, ImageInsight } from './types';

export type ProgressCallback = (step: string) => Promise<void>;

const StateAnnotation = Annotation.Root({
  instructions: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
  documentType: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
  htmlContent: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
  criticism: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
  attempts: Annotation<number>({ reducer: (x, y) => y ?? x, default: () => 0 }),
  maxRetries: Annotation<number>({ reducer: (x, y) => y ?? x, default: () => 3 }),
});

export interface DocumentAgentOptions {
  model: BaseChatModel;
  instructions: string;
  documentType: DocumentType;
  maxRetries: number;
  images?: ImageInsight[];
  visualReview?: boolean;
  onProgress?: ProgressCallback;
}

export async function runDocumentAgent({
  model, instructions, documentType, maxRetries, images = [], visualReview = false, onProgress,
}: DocumentAgentOptions) {
  // PDF e PPTX usam a arquitetura paginada: cada folha A4 / slide 16:9 é
  // desenhado como uma caixa fechada e o transbordo é medido no browser.
  // Ver agent/paginated.ts.
  if (documentType === 'PDF' || documentType === 'PPTX') {
    return runPaginatedAgent(model, instructions, maxRetries, {
      format: documentType === 'PPTX' ? 'SLIDE' : 'A4',
      images,
      visualReview,
      onProgress,
    });
  }

  const imageCatalog = images.length ? renderImageCatalog(images) : '';

  // DOCX e XLSX seguem no fluxo de documento único (não têm o problema de
  // quebra de página: o Word repagina sozinho e o Excel não tem páginas).
  const generateNode = async (state: typeof StateAnnotation.State) => {
    const stepLabel = `Gerando Design (${state.attempts + 1}/${state.maxRetries})`;
    console.log(`[Agent] ${stepLabel}...`);
    if (onProgress) await onProgress(stepLabel);

    let prompt = "";

    if (state.documentType === 'XLSX') {
      prompt = `Você é um Analista Financeiro e de Dados Sênior.
REGRA ABSOLUTA: Retorne SOMENTE JSON puro. NENHUM texto antes ou depois. NENHUMA explicação.
Crie a planilha baseada nestas instruções: ${state.instructions}.
${imageCatalog ? `
O usuário enviou imagens (o sistema as anexa numa aba própria). Se forem prints de tabelas/dados,
TRANSCREVA os dados delas para as linhas da planilha:
${imageCatalog}
` : ''}
FORMATO DA SAÍDA (escolha um):
- Uma aba: um ARRAY de objetos [ {"Coluna": valor, ...}, ... ]
- Várias abas: {"sheets": [ {"name": "Nome da aba", "rows": [ {"Coluna": valor}, ... ]} ]}
Números devem ser números JSON (sem aspas, sem "R$" ou "%"). Todas as linhas de uma aba com as mesmas chaves.`;

      if (state.criticism) {
        prompt += `\nO revisor apontou: ${state.criticism}. Corrija e retorne SOMENTE o JSON.`;
      }
    } else { // DOCX
      prompt = `Você é um Designer especialista em documentos ACADÊMICOS MODERNOS para Microsoft Word (DOCX).
ATENÇÃO: O motor do Word É EXTREMAMENTE FRÁGIL a CSS moderno. NUNCA USE TAILWINDCSS, NUNCA importe CDNs, NUNCA use a tag <style>. USE APENAS CSS INLINE BÁSICO (style="...").

Crie um documento clean (fundo branco), extremamente organizado, mas com "firulas" executivas: use cores nos títulos (ex: azul escuro), tabelas bem formatadas e gráficos de dados.

REGRAS ABSOLUTAS E INVIOLÁVEIS PARA DOCX:
1. DESIGN ACADÊMICO PREMIUM: Fundo branco, fontes clássicas. Proibido TailwindCSS.
2. CSS INLINE: Formate tudo com atributos HTML (width, border) ou style="color: #...; font-size: ...;". NUNCA use classes do Tailwind. NUNCA coloque tags <style>.
3. NENHUM ATRIBUTO XML: Não invente atributos como xmlns:w ou @click. O HTML deve ser estupidamente básico e limpo.
4. ESTRUTURA ORGANIZADA: Use <table> com width="100%" e border="1" para criar seções. Pinte o fundo do cabeçalho da tabela (bgcolor="#f4f4f4").
5. PROIBIDO IMAGENS DA INTERNET: NUNCA insira fotos externas (Pexels, Unsplash, etc).${imageCatalog ? `
   IMAGENS DO USUÁRIO — use TODAS, cada uma no ponto do texto em que faz sentido (o pedido manda: se ele disse onde, obedeça):
${imageCatalog}
   Insira cada uma EXATAMENTE assim, SEM src e SEM width/height (o sistema calcula o tamanho pela proporção real):
   <p style="text-align:center"><img data-xgen-img="img-1" data-size="large" alt="descrição" /></p>
   data-size: "small" (logo/ícone), "medium" (ilustração) ou "large" (destaque, largura total).
   O Word não tem imagem de fundo: uma imagem pedida como fundo/capa entra como "large" no topo do documento.` : ''}
6. GRÁFICOS OBRIGATÓRIOS: Você DEVE gerar gráficos inserindo tags de imagem apontando para a API do QuickChart.
   REGRAS DO QUICKCHART PARA EVITAR ERROS DE SINTAXE (Invalid token):
   - A URL inteira deve estar em UMA ÚNICA LINHA (zero quebras de linha dentro do src="...").
   - Use APENAS aspas simples (') dentro do bloco do gráfico.
   - Exemplo: <img src="https://quickchart.io/chart?c={type:'bar',data:{labels:['Jan','Fev'],datasets:[{label:'Vendas',data:[10,20]}]}}" width="500" height="300" />
7. Retorne EXCLUSIVAMENTE código HTML puro entre <!DOCTYPE html> e </html>.

8. Escreva no MESMO idioma das instruções do usuário. NÃO invente dados específicos (métricas, clientes, preços,
   nomes, e-mails, telefones) que não foram fornecidos: use marcadores entre colchetes, ex: [00%].

Instruções do usuário: ${state.instructions}`;

      if (state.criticism) {
        prompt += `\n\nCríticas do QA na versão anterior: ${state.criticism}. Corrija o HTML. Mantenha fundo claro e gráficos visíveis.`;
      }
    }

    const response = await model.invoke([
      new SystemMessage("Você gera APENAS código. Nunca explique, nunca comente, nunca converse. Saída pura."),
      new HumanMessage(prompt)
    ]);

    let output = response.content as string;
    output = state.documentType === 'XLSX' ? extractPureJson(output) : extractPureHtml(output);

    return { htmlContent: output, attempts: state.attempts + 1 };
  };

  const reviewNode = async (state: typeof StateAnnotation.State) => {
    const stepLabel = `Revisão QA (${state.attempts}/${state.maxRetries})`;
    console.log(`[Agent] ${stepLabel}...`);
    if (onProgress) await onProgress(stepLabel);

    let prompt = "";

    if (state.documentType === 'XLSX') {
      prompt = `O texto abaixo é JSON válido (um array de objetos, ou um objeto {"sheets":[{"name","rows"}]})? Se sim, responda SOMENTE: APROVADO
Se não, liste os erros. Dados:\n${state.htmlContent}`;
    } else {
      prompt = `Aja como um Diretor de Arte exigente. Avalie o design do HTML abaixo para um documento Word.
CRITÉRIOS DE REPROVAÇÃO IMEDIATA:
1. Elementos grudados no início ou final da página (falta de padding/margin de respiro).
2. Falta de "esquadro": desalinhamento entre blocos, falta de uma margem padrão consistente em todo o documento.
3. Texto encostando nas bordas laterais.
4. Gráficos ou tabelas que parecem "quebrados" ou mal formatados.
(Tags <img data-xgen-img="..."> sem src são marcadores válidos: o sistema insere as imagens depois. NÃO as aponte como erro.)

Se estiver absolutamente perfeito e bem espaçado, responda SOMENTE a palavra: APROVADO.
Se houver falhas de alinhamento ou espaçamento, liste-as de forma concisa para que o designer corrija.
HTML:\n${state.htmlContent}`;
    }

    const response = await model.invoke([
      new SystemMessage("Você é um Diretor de Qualidade. Respostas curtas e diretas."),
      new HumanMessage(prompt)
    ]);

    return { criticism: response.content as string };
  };

  const shouldContinue = (state: typeof StateAnnotation.State) => {
    const isApproved = state.criticism.trim().toUpperCase().includes("APROVADO");
    if (isApproved) {
      console.log(`[Agent] ✅ Aprovado pelo QA!`);
      return END;
    }
    if (state.attempts >= state.maxRetries) {
      console.log(`[Agent] ⚠️ Limite de recursividade (${state.maxRetries}). Output final.`);
      return END;
    }
    console.log(`[Agent] ❌ Reprovou. Auto-correção...`);
    return "generateNode";
  };

  const workflow = new StateGraph(StateAnnotation)
    .addNode("generateNode", generateNode)
    .addNode("reviewNode", reviewNode)
    .addEdge(START, "generateNode")
    .addEdge("generateNode", "reviewNode")
    .addConditionalEdges("reviewNode", shouldContinue);

  const app = workflow.compile();

  const finalState = await app.invoke({
    instructions, documentType, htmlContent: "", criticism: "",
    attempts: 0, maxRetries
  });

  return finalState.htmlContent;
}
