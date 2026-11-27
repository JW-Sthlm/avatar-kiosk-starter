import type { GuardrailResult, KnowledgeSource, ProductKnowledgeItem } from "../shared/contracts.js";

const heliosCatalogue = {
  title: "Helios Telecom product guide (fictional)",
  url: "https://example.com/helios/products"
};

export const kioskKnowledgeBase: ProductKnowledgeItem[] = [
  {
    id: "pack-internet-mobile-tv",
    title: "Home pack: internet, mobile and TV",
    category: "Pack",
    summary:
      "The Helios home pack puts home internet, TV and up to five mobile plans on one bill. It suits households that want one monthly price instead of three contracts.",
    sourceTitle: heliosCatalogue.title,
    sourceUrl: `${heliosCatalogue.url}#home-pack`,
    tags: ["pack", "bundle", "family", "household", "mobile", "internet", "tv", "discount", "multi-product"]
  },
  {
    id: "internet",
    title: "Home internet",
    category: "Internet",
    summary:
      "Helios home internet comes in three speeds over fibre or 5G, all with unlimited data and a Wi-Fi router included. Customers can buy it alone or as part of the home pack.",
    sourceTitle: heliosCatalogue.title,
    sourceUrl: `${heliosCatalogue.url}#internet`,
    tags: ["internet", "fiber", "fibre", "wifi", "home", "broadband", "unlimited", "router", "speed", "5g"]
  },
  {
    id: "tv",
    title: "TV",
    category: "TV",
    summary:
      "Helios TV streams live channels and a catch-up library to the TV box and to the Helios TV app on phones and tablets. Most customers take it as part of the home pack.",
    sourceTitle: heliosCatalogue.title,
    sourceUrl: `${heliosCatalogue.url}#tv`,
    tags: ["tv", "television", "channels", "box", "streaming", "app", "pack", "home"]
  },
  {
    id: "mobile-subscriptions",
    title: "Mobile plans",
    category: "Mobile",
    summary:
      "Helios mobile plans come with small, medium or unlimited data, all with unlimited calls and texts. Roaming in the EU is included, and every extra plan in the same household gets a discount.",
    sourceTitle: heliosCatalogue.title,
    sourceUrl: `${heliosCatalogue.url}#mobile`,
    tags: ["mobile", "subscription", "plan", "data", "sms", "texts", "calls", "roaming", "teen", "daughter", "sim"]
  },
  {
    id: "prepaid",
    title: "Prepaid SIM",
    category: "Prepaid",
    summary:
      "The Helios prepaid SIM has no contract. Customers top up in the app or in store and pick a data bundle that lasts 30 days, which keeps spending under control.",
    sourceTitle: heliosCatalogue.title,
    sourceUrl: `${heliosCatalogue.url}#prepaid`,
    tags: ["prepaid", "top-up", "topup", "reload", "sim", "budget", "control", "calls", "sms", "data"]
  },
  {
    id: "smart-home",
    title: "Smart home",
    category: "Smart Home",
    summary:
      "Helios smart home adds connected cameras, sensors and smart plugs that customers control from the Helios Home app over their home Wi-Fi.",
    sourceTitle: heliosCatalogue.title,
    sourceUrl: `${heliosCatalogue.url}#smart-home`,
    tags: ["smart", "home", "connected", "camera", "sensor", "plug", "devices", "wifi", "house", "app"]
  },
  {
    id: "smartphones-devices",
    title: "Phones and devices",
    category: "Devices",
    summary:
      "Customers can pay for phones and tablets in full or spread the cost over 24 months with a mobile plan. A store advisor confirms stock and final conditions.",
    sourceTitle: "Helios Telecom device catalogue (fictional)",
    sourceUrl: "https://example.com/helios/devices",
    tags: ["phone", "smartphone", "device", "tablet", "iphone", "samsung", "accessory", "instalment", "bundle"]
  },
  {
    id: "store-handoff",
    title: "Store advisor handoff",
    category: "Service",
    summary:
      "The kiosk hands account, payment, identity, contract and final purchase questions to a Helios store advisor.",
    sourceTitle: "Prototype guardrail",
    sourceUrl: `${heliosCatalogue.url}#advisor`,
    tags: ["advisor", "store", "handoff", "contract", "payment", "bill", "invoice", "cancel", "identity", "support"]
  }
];

