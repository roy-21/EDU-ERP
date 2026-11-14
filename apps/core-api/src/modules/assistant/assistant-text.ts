// Text handling for the assistant: words for search, language, the kind of question, and
// splitting documents into chunks. All of it is deterministic so it can be tested and so a
// question about changing data is recognised without trusting a language model to notice.

export type Language = "en" | "bn";
export type LiveTopic = "MEAL_COUNT" | "MEAL_MENU" | "MEAL_TIME" | "ATTENDANCE" | "RESULT" | "FEES_DUE" | "APPLICATION";
export type Intent =
  | { kind: "ACTION" }
  | { kind: "LIVE_DATA"; topic: LiveTopic }
  | { kind: "KNOWLEDGE" };

export const languageOf = (value: string): Language => (/[ঀ-৿]/.test(value) ? "bn" : "en");

const STOPWORDS = new Set([
  // English
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "am", "do", "does", "did", "of", "to", "in", "on", "at", "for",
  "and", "or", "it", "its", "this", "that", "these", "those", "with", "by", "from", "as", "can", "could", "will", "would",
  "should", "may", "might", "what", "which", "who", "whom", "how", "when", "where", "why", "there", "here", "have", "has",
  "had", "i", "me", "my", "we", "our", "you", "your", "he", "she", "they", "them", "their", "his", "her", "please", "tell",
  "about", "any", "some", "if", "so", "than", "then", "also", "just", "into", "up", "out", "no", "not", "yes", "much", "many",
  // Bangla
  "আমি", "আমার", "আমাদের", "তুমি", "তোমার", "আপনি", "আপনার", "কি", "কী", "কত", "কোন", "কোনো", "কখন", "কেন", "কিভাবে", "কীভাবে",
  "এর", "ও", "এবং", "বা", "হয়", "হয়", "হবে", "আছে", "নেই", "এই", "সেই", "যে", "তা", "না", "জন্য", "থেকে", "করে", "করতে", "দিয়ে",
  "একটি", "একটা", "হলে", "তাহলে", "বলুন", "বলো", "জানতে", "চাই",
  // Banglish
  "ami", "amar", "ki", "koto", "kobe", "kokhon", "keno", "kivabe", "ar", "ba", "hoy", "hobe", "ache", "nai", "na", "theke", "jonno",
]);

const BANGLA_SUFFIXES = ["গুলোর", "গুলো", "গুলি", "দের", "টার", "টির", "য়ের", "ের", "কে", "তে", "টা", "টি", "র"];

const stem = (word: string): string => {
  if (/[ঀ-৿]/.test(word)) {
    for (const suffix of BANGLA_SUFFIXES) {
      if (word.length - suffix.length >= 2 && word.endsWith(suffix)) return word.slice(0, -suffix.length);
    }
    return word;
  }
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) return word.slice(0, -1);
  return word;
};

// The searchable words of a text, in order, repeats kept (for term frequency).
export const wordsOf = (value: string): string[] =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word))
    .map(stem)
    .filter((word) => word.length >= 2);

export const termsOf = (value: string): string[] => [...new Set(wordsOf(value))];

// ---- What kind of question is it? ------------------------------------------------

const CHANGE_VERBS_EN = "change|update|modify|edit|delete|remove|erase|create|add|insert|register|enrol|enroll|approve|reject|cancel|mark|set|increase|decrease|reset|waive|refund|pay|book|transfer|assign|grant|give|make|fix|correct|clear";
const ACTION_EN = [
  new RegExp(`^\\s*(please\\s+|pls\\s+|kindly\\s+)?(${CHANGE_VERBS_EN})\\b`, "i"),
  new RegExp(`\\b(can|could|would|will)\\s+you\\s+(please\\s+)?(${CHANGE_VERBS_EN})\\b`, "i"),
  new RegExp(`\\b(i\\s+want|i\\s+need|i'd\\s+like)\\s+you\\s+to\\s+(${CHANGE_VERBS_EN})\\b`, "i"),
  new RegExp(`\\b(${CHANGE_VERBS_EN})\\s+(my|his|her|their|the|this|all)\\b.*\\b(attendance|result|results|grade|grades|marks|payment|payments|fee|fees|record|records|user|account|profile|application|setting|settings|student|invoice)\\b`, "i"),
];
const ACTION_BANGLISH = new RegExp(`\\b(${CHANGE_VERBS_EN}|present|absent|pass)\\b.*\\bkore\\s+(dao|din|den|de|diben|dite)\\b`, "i");
const ACTION_BN_VERB = /(পরিবর্তন|বদল|বদলে|মুছে|মুছ|ডিলিট|বাতিল|অনুমোদন|যোগ|তৈরি|আপডেট|এডিট|ঠিক|বাড়িয়ে|বাড়িয়ে|কমিয়ে|উপস্থিত|পাস|মওকুফ|ফেরত)/;
const ACTION_BN_REQUEST = /(করে\s*দাও|করে\s*দিন|করে\s*দেন|করে\s*দে|করুন|করো|কর\s|দাও|দিন|দেন)(\s|$|[।?!.,])/;
const QUESTION_OPENERS = /^\s*(how|what|where|when|why|which|who|is it possible|is there|do i|can i|could i|should i|kivabe|কিভাবে|কীভাবে|কোথায়|কখন|কেন)\b/i;

