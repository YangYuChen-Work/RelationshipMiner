export interface SearchableNode {
  readonly id: string;
  readonly primary: string;
  readonly secondary: string;
  readonly className: string | null;
}

export function searchNodes(
  nodes: readonly SearchableNode[],
  query: string,
): SearchableNode[] {
  const keywords = normalizedKeywords(query);
  if (keywords.length === 0) return [];

  return nodes.filter((node) => {
    const text = normalize([node.primary, node.secondary, node.className, node.id].filter(Boolean).join(" "));
    return keywords.some((keyword) => text.includes(keyword));
  }).toSorted((left, right) =>
    normalize(right.primary).localeCompare(normalize(left.primary)) || left.id.localeCompare(right.id),
  );
}

export function nextSearchIndex(currentIndex: number, resultCount: number): number {
  return resultCount > 0 ? (Math.max(currentIndex, -1) + 1) % resultCount : -1;
}

function normalizedKeywords(query: string): string[] {
  const normalized = normalize(query);
  return normalized ? normalized.split(" ") : [];
}

function normalize(text: string): string {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
