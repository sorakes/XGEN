# Change Set: Libertação Criativa do Prompt (Sem Presets)

## Arquivos Modificados
1. `apps/api/src/agent.ts`

## Descrição da Mudança
- **Fim das Amarras CSS:** Foram deletados do prompt da IA todos os comandos rígidos que o usuário havia adicionado na tentativa anterior de arrumar o PDF (`body { width: 210mm }`, `bg-slate-900`, `min-h-[297mm]`). O fato de o HTML estar fixado numa largura X e o Puppeteer tentar imprimir num papel Y gerava conflitos de redimensionamento (criando o terrível "lixo" com as bordas brancas e componentes achatados).
- **Fim do Preset Visual:** Foram removidas instruções engessadas como "Use fundos escuros" e paletas de cores fixas. O Agente agora entende que cores, estética e paletas são 100% dependentes das diretrizes da instrução do usuário.
- **Foco Mecânico Reduzido:** Mantida apenas a instrução puramente mecânica de que ela DEVE injetar a tag `<script src="...tailwindcss...">` e o uso da classe `break-inside-avoid`.

## Impacto no Sistema
A LLM agora construirá as páginas como ela fazia no início do projeto: fluindo 100% o Tailwind sem definir dimensões rígidas, permitindo que a própria folha do Puppeteer molde o HTML com flexibilidade e elimine os espaços brancos, devolvendo designs assustadoramente bem feitos em vez de "templates pré-moldados".
