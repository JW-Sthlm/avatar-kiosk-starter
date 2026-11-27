import type { AssistantCard, AssistantResponse } from "../shared/contracts.js";
import { evaluateKioskGuardrails, retrieveKioskKnowledge } from "./kioskKnowledge.js";

const defaultCards: AssistantCard[] = [
  {
    title: "Helios mobile plans",
    body: "Start with data needs, unlimited messaging, roaming expectations, and whether the household already has Helios services.",
    tag: "Retrieved"
  },
  {
    title: "Home pack: internet, mobile and TV",
    body: "If this is for a family or household, compare a mobile-only answer with a pack that combines services.",
    tag: "Retrieved"
  }
];

function cardsFromSources(sources: ReturnType<typeof retrieveKioskKnowledge>): AssistantCard[] {
  return sources.map((source) => ({
    title: source.title,
    body: source.excerpt,
    tag: source.category
  }));
}

export function createMockAssistantResponse(utterance: string, startedAt: number): AssistantResponse {
  const lower = utterance.toLowerCase();
  const guardrails = evaluateKioskGuardrails(utterance);
  const knowledgeSources = retrieveKioskKnowledge(utterance);
  const retrievedCards = cardsFromSources(knowledgeSources);

  if (guardrails.status === "out-of-scope" || guardrails.scope === "customer-account") {
    return {
      text: guardrails.safeCompletion,
      cards: retrievedCards.length > 0 ? retrievedCards : defaultCards,
      handoffSuggested: true,
      source: "mock",
      latencyMs: Date.now() - startedAt,
      knowledgeSources,
      guardrails
    };
  }

  let text =
    "I can help with that. Based on the Helios product knowledge in this prototype, I would compare the relevant Helios product families and keep the final recommendation simple for the customer.";
  let cards = retrievedCards.length > 0 ? retrievedCards : defaultCards;
  let handoffSuggested = guardrails.requiresHandoff;

  if (lower.includes("roaming") || lower.includes("europe") || lower.includes("travel")) {
    text =
      "If roaming in Europe matters, I would start with Helios mobile plans and focus the conversation on data needs, calling, messaging and travel expectations. Final roaming conditions should be confirmed with the current Helios offer before purchase.";
    cards = [
      {
        title: "Roaming-first mobile path",
        body: "Use the mobile subscription context first, then ask whether the household should also compare a pack.",
        tag: "Guarded"
      },
      ...cards
    ];
  } else if (lower.includes("daughter") || lower.includes("teen")) {
    text =
      "For your daughter, I would ask three practical questions: how much data she uses, whether she travels, and whether you want prepaid cost control or a subscription. Then I would compare Helios mobile plans with the prepaid SIM and suggest a store advisor for the final plan.";
  } else if (lower.includes("prepaid")) {
    text =
      "Got it, prepaid changes the path. I would show the Helios prepaid SIM as the controlled-spend option, then compare that with a mobile plan if the customer needs more data or household benefits.";
    cards = [
      {
        title: "Prepaid path",
        body: "Use prepaid when the customer wants control and top-up flexibility instead of a recurring subscription.",
        tag: "Retrieved"
      }
    ];
  } else if (lower.includes("phone") || lower.includes("device")) {
    text =
      "If you also need a new phone, I would handle it as a plan-plus-device conversation: pick the right Helios mobile or pack first, then let the advisor confirm device availability and conditions.";
    handoffSuggested = true;
  } else if (lower.includes("internet") || lower.includes("wifi") || lower.includes("fiber") || lower.includes("fibre")) {
    text =
      "For home connectivity, I would start with Helios internet and then ask whether the household also wants mobile and TV in one pack. That keeps the recommendation easy to compare in store.";
  } else if (lower.includes("tv") || lower.includes("television")) {
    text =
      "For TV, I would explain it together with the home pack: Helios TV streams live channels and catch-up to the TV box and the app, and most households take it alongside internet and mobile.";
  } else if (lower.includes("help") || lower.includes("advisor") || lower.includes("handoff")) {
    text =
      "I can prepare a short summary and ask a Helios store advisor to continue from here. That makes the kiosk useful without pretending to replace the staff.";
    handoffSuggested = true;
  }

  if (guardrails.reasons.length > 0) {
    text = `${text} ${guardrails.safeCompletion}`;
  }

  return {
    text,
    cards,
    handoffSuggested,
    source: "mock",
    latencyMs: Date.now() - startedAt,
    knowledgeSources,
    guardrails
  };
}

