# Pivot de Rota: Retorno ao Design do PDF

## Motivo do Pivot
O usuário optou por pausar a decisão sobre a persistência física do banco de dados (que estava aguardando resposta) para focar novamente na qualidade visual do PDF gerado. O feedback é que a versão atual está "limitada, xoxa, com bordas brancas" e perdeu a numeração de páginas que existia no início do projeto.

## Estado Atual
O Puppeteer está usando `setViewport` restrito e `preferCSSPageSize: true` com margens 0 via injeção CSS. No entanto, o Tailwind parece não estar escalando corretamente (gerando bordas) e a ausência de margens nativas no Puppeteer impede a renderização de cabeçalhos/rodapés nativos.

## Novo Objetivo
Restaurar o design premium "Full Bleed" (sem bordas brancas laterais e topo), reativar a numeração de páginas e garantir que o TailwindCSS seja carregado com sua força total pelo LLM.
