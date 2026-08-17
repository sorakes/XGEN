/**
 * Resumo compacto do que uma página REALMENTE imprimiu.
 *
 * A página seguinte precisa saber o que já foi dito para não repetir conteúdo
 * e para manter a continuidade (mesmo rodapé, mesma numeração, narrativa que
 * avança). Passar o HTML bruto das páginas anteriores estouraria o contexto
 * rapidamente — então extraímos só títulos e um trecho do texto visível.
 */
export interface PageDigest {
  n: number;
  title: string;
  headings: string[];
  excerpt: string;
}

function stripTags(html: string): string {
  return html
    // Scripts (config do Chart.js) e styles são ruído puro para o resumo.
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function digestPage(n: number, title: string, html: string): PageDigest {
  const headings = Array.from(html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi))
    .map(match => stripTags(match[1]))
    .filter(Boolean)
    .slice(0, 12);

  return {
    n,
    title,
    headings,
    excerpt: stripTags(html).slice(0, 600),
  };
}

/** Formata os resumos para injetar no prompt da próxima página. */
export function renderDigests(digests: PageDigest[]): string {
  if (digests.length === 0) {
    return 'Nenhuma — esta é a PRIMEIRA página do documento. Você está definindo o padrão visual que as próximas vão seguir.';
  }

  return digests
    .map(d => {
      const headings = d.headings.length ? d.headings.join(' | ') : '(sem títulos)';
      return `--- PÁGINA ${d.n} — "${d.title}" ---\nTítulos usados: ${headings}\nTexto impresso: ${d.excerpt}`;
    })
    .join('\n\n');
}
