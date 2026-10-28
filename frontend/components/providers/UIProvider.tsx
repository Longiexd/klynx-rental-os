"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fr } from "@/lib/i18n/fr";

export type KlynxTheme = "dark" | "light";
export type KlynxLocale = "en" | "fr";

type UIContextValue = {
  theme: KlynxTheme;
  locale: KlynxLocale;
  setTheme: (theme: KlynxTheme) => void;
  setLocale: (locale: KlynxLocale) => void;
  t: (english: string) => string;
};

const UIContext = createContext<UIContextValue | null>(null);
const THEME_KEY = "klynx-theme";
const LOCALE_KEY = "klynx-locale";
const originalText = new WeakMap<Text, string>();
const lastRenderedText = new WeakMap<Text, string>();
const originalAttrs = new WeakMap<Element, Map<string, string>>();
const lastRenderedAttrs = new WeakMap<Element, Map<string, string>>();
const translatableAttrs = ["placeholder", "title", "aria-label"] as const;

const legacyFrenchToEnglish: Record<string, string> = {
  "Disponible": "Available",
  "Réservé": "Reserved",
  "Reserve": "Reserved",
  "Loué": "Rented",
  "Loue": "Rented",
  "Nettoyage": "Cleaning",
  "Indisponible": "Unavailable",
  "Non défini": "Undefined",
  "Nouveau prospect": "New prospect",
  "Contacté": "Contacted",
  "Contacte": "Contacted",
  "Devis envoyé": "Quotation sent",
  "Devis envoye": "Quotation sent",
  "Réservation confirmée": "Booking confirmed",
  "Reservation confirmee": "Booking confirmed",
  "Véhicule remis": "Vehicle delivered",
  "Vehicule remis": "Vehicle delivered",
  "Location terminée": "Rental completed",
  "Location terminee": "Rental completed",
  "Gagné": "Won",
  "Gagne": "Won",
  "Perdu": "Lost",
  "Réparation": "Repair",
  "Reparation": "Repair",
  "Entretien": "Maintenance",
};

const monthFr: Record<string, string> = {
  Jan: "janv.", Feb: "févr.", Mar: "mars", Apr: "avr.", May: "mai", Jun: "juin",
  Jul: "juil.", Aug: "août", Sep: "sept.", Oct: "oct.", Nov: "nov.", Dec: "déc.",
};
const fullMonthFr: Record<string, string> = {
  January: "janvier", February: "février", March: "mars", April: "avril", May: "mai", June: "juin",
  July: "juillet", August: "août", September: "septembre", October: "octobre", November: "novembre", December: "décembre",
};

function localizeDateFragments(value: string, locale: KlynxLocale) {
  if (locale === "en") return value;
  return value.replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December)(?= \d{4}\b)/g, month => fullMonthFr[month])
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, (month) => monthFr[month] ?? month);
}

function translateExact(value: string, locale: KlynxLocale) {
  const canonical = legacyFrenchToEnglish[value] ?? value;
  if (locale === "en") return canonical;
  if (fr[canonical]) return fr[canonical];
  const invoicePolicy = canonical.match(/^(.+): (invoice policy is delivered quantities, but no delivery is recorded\. Review delivery or the product invoice policy in Odoo\.)$/);
  if (invoicePolicy) return `${invoicePolicy[1]}: ${fr[invoicePolicy[2]]}`;
  // Translate UI fragments around counts without translating customer/product data.
  const numbered = canonical.match(/^([✓\d]+) (.+)$/);
  if (numbered && fr[numbered[2]]) return `${numbered[1]} ${fr[numbered[2]]}`;
  const counted = canonical.match(/^(\d+) (orders?|invoices?|leads?|customers|kilometers)$/);
  if (counted && fr[counted[2]]) return `${counted[1]} ${fr[counted[2]]}`;
  const fleet = canonical.match(/^of (\d+) in fleet$/);
  if (fleet) return `sur ${fleet[1]} dans la flotte`;
  const attention = canonical.match(/^(\d+) pickup paperwork incomplete · (\d+) late pickups? · (\d+) overdue returns$/);
  if (attention) return `${attention[1]} documents de départ incomplets · ${attention[2]} départs en retard · ${attention[3]} retours en retard`;
  const activities = canonical.match(/^View all activities \((\d+)\) →$/);
  if (activities) return `Voir toutes les activités (${activities[1]}) →`;
  const performance = canonical.match(/^(Month|Vehicle|Product category|Vehicle category|Customer) performance · (\d{4})$/);
  if (performance) return `${fr[performance[1]] ?? performance[1]} · performances ${performance[2]}`;
  const pickup = canonical.match(/^(Pickup due · |Pickup due )(.+)$/);
  if (pickup) return localizeDateFragments(`${fr["Pickup due"]}${pickup[1].includes("·") ? " · " : " "}${pickup[2]}`, locale);
  const dueDate = canonical.match(/^· Due (.+)$/);
  if (dueDate) return localizeDateFragments(`· ${fr.Due} ${dueDate[1]}`, locale);
  return localizeDateFragments(canonical, locale);
}

