import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { createModel, extractPureHtml, extractPureJson } from './agent/llm';
import { runPaginatedPdfAgent } from './agent/paginated';

export type ProgressCallback = (step: string) => Promise<void>;

const StateAnnotation = Annotation.Root({
  instructions: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
  documentType: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
  htmlContent: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
  criticism: Annotation<string>({ reducer: (x, y) => y ?? x, default: () => "" }),
  attempts: Annotation<number>({ reducer: (x, y) => y ?? x, default: () => 0 }),
  maxRetries: Annotation<number>({ reducer: (x, y) => y ?? x, default: () => 3 }),
});

export async function runDocumentAgent(
  instructions: string,
  documentType: string,
  maxRetries: number,
  llmKey: string,
  modelName: string = "gpt-4o",
  provider: string = "openai",
  baseUrl?: string,
  onProgress?: ProgressCallback
) {
  const model = createModel({ llmKey, modelName, provider, baseUrl });

  // PDF usa a arquitetura paginada: cada folha A4 é desenhada como uma caixa
  // fechada e o transbordo é medido no browser. Ver agent/paginated.ts.
  if (documentType === 'PDF') {
    return runPaginatedPdfAgent(model, instructions, maxRetries, onProgress);
  }

  // DOCX e XLSX seguem no fluxo de documento único (não têm o problema de
  // quebra de página: o Word repagina sozinho e o Excel não tem páginas).
  const generateNode = async (state: typeof StateAnnotation.State) => {
    const stepLabel = `Gerando Design (${state.attempts + 1}/${state.maxRetries})`;
    console.log(`[Agent] ${stepLabel}...`);
    if (onProgress) await onProgress(stepLabel);

    let prompt = "";

    if (state.documentType === 'XLSX') {
      prompt = `Você é um Analista Financeiro e de Dados Sênior.
REGRA ABSOLUTA: Retorne SOMENTE o array JSON puro. NENHUM texto antes ou depois. NENHUMA explicação.
Crie uma estrutura JSON baseada nestas instruções: ${state.instructions}.
A saída DEVE ser APENAS um ARRAY JSON [ ... ] válido.`;

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
5. PROIBIDO IMAGENS DECORATIVAS: NUNCA insira fotos (Pexels, Unsplash, etc). Use APENAS gráficos de dados.
6. GRÁFICOS OBRIGATÓRIOS: Você DEVE gerar gráficos inserindo tags de imagem apontando para a API do QuickChart.
   REGRAS DO QUICKCHART PARA EVITAR ERROS DE SINTAXE (Invalid token):
   - A URL inteira deve estar em UMA ÚNICA LINHA (zero quebras de linha dentro do src="...").
   - Use APENAS aspas simples (') dentro do bloco do gráfico.
   - Exemplo: <img src="https://quickchart.io/chart?c={type:'bar',data:{labels:['Jan','Fev'],datasets:[{label:'Vendas',data:[10,20]}]}}" width="500" height="300" />
7. Retorne EXCLUSIVAMENTE código HTML puro entre <!DOCTYPE html> e </html>.

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
      prompt = `O texto abaixo é um array JSON válido? Se sim, responda SOMENTE: APROVADO
Se não, liste os erros. Dados:\n${state.htmlContent}`;
    } else {
      prompt = `Aja como um Diretor de Arte exigente. Avalie o design do HTML abaixo para um documento Word.
CRITÉRIOS DE REPROVAÇÃO IMEDIATA:
1. Elementos grudados no início ou final da página (falta de padding/margin de respiro).
2. Falta de "esquadro": desalinhamento entre blocos, falta de uma margem padrão consistente em todo o documento.
3. Texto encostando nas bordas laterais.
4. Gráficos ou tabelas que parecem "quebrados" ou mal formatados.

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
