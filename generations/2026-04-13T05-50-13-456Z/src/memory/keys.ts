// Key extraction from prose.
//
// The agent's journal tool auto-stores each thought in the memory graph with
// a handful of "keys" (search terms). Good keys determine how well the agent
// can later recall the memory through associative traversal.
//
// We do not call an LLM for this — it would roughly double the cost of every
// thought. Instead we use a simple rule-based extractor:
//
//   1. Tokenize on whitespace and punctuation
//   2. Drop stopwords (English + Korean particles/conjunctions)
//   3. Drop short tokens and pure numbers
//   4. Keep unique tokens in order of appearance
//   5. Cap to maxKeys
//
// The agent can override by passing explicit keys via the journal tool's
// `keys` parameter. This is a fallback for when it doesn't bother.

const EN_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "nor", "so", "yet", "for", "of", "in",
  "on", "at", "by", "to", "from", "with", "without", "into", "onto", "upon",
  "is", "are", "was", "were", "be", "been", "being", "am",
  "do", "does", "did", "done", "doing",
  "have", "has", "had", "having",
  "this", "that", "these", "those", "there", "here",
  "i", "me", "my", "mine", "myself",
  "you", "your", "yours", "yourself",
  "it", "its", "itself",
  "he", "she", "they", "them", "their",
  "we", "us", "our", "ours",
  "not", "no", "yes",
  "if", "then", "else", "when", "while", "as", "than",
  "what", "who", "whom", "which", "whose", "how", "why", "where",
  "can", "could", "will", "would", "should", "may", "might", "must", "shall",
  "just", "now", "still", "already", "yet", "also", "too", "very", "really",
  "one", "two", "three", "first", "second", "last",
  "up", "down", "out", "off", "over", "under", "again",
  "about", "against", "between", "among", "through", "during", "before", "after",
  "above", "below",
  "some", "any", "all", "each", "every", "most", "more", "less", "few", "many",
  "other", "others", "another",
  "like", "unlike", "such",
  "own", "same",
  "because", "though", "although",
  "let", "make", "made", "making",
  "go", "goes", "going", "gone", "went",
  "come", "comes", "came", "coming",
  "get", "got", "getting",
  "see", "saw", "seen", "seeing",
  "know", "knew", "known",
  "feel", "felt", "feeling",
  "think", "thought", "thinking",
  "want", "wanted", "wanting",
  "need", "needed",
  "find", "found",
  "say", "said", "says",
  "tell", "told",
]);

// Korean particles (조사) and common auxiliaries. These are not real words —
// they attach to nouns. A naive token split will often leave them as standalone
// short strings that should be ignored.
const KO_PARTICLES = new Set([
  "은", "는", "이", "가", "을", "를", "의", "에", "에서", "에게", "께", "와", "과",
  "로", "으로", "도", "만", "까지", "부터", "조차", "마저", "보다",
  "그리고", "그러나", "하지만", "그래서", "그러면", "그런데", "또한", "또",
  "수", "것", "때", "곳", "일", "게", "거",
  "이다", "있다", "없다", "되다", "하다",
  "그", "이", "저", "어떤", "무슨", "어느",
  "나", "너", "우리", "저희", "내", "네",
  "안", "못", "안된다", "못한다",
  "좀", "그냥", "막",
]);

function isStopword(tok: string): boolean {
  const lower = tok.toLowerCase();
  if (EN_STOPWORDS.has(lower)) return true;
  if (KO_PARTICLES.has(tok)) return true;
  return false;
}

// Test whether a token looks like a word worth keeping as a key.
function isKeepable(tok: string): boolean {
  // Pure numbers
  if (/^\d+$/.test(tok)) return false;
  // Single letters (English) or very short
  if (tok.length < 2) return false;
  // English very-short
  if (/^[a-z]+$/i.test(tok) && tok.length < 3) return false;
  return true;
}

export function extractKeys(text: string, maxKeys = 6): string[] {
  // Split on anything that isn't a letter, number, hyphen, apostrophe, or CJK character.
  const tokens = text
    .split(/[^\p{L}\p{N}\-']+/u)
    .map((t) => t.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const kept: string[] = [];
  for (const tok of tokens) {
    if (kept.length >= maxKeys) break;
    if (isStopword(tok)) continue;
    if (!isKeepable(tok)) continue;
    const norm = tok.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    kept.push(tok);
  }
  return kept;
}
