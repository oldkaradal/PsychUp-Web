// Fetches the psychiatry RSS feeds and writes web/data/news.json for the PsycUp web app.
// Runs in GitHub Actions on a schedule; browsers cannot read most feeds directly (CORS).
import { XMLParser } from "fast-xml-parser";
import { readFile, writeFile } from "node:fs/promises";

const FEEDS = [
  { name: "Psychiatric Times", url: "https://www.psychiatrictimes.com/rss" },
  { name: "ScienceDaily Psychiatrie", url: "https://www.sciencedaily.com/rss/mind_brain/psychiatry.xml" },
  { name: "The Mental Elf", url: "https://www.nationalelfservice.net/mental-health/feed/" },
  { name: "JAMA Psychiatry", url: "https://jamanetwork.com/rss/site_14/70.xml" },
  { name: "The Lancet Psychiatry", url: "https://www.thelancet.com/rssfeed/lanpsy_online.xml" },
  { name: "American Journal of Psychiatry", url: "https://psychiatryonline.org/action/showFeed?type=etoc&feed=rss&jc=ajp" },
  { name: "Medical Xpress Psychiatrie", url: "https://medicalxpress.com/rss-feed/psychology-psychiatry-news/" },
  { name: "Deutsches Ärzteblatt", url: "https://www.aerzteblatt.de/rss/news.asp", psychOnly: true },
  { name: "FDA Pressemitteilungen", url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml", psychOnly: true },
  // The DGPPN has no RSS feed, so its press release list page is read as HTML.
  {
    name: "DGPPN",
    html: true,
    urls: (y) => [y, y - 1].map((n) => `https://www.dgppn.de/presse/pressemitteilungen/pressemitteilungen-${n}.html`),
    linkPattern: /\/presse\/pressemitteilungen\/pressemitteilungen-\d{4}\/[^/]+\.html$/,
  },
];

// Same topic keywords as the Android app (app/src/main/java/de/psycup/app/data/Topics.kt).
const TOPICS = {
  depression: ["depress", "antidepress", "esketamin", "ketamin", "major depressive", "dysthym"],
  bipolar: ["bipolar", "manie", "manic", "mania", "lithium"],
  schizophrenie: ["schizophren", "psychos", "psychot", "antipsychot", "neurolept", "clozapin", "olanzapin"],
  angst: ["anxiety", "angst", "panic", "panik", "phobi"],
  zwang: ["obsessive", "ocd", "zwangsstör"],
  ptbs: ["ptsd", "ptbs", "trauma", "posttraum"],
  adhs: ["adhd", "adhs", "methylphenid", "stimulant", "attention-deficit"],
  autismus: ["autis"],
  sucht: ["alcohol", "alkohol", "addict", "sucht", "opioid", "cannabis", "substance use", "nikotin", "smoking", "rauchen", "gambling"],
  demenz: ["dementia", "demenz", "alzheimer", "cognitive decline", "cognitive impairment"],
  essstoerung: ["anorex", "bulimi", "eating disorder", "essstör", "binge"],
  persoenlichkeit: ["borderline", "personality disorder", "persönlichkeitsstör"],
  schlaf: ["insomn", "sleep", "schlaf"],
  suizid: ["suicid", "suizid", "self-harm", "selbstverletz"],
  delir: ["delir"],
  allgemein: ["psychiatr", "mental health", "mental illness", "psychisch", "psychother", "psycholog", "mental disorder"],
};
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERNS = Object.entries(TOPICS).map(([k, kws]) => [k, kws.map((w) => new RegExp("(?<![\\p{L}])" + escape(w), "iu"))]);
const detectTopics = (text) => PATTERNS.filter(([, rs]) => rs.some((r) => r.test(text))).map(([k]) => k);

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text", cdataPropName: false });

const text = (v) => {
  if (v == null) return "";
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") return String(v["#text"] ?? "");
  return String(v);
};
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const clean = (s) =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) =>
      e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
const linkOf = (l) => {
  const list = Array.isArray(l) ? l : [l];
  for (const x of list) {
    if (x && typeof x === "object" && x["@href"] && (!x["@rel"] || x["@rel"] === "alternate")) return x["@href"];
  }
  const first = list[0];
  return typeof first === "object" ? first?.["@href"] ?? text(first) : text(first);
};
const toTime = (s) => {
  const t = Date.parse(String(s || "").replace(/\s+(EDT|EST|CDT|CST|PDT|PST)$/, (m, z) => ({ EDT: " -0400", EST: " -0500", CDT: " -0500", CST: " -0600", PDT: " -0700", PST: " -0800" })[z]));
  return Number.isFinite(t) ? t : null;
};