const isActionRequest = (value: string): boolean => {
  if (QUESTION_OPENERS.test(value) || /^\s*(কিভাবে|কীভাবে|কোথায়|কখন|কেন)/.test(value)) return false;
  if (ACTION_EN.some((pattern) => pattern.test(value))) return true;
  if (ACTION_BANGLISH.test(value)) return true;
  return ACTION_BN_VERB.test(value) && ACTION_BN_REQUEST.test(value);
};

// Personal data needs the asker to be talking about themselves (or their child).
const PERSONAL = /\b(my|mine|me|i|i've|i'm|i have|am i|son|daughter|child|ward)\b|আমার|আমি|আমাকে|ছেলে|মেয়ে|সন্তান|\bamar\b|\bami\b/i;

const LIVE_PATTERNS: { topic: LiveTopic; pattern: RegExp; personal: boolean }[] = [
  { topic: "MEAL_COUNT", personal: false, pattern: /(how many|number of|count of)\s.{0,30}meals?|meals?.{0,25}(have i|did i|i had|i've had|i have had|eaten|taken)|(কয়|কয়)\s*(টা|টি|বেলা)?\s*(মিল|খাবার)|কত(গুলো)?\s*(মিল|বেলা)|\b(koyta|koto)\s*(ta\s*)?meal/i },
  { topic: "MEAL_TIME", personal: false, pattern: /\b(meal|meals|lunch|dinner|breakfast|dining|canteen|food)\b.{0,40}\b(end|ends|close|closes|closing|until|last|time|timing|open|opens|start|starts|serve|served|collect)\b|\b(end|ends|close|closes|until|what time|when)\b.{0,40}\b(meal|meals|lunch|dinner|breakfast|dining|food)\b|(খাবার|মিল|লাঞ্চ|ডিনার|নাস্তা).{0,25}(শেষ|সময়|সময়|কখন|কয়টা|কয়টা)|(শেষ|কখন).{0,25}(খাবার|মিল)/i },
  { topic: "MEAL_MENU", personal: false, pattern: /\bmenu\b|what('?s| is| are)\s+(for\s+)?(today'?s\s+)?(breakfast|lunch|dinner|meal)|today'?s\s+(breakfast|lunch|dinner|meal|food)|মেনু|আজ(কে|কের)?\s*(কী|কি)\s*খাবার|আজকের\s*খাবার|\bki\s+khabar\b/i },
  { topic: "ATTENDANCE", personal: true, pattern: /\battendance\b|\bpresent (percentage|rate)\b|হাজিরা|উপস্থিতি/i },
  { topic: "RESULT", personal: true, pattern: /\b(result|results|gpa|cgpa|grade|grades|marks|transcript)\b|ফলাফল|রেজাল্ট|জিপিএ|সিজিপিএ|গ্রেড|নম্বর/i },
  // Money still owed is always the asker's own, even when they do not say "my".
  { topic: "FEES_DUE", personal: false, pattern: /\b(due|dues|pending|outstanding|owe|unpaid|balance)\b.{0,30}\b(payment|payments|fee|fees|bill|bills|amount|money|rent|tuition)\b|\b(payment|payments|fee|fees|bill|bills|rent|tuition)\b.{0,30}\b(due|dues|pending|outstanding|unpaid|left)\b|how much (do|should) i (owe|pay)|বকেয়া|বাকি\s*(টাকা|ফি|বেতন|ভাড়া|ভাড়া)|\bdue\s+koto\b/i },
  { topic: "APPLICATION", personal: true, pattern: /\bapplication status\b|\bstatus of (my|the) application\b|\bmy application\b|আবেদন(ের|ের)?\s*(অবস্থা|স্ট্যাটাস|কী|কি)/i },
];

export const intentOf = (question: string): Intent => {
  if (isActionRequest(question)) return { kind: "ACTION" };
  const personal = PERSONAL.test(question);
  for (const item of LIVE_PATTERNS) {
    if (item.pattern.test(question) && (!item.personal || personal)) return { kind: "LIVE_DATA", topic: item.topic };
  }
  return { kind: "KNOWLEDGE" };
};

// ---- Documents into chunks -------------------------------------------------------

export const cleanText = (value: string): string =>
  value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// Paragraph-aware chunks of about `size` characters; each starts with the end of the
// previous one so a fact that spans the boundary is still found whole.
export const chunkText = (value: string, size = 900, overlap = 150): string[] => {
  const text = cleanText(value);
  if (!text) return [];
  const pieces: string[] = [];
  for (const paragraph of text.split(/\n\s*\n/)) {
    if (paragraph.length <= size) {
      pieces.push(paragraph.trim());
      continue;
    }
    // A long paragraph is split at sentence ends, and a very long sentence by length.
    let rest = paragraph.trim();
    while (rest.length > size) {
      const window = rest.slice(0, size);
      const stop = Math.max(window.lastIndexOf(". "), window.lastIndexOf("। "), window.lastIndexOf("? "), window.lastIndexOf("\n"));
      const cut = stop > size * 0.5 ? stop + 1 : size;
      pieces.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) pieces.push(rest);
  }
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > size) {
      chunks.push(current);
      const tail = current.slice(-overlap);
      const start = tail.search(/\s/);
      current = `${start >= 0 ? tail.slice(start + 1) : tail}\n\n${piece}`;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks.filter((chunk) => termsOf(chunk).length > 0);
};
