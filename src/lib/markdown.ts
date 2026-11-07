/**
 * A very small, safe formatter for Santa's messages. All text is escaped first, so nothing a model
 * or a family member writes can become live HTML. Only web links become clickable.
 */

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function inline(escaped: string): string {
	return escaped
		.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label: string, url: string) => {
			return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
		})
		.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
		.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, '$1<em>$2</em>')
		.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_match, lead: string, url: string) => {
			return `${lead}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
		});
}

export function renderMarkdown(text: string): string {
	const lines = escapeHtml(text.trim()).split(/\r?\n/);
	const out: string[] = [];
	let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
	let paragraph: string[] = [];

	const flushParagraph = () => {
		if (paragraph.length) out.push(`<p>${inline(paragraph.join('<br>'))}</p>`);
		paragraph = [];
	};
	const flushList = () => {
		if (list) out.push(`<${list.tag}>${list.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${list.tag}>`);
		list = null;
	};

	for (const line of lines) {
		const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
		const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
		const heading = line.match(/^#{1,4}\s+(.*)$/);
		if (bullet || numbered) {
			flushParagraph();
			const tag = bullet ? 'ul' : 'ol';
			if (list && list.tag !== tag) flushList();
			list ??= { tag, items: [] };
			list.items.push((bullet ?? numbered)![1]);
		} else if (!line.trim()) {
			flushParagraph();
			flushList();
		} else if (heading) {
			flushParagraph();
			flushList();
			out.push(`<p><strong>${inline(heading[1])}</strong></p>`);
		} else {
			flushList();
			paragraph.push(line);
		}
	}
	flushParagraph();
	flushList();
	return out.join('');
}