function applyTranslation(root: ParentNode, locale: KlynxLocale) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;

  while (node) {
    const parent = node.parentElement;
    if (parent && !parent.closest("[data-i18n-ignore], script, style, code, pre, textarea")) {
      const current = node.nodeValue ?? "";
      if (!originalText.has(node)) {
        originalText.set(node, current);
      } else {
        const lastRendered = lastRenderedText.get(node);
        if (lastRendered !== undefined && current !== lastRendered) {
          // React changed this text after it was first rendered (for example a
          // greeting, async status or error). Treat the new English text as
          // the new canonical source instead of restoring a stale phrase.
          originalText.set(node, current);
        }
      }
      const source = originalText.get(node) ?? "";
      const leading = source.match(/^\s*/)?.[0] ?? "";
      const trailing = source.match(/\s*$/)?.[0] ?? "";
      const core = source.trim();
      if (core) {
        const translated = `${leading}${translateExact(core, locale)}${trailing}`;
        lastRenderedText.set(node, translated);
        if (node.nodeValue !== translated) node.nodeValue = translated;
      }
    }
    node = walker.nextNode() as Text | null;
  }

  const selector = translatableAttrs.map(attr => `[${attr}]`).join(",");
  const elements = root instanceof Element ? [root, ...root.querySelectorAll(selector)] : [...root.querySelectorAll(selector)];
  for (const element of elements) {
    if (element.closest("[data-i18n-ignore]")) continue;
    let attrs = originalAttrs.get(element);
    if (!attrs) {
      attrs = new Map<string, string>();
      originalAttrs.set(element, attrs);
    }
    let rendered = lastRenderedAttrs.get(element);
    if (!rendered) { rendered = new Map<string, string>(); lastRenderedAttrs.set(element, rendered); }
    for (const attr of translatableAttrs) {
      const current = element.getAttribute(attr);
      if (current === null) { attrs.delete(attr); rendered.delete(attr); continue; }
      if (!attrs.has(attr) || rendered.has(attr) && current !== rendered.get(attr)) attrs.set(attr, current);
      const source = attrs.get(attr);
      if (source !== undefined) {
        const translated = translateExact(source, locale);
        rendered.set(attr, translated);
        if (current !== translated) element.setAttribute(attr, translated);
      }
    }
  }
}

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<KlynxTheme>("dark");
  const [locale, setLocaleState] = useState<KlynxLocale>("en");

  useEffect(() => {
    let storedTheme: string | null = null;
    let storedLocale: string | null = null;
    try {
      storedTheme = window.localStorage.getItem(THEME_KEY);
      storedLocale = window.localStorage.getItem(LOCALE_KEY);
    } catch {
      // Browser privacy settings may disable storage. Preferences still work in memory.
    }
    const nextTheme: KlynxTheme = storedTheme === "light" ? "light" : "dark";
    const nextLocale: KlynxLocale = storedLocale === "fr" ? "fr" : "en";
    // Match the server's first render, then restore browser-only preferences after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(nextTheme);
    setLocaleState(nextLocale);
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.lang = nextLocale;
  }, []);

  const setTheme = useCallback((nextTheme: KlynxTheme) => {
    setThemeState(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    try { window.localStorage.setItem(THEME_KEY, nextTheme); } catch { /* Keep the in-memory preference. */ }
  }, []);

  const setLocale = useCallback((nextLocale: KlynxLocale) => {
    setLocaleState(nextLocale);
    document.documentElement.lang = nextLocale;
    try { window.localStorage.setItem(LOCALE_KEY, nextLocale); } catch { /* Keep the in-memory preference. */ }
  }, []);

  const t = useCallback((english: string) => translateExact(english, locale), [locale]);

  useEffect(() => {
    applyTranslation(document.body, locale);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          applyTranslation(mutation.target as Element, locale);
          continue;
        }
        if (mutation.type === "characterData") {
          const text = mutation.target as Text;
          const parent = text.parentElement;
          if (parent) applyTranslation(parent, locale);
          continue;
        }
        for (const addedNode of mutation.addedNodes) {
          if (addedNode.nodeType === Node.TEXT_NODE) {
            const text = addedNode as Text;
            const parent = text.parentElement;
            if (parent) applyTranslation(parent, locale);
          } else if (addedNode.nodeType === Node.ELEMENT_NODE) {
            applyTranslation(addedNode as Element, locale);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, characterData: true, attributes: true, attributeFilter: [...translatableAttrs], subtree: true });
    return () => observer.disconnect();
  }, [locale]);

  const value = useMemo(() => ({ theme, locale, setTheme, setLocale, t }), [theme, locale, setTheme, setLocale, t]);

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useKlynxUI() {
  const context = useContext(UIContext);
  if (!context) throw new Error("useKlynxUI must be used within UIProvider");
  return context;
}