const telecomTerms = [
  "helios",
  "mobile",
  "subscription",
  "plan",
  "internet",
  "fiber",
  "fibre",
  "wifi",
  "tv",
  "television",
  "pack",
  "bundle",
  "prepaid",
  "sim",
  "data",
  "roaming",
  "phone",
  "smartphone",
  "device",
  "store",
  "advisor",
  "support",
  "home",
  "family",
  "daughter",
  "teen",
  "price",
  "offer",
  "promo",
  "contract"
];

const accountTerms = [
  "account",
  "bill",
  "invoice",
  "payment",
  "refund",
  "cancel",
  "cancellation",
  "contract",
  "address",
  "password",
  "pin",
  "puk",
  "iban",
  "bank",
  "credit card",
  "personal number",
  "identity card",
  "customer number"
];

const priceTerms = ["price", "cost", "euro", "eur", "cheap", "cheapest", "promotion", "promo", "discount", "deal"];

const tokensFrom = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

export function evaluateKioskGuardrails(utterance: string): GuardrailResult {
  const lower = utterance.toLowerCase();
  const reasons: string[] = [];
  const mentionsTelecom = includesAny(lower, telecomTerms);
  const mentionsAccount = includesAny(lower, accountTerms);
  const mentionsPricing = includesAny(lower, priceTerms);

  if (mentionsAccount) {
    reasons.push("Account, payment, identity, cancellation, PIN/PUK or contract-specific questions need a human advisor.");
  }
  if (mentionsPricing) {
    reasons.push("Final prices, promotions and contract conditions can change and must be confirmed in the current Helios channel.");
  }
  if (!mentionsTelecom) {
    reasons.push("The request is outside the Helios telecom retail assistant scope.");
  }

  if (!mentionsTelecom) {
    return {
      status: "out-of-scope",
      scope: "unsupported",
      reasons,
      safeCompletion:
        "I can help with Helios mobile, internet, TV, prepaid, smartphone, Smart Home and store handoff questions. For anything else, I should bring in a store advisor.",
      requiresHandoff: true
    };
  }

  if (mentionsAccount) {
    return {
      status: "handoff",
      scope: "customer-account",
      reasons,
      safeCompletion:
        "I cannot access or collect personal account, payment, identity, PIN/PUK or contract details in this kiosk. I can summarize your question for a Helios store advisor.",
      requiresHandoff: true
    };
  }

  return {
    status: mentionsPricing ? "handoff" : "allowed",
    scope: "retail",
    reasons,
    safeCompletion: mentionsPricing
      ? "I can explain product families and trade-offs, but a Helios advisor or the current Helios website must confirm final prices and promotions."
      : "The request is within the Helios telecom retail assistant scope.",
    requiresHandoff: mentionsPricing
  };
}

export function retrieveKioskKnowledge(utterance: string, limit = 3): KnowledgeSource[] {
  const queryTokens = new Set(tokensFrom(utterance));
  const scored = kioskKnowledgeBase.map((item) => {
    const searchable = tokensFrom(`${item.title} ${item.category} ${item.summary} ${item.tags.join(" ")}`);
    const score = searchable.reduce((total, token) => total + (queryTokens.has(token) ? 1 : 0), 0);
    return { item, score };
  });

  scored.sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title));

  const matches = scored.filter(({ score }) => score > 0).slice(0, limit);
  const fallback = scored
    .filter(({ item }) => ["mobile-subscriptions", "pack-internet-mobile-tv", "internet"].includes(item.id))
    .slice(0, limit);

  return (matches.length > 0 ? matches : fallback).map(({ item }) => ({
    title: item.title,
    category: item.category,
    sourceTitle: item.sourceTitle,
    sourceUrl: item.sourceUrl,
    excerpt: item.summary
  }));
}
