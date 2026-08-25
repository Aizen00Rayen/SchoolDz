import { useEffect } from "react";

const SITE_URL = "https://scolaris.cloud";
const DEFAULT_IMAGE = `${SITE_URL}/icon-512.png`;

function setMetaByName(name, content) {
  if (content == null) return;
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setMetaByProperty(property, content) {
  if (content == null) return;
  let el = document.querySelector(`meta[property="${property}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", property);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setLink(rel, href) {
  if (href == null) return;
  let el = document.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function setJsonLd(id, data) {
  let el = document.getElementById(id);
  if (!data) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("script");
    el.type = "application/ld+json";
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

/**
 * Sets per-page title/description/canonical/Open Graph/Twitter-card meta
 * tags and (optionally) a JSON-LD block, by mutating document.head directly
 * — this app is a plain CRA SPA with no server-side rendering, so there's
 * no react-helmet-style "render into head" story; a handful of imperative
 * DOM writes in an effect is the simplest thing that actually works here.
 * Every tag is reused (found-or-created) rather than duplicated, so
 * navigating between pages doesn't pile up stale <meta>/<link> elements.
 *
 * `path` is the route path (e.g. "/pricing") used to build the canonical
 * and og:url — pass it explicitly rather than reading location so this stays
 * a pure function of its props and is easy to reason about from call sites.
 */
export function useSEO({ title, description, path = "", image, noindex = false, jsonLd }) {
  useEffect(() => {
    const url = `${SITE_URL}${path}`;
    if (title) document.title = title;
    setMetaByName("description", description);
    setMetaByName("robots", noindex ? "noindex, nofollow" : "index, follow");
    setLink("canonical", url);

    setMetaByProperty("og:type", "website");
    setMetaByProperty("og:site_name", "Scolaris");
    setMetaByProperty("og:url", url);
    setMetaByProperty("og:title", title);
    setMetaByProperty("og:description", description);
    setMetaByProperty("og:image", image || DEFAULT_IMAGE);

    setMetaByName("twitter:card", "summary_large_image");
    setMetaByName("twitter:title", title);
    setMetaByName("twitter:description", description);
    setMetaByName("twitter:image", image || DEFAULT_IMAGE);

    setJsonLd("seo-jsonld", jsonLd || null);
    // No cleanup on unmount: the next page's useSEO call overwrites these
    // same tags on its own mount, which — because effects run in mount
    // order — always happens after this one during a route change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, path, image, noindex, JSON.stringify(jsonLd)]);
}
