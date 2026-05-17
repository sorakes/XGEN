# Change Set: Injeção de Tailwind e Paginação Nativa

## Arquivos Modificados
1. `apps/api/src/converters.ts`

## Descrição da Mudança
- **CSS Absoluto:** Substituímos a dependência do agente LLM lembrar de inserir o script do Tailwind por uma injeção dura via código usando `page.addScriptTag({ url: 'https://cdn.tailwindcss.com' })`. Agora é matematicamente impossível o PDF ser gerado sem o framework CSS (o que causava o design "xoxo").
- **Paginação e Margens:** Removemos as travas artificiais de viewport que estavam apertando o design e retornamos para a formatação nativa `format: 'A4'` com margens 0 nas laterais (para Full Bleed perfeito). Adicionamos `15mm` de margem inferior exclusivamente para comportar o `footerTemplate` nativo do Puppeteer, que agora imprime as variáveis `<span class="pageNumber"></span>` com uma cor de fundo escura (`#020617`) para se misturar perfeitamente com o layout Premium do documento.

## Impacto no Sistema
O sistema agora garante 100% que o visual da web (Tailwind) será renderizado fielmente nas impressões PDF, restaurando o estilo original incrível que o projeto possuía e incluindo a contagem de páginas no rodapé de forma invisível no limite da tela.
