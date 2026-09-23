/**
 * Repertório de design inspirado no huashu-design (github.com/alchaincyf/huashu-design).
 *
 * É ORIENTAÇÃO para a LLM, não regra de reprovação: o designer continua livre
 * para compor o layout. As únicas regras duras do XGEN são as de dimensão
 * (a página não pode estourar e as imagens não podem distorcer/pixelar),
 * e essas são verificadas por medição no browser, não por texto de prompt.
 */

/** Vícios visuais típicos de "design feito por IA" que queremos evitar. */
export const DESIGN_PRINCIPLES = `PRINCÍPIOS DE DESIGN (evite a cara de "feito por IA"):
- Evite os clichês: gradiente roxo/azul genérico, emoji como ícone, card com borda colorida só na esquerda,
  todos os blocos com o mesmo canto arredondado e a mesma sombra, título em Inter/Arial genérico.
- Hierarquia tipográfica forte: um título que domina, contraste real de tamanho e peso entre níveis.
  Combine uma fonte de display com personalidade (serifada ou grotesca marcante) com uma de texto legível.
- Grid e alinhamento: poucas colunas, margens consistentes, alinhamentos que se repetem entre páginas.
- Cor com intenção: 1 cor de destaque usada com parcimônia sobre uma base neutra. Se o cliente mandou
  imagens, derive a paleta das cores delas para o documento parecer feito para aquelas imagens.
- Números e dados em destaque viram elementos visuais (números grandes, gráficos limpos), não parágrafos.
- Respiro é elemento de design: espaço vazio intencional > encher de caixinhas.`;

/**
 * Direções de estilo para quando o pedido não diz nada sobre a estética.
 * O planner recebe algumas como INSPIRAÇÃO e pode escolher, misturar ou ignorar.
 */
export const STYLE_DIRECTIONS: string[] = [
  'Editorial de revista: serifada grande nos títulos (Playfair Display / Fraunces), texto em grotesca, fotos sangradas, fios finos separando seções.',
  'Suíço/International: grid rígido, Helvetica-like (Inter Tight / Archivo), preto e branco com UMA cor forte, títulos alinhados à esquerda em tamanho enorme.',
  'Minimal escuro: fundo quase preto (#0f1115), texto off-white, destaque em uma cor neon discreta, muito respiro, números gigantes.',
  'Corporativo sóbrio: azul-marinho e cinza quente, tipografia IBM Plex Sans / Source Serif, tabelas limpas, hierarquia clara.',
  'Relatório financeiro premium: creme (#f6f1e7) com verde-escuro e dourado discreto, serifada clássica, gráficos finos.',
  'Tech/produto: fundo claro, cinzas frios, fonte Space Grotesk / JetBrains Mono para dados, blocos com bordas finas em vez de sombra.',
  'Bold/cartaz: cores chapadas de alto contraste, títulos em caixa alta muito grandes (Anton / Bebas Neue), composição assimétrica.',
  'Natural/orgânico: tons terrosos, serifada suave (Lora), fotos grandes com cantos retos, ritmo calmo.',
  'Acadêmico moderno: branco, serifada de leitura (Merriweather / Source Serif), notas e legendas em cinza, numeração de seções marcante.',
  'Luxo discreto: preto, branco e um metálico (#b08d57), letras espaçadas em caixa alta nos rótulos, fotos com muito respiro.',
  'Infográfico: paleta de 3-4 cores vivas coordenadas, ícones geométricos simples em SVG/CSS, dados como protagonistas.',
  'Japonês minimal: muito branco, uma cor de acento (vermelho #c8102e), textos curtos, assimetria calma, fios verticais.',
];

/** Sorteia algumas direções para variar o resultado entre documentos. */
export function pickStyleDirections(count = 3): string[] {
  const pool = [...STYLE_DIRECTIONS];
  const picked: string[] = [];
  while (picked.length < count && pool.length) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return picked;
}
