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

async function fetchFeed(feed) {
  const res = await fetch(feed.url, {
    headers: { "User-Agent": "Mozilla/5.0 PsycUp/1.0 (+https://github.com/oldkaradal/PsychUp-Web)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(25000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text(), feed);
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