export function parseFeed(xml, feed, now = Date.now()) {
  const doc = parser.parse(xml);
  const raw = doc?.rss?.channel?.item ?? doc?.["rdf:RDF"]?.item ?? doc?.feed?.entry ?? [];
  const entries = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const e of entries) {
    const title = clean(text(e.title));
    const url = (linkOf(e.link) || text(e.guid) || text(e.id)).trim();
    if (!title || !/^https?:\/\//.test(url)) continue;
    let summary = clean(text(e.description ?? e.summary ?? e["content:encoded"] ?? e.content));
    if (summary.length > 320) summary = summary.slice(0, 317).trimEnd() + "…";
    const topics = detectTopics(`${title} ${summary}`);
    if (feed.psychOnly && topics.length === 0) continue;
    const date = toTime(text(e.pubDate ?? e["dc:date"] ?? e.published ?? e.updated ?? e["prism:publicationDate"])) ?? now;
    out.push({ title, summary, url, source: feed.name, date, topics });
  }
  return out;
}

const GENERIC_LINK = /^(weiterlesen|mehr|mehr lesen|mehr erfahren|zur pressemitteilung|lesen|details?)[ .…»>]*$/i;
const DATE = /(\d{2})\.(\d{2})\.(\d{4})/g;

// Reads a list page of press releases: every link matching feed.linkPattern is one item.
// Works whether the link wraps only the title or the whole teaser (date, heading, text).
export function parseHtmlList(html, feed, pageUrl, now = Date.now()) {
  const groups = new Map();
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;
    try {
      url = new URL(m[1].replace(/&amp;/g, "&"), pageUrl);
    } catch {
      continue;
    }
    url.hash = "";
    if (!feed.linkPattern.test(url.pathname)) continue;
    const end = m.index + m[0].length;
    const g = groups.get(url.href);
    if (g) {
      g.end = end;
      continue;
    }
    const inner = m[2];
    const heading = inner.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i);
    groups.set(url.href, {
      url: url.href,
      start: m.index,
      firstEnd: end,
      end,
      title: clean(heading ? heading[1] : inner),
      innerText: clean(inner),
      innerRest: heading ? clean(inner.slice(heading.index + heading[0].length)) : "",
    });
  }
  const list = [...groups.values()].sort((a, b) => a.start - b.start);
  const out = [];
  list.forEach((g, i) => {
    const before = clean(html.slice(i ? list[i - 1].end : 0, g.start));
    const after = clean(html.slice(g.firstEnd, i + 1 < list.length ? list[i + 1].start : html.length));
    const lastOf = (t) => [...t.matchAll(DATE)].pop();
    const d = [...g.innerText.matchAll(DATE)][0] ?? lastOf(before) ?? [...after.matchAll(DATE)][0];
    const title = GENERIC_LINK.test(g.title) ? "" : g.title.replace(DATE, "").replace(/^[\s|·–-]+/, "").trim();
    if (title.length < 8) return;
    let summary = `${g.innerRest} ${after}`
      .replace(DATE, "")
      .replace(/\b(weiterlesen|mehr lesen|zur pressemitteilung)\b/gi, "")
      .replace(/(gemeinsame\s+)?(pressemitteilung|stellungnahme|pressestatement)\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (summary.length > 320) summary = summary.slice(0, 317).trimEnd() + "…";
    const topics = detectTopics(`${title} ${summary}`);
    out.push({
      title,
      summary,
      url: g.url,
      source: feed.name,
      date: d ? Date.UTC(+d[3], +d[2] - 1, +d[1], 8) : now,
      topics: topics.length ? topics : ["allgemein"],
    });
  });
  return out;
}

async function fetchHtmlFeed(feed) {
  let lastError;
  for (const url of feed.urls(new Date().getUTCFullYear())) {
    try {
      const res = await get(url);
      const items = parseHtmlList(await res.text(), feed, url);
      if (items.length) return items;
      lastError = new Error("keine Einträge gefunden");
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

async function get(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 PsycUp/1.0 (+https://github.com/oldkaradal/PsychUp-Web)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(25000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

async function fetchFeed(feed) {
  if (feed.html) return fetchHtmlFeed(feed);
  return parseFeed(await (await get(feed.url)).text(), feed);
}

async function main() {
  const outFile = new URL("../web/data/news.json", import.meta.url);
  let previous = [];
  try {
    previous = JSON.parse(await readFile(outFile, "utf8")).items ?? [];
  } catch {}

  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const failed = [];
  const fresh = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") fresh.push(...r.value);
    else {
      failed.push(FEEDS[i].name);
      console.warn(`${FEEDS[i].name}: ${r.reason?.message ?? r.reason}`);
    }
  });
  // Keep older items from feeds that failed this time, so a bad run never empties the list.
  const kept = previous.filter((n) => failed.includes(n.source));
  const seen = new Set();
  const items = [...fresh, ...kept]
    .filter((n) => (seen.has(n.url) ? false : seen.add(n.url)))
    .sort((a, b) => b.date - a.date)
    .slice(0, 400);

  await writeFile(outFile, JSON.stringify({ updated: Date.now(), failed, items }));
  console.log(`${items.length} items, ${fresh.length} fresh, failed: ${failed.join(", ") || "none"}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) await main();
