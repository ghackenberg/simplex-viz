import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const ROOT_DIR = process.cwd();
const OPEN_DATA_DIR = resolve(ROOT_DIR, 'src/demo/data/open');
const ASSETS_CINEMA_DIR = resolve(ROOT_DIR, 'src/assets/commons/cinema');
const ASSETS_ZOO_DIR = resolve(ROOT_DIR, 'src/assets/commons/zoo');
const OLD_CINEMA_DIR = resolve(ROOT_DIR, 'public/cinema');

const USER_AGENT =
  'SimplexVizOpenMediaHarvester/1.0 (https://hackenberg.tech; mailto:georg.hackenberg@fh-wels.at)';

export interface CommonsMediaCredit {
  readonly localPath: string;
  readonly commonsFileUrl: string;
  readonly wikipediaUrl: string;
  readonly fileTitle: string;
  readonly author: string;
  readonly licenseShort: string;
  readonly licenseUrl: string;
}

export interface VegaMovieWithCommons {
  readonly id: string;
  readonly title: string;
  readonly shortTitle: string;
  readonly releaseYear: number;
  readonly genre: string;
  readonly mpaa: string;
  readonly runtimeMin: number;
  readonly imdbRating: number;
  readonly rottenTomatoes: number;
  readonly budgetMusd: number;
  readonly worldwideGrossMusd: number;
  readonly receptionVector: readonly number[];
  readonly productionVector: readonly number[];
  readonly mediaCredit: CommonsMediaCredit;
}

export interface UciZooWithCommons {
  readonly id: string;
  readonly speciesName: string;
  readonly title: string;
  readonly taxonomicGroup: string;
  readonly legs: number;
  readonly aquatic: boolean;
  readonly airborne: boolean;
  readonly predator: boolean;
  readonly traits: readonly number[];
  readonly mediaCredit?: CommonsMediaCredit;
}

interface WikiPageQueryEntry {
  readonly pageid?: number;
  readonly title: string;
  readonly fullurl?: string;
  readonly pageimage?: string;
  readonly terms?: {
    readonly description?: readonly string[];
  };
}

interface CommonsImageInfo {
  readonly thumburl?: string;
  readonly url?: string;
  readonly descriptionurl?: string;
  readonly extmetadata?: Readonly<
    Record<
      string,
      | {
          readonly value?: string;
        }
      | undefined
    >
  >;
}

function stripHtml(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function clamp01(v: number): number {
  return Number(Math.max(0.01, Math.min(0.99, v)).toFixed(4));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJsonWithRetry<T>(url: string, retries = 3): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });
    if (res.ok) {
      return (await res.json()) as T;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(900 * (attempt + 1));
      continue;
    }
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  throw new Error(`Unreachable retry exhaustion for ${url}`);
}

async function downloadBinaryWithRetry(url: string, destFile: string, retries = 4): Promise<void> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
      },
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(destFile, buf);
      return;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(1200 * (attempt + 1));
      continue;
    }
    throw new Error(`Image download HTTP ${res.status} for ${url}`);
  }
}

function isPublicDomainLicense(shortName: string): boolean {
  const s = shortName.toLowerCase();
  return (
    s.includes('public domain') ||
    s.startsWith('pd') ||
    s.includes('cc0') ||
    s.includes('no restrictions')
  );
}

function isFreeCommonsLicense(shortName: string, nonFreeFlag: string): boolean {
  if (nonFreeFlag.toLowerCase() === 'true' || nonFreeFlag === '1') return false;
  if (isPublicDomainLicense(shortName)) return true;
  const s = shortName.toLowerCase();
  return s.startsWith('cc by') || s.startsWith('cc-by');
}

function normalizeLicenseUrl(shortName: string, rawUrl: string): string {
  if (rawUrl && rawUrl.startsWith('http')) return rawUrl;
  if (isPublicDomainLicense(shortName)) {
    return 'https://creativecommons.org/publicdomain/mark/1.0/';
  }
  return 'https://commons.wikimedia.org/wiki/Commons:Licensing';
}

function chunkArray<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function queryWikipediaPagesBatch(
  titles: readonly string[],
): Promise<Map<string, WikiPageQueryEntry>> {
  const map = new Map<string, WikiPageQueryEntry>();
  for (const batch of chunkArray(titles, 40)) {
    const joined = batch.map((t) => t.replace(/_/g, ' ')).join('|');
    const url =
      `https://en.wikipedia.org/w/api.php?action=query&redirects=1` +
      `&prop=pageimages|info|pageterms&piprop=name&inprop=url&wbptterms=description` +
      `&titles=${encodeURIComponent(joined)}&format=json`;
    const data = await fetchJsonWithRetry<{
      query?: {
        redirects?: ReadonlyArray<{ from: string; to: string }>;
        normalized?: ReadonlyArray<{ from: string; to: string }>;
        pages?: Record<string, WikiPageQueryEntry>;
      };
    }>(url);

    const pagesByTitle = new Map<string, WikiPageQueryEntry>();
    for (const p of Object.values(data.query?.pages ?? {})) {
      if (p.pageid && p.pageid > 0) {
        pagesByTitle.set(p.title, p);
      }
    }

    const normMap = new Map<string, string>();
    for (const n of data.query?.normalized ?? []) {
      normMap.set(n.from, n.to);
    }
    const redirMap = new Map<string, string>();
    for (const r of data.query?.redirects ?? []) {
      redirMap.set(r.from, r.to);
    }

    for (const orig of batch) {
      const spaced = orig.replace(/_/g, ' ');
      const step1 = normMap.get(spaced) ?? spaced;
      const step2 = redirMap.get(step1) ?? step1;
      const page = pagesByTitle.get(step2);
      if (page) {
        map.set(orig, page);
      }
    }
    await sleep(120);
  }
  return map;
}

async function queryCommonsFilesBatch(
  fileNames: readonly string[],
  thumbWidthPx: number,
): Promise<Map<string, CommonsImageInfo>> {
  const out = new Map<string, CommonsImageInfo>();
  const unique = Array.from(new Set(fileNames.filter((f) => f.length > 0)));

  for (const batch of chunkArray(unique, 35)) {
    const fileTitles = batch.map((f) => (f.startsWith('File:') ? f : `File:${f}`)).join('|');
    const url =
      `https://commons.wikimedia.org/w/api.php?action=query` +
      `&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=${thumbWidthPx}` +
      `&titles=${encodeURIComponent(fileTitles)}&format=json`;

    const data = await fetchJsonWithRetry<{
      query?: {
        normalized?: ReadonlyArray<{ from: string; to: string }>;
        pages?: Record<
          string,
          {
            missing?: string;
            title: string;
            imageinfo?: readonly CommonsImageInfo[];
          }
        >;
      };
    }>(url);

    const byCanonical = new Map<string, CommonsImageInfo>();
    for (const page of Object.values(data.query?.pages ?? {})) {
      if (page.missing !== undefined) continue;
      const info = page.imageinfo?.[0];
      if (info) {
        byCanonical.set(page.title, info);
      }
    }

    const normMap = new Map<string, string>();
    for (const n of data.query?.normalized ?? []) {
      normMap.set(n.from, n.to);
    }

    for (const rawName of batch) {
      const prefixed = rawName.startsWith('File:') ? rawName : `File:${rawName}`;
      const canonical = normMap.get(prefixed) ?? prefixed;
      const info = byCanonical.get(canonical);
      if (info) {
        out.set(rawName, info);
      }
    }
    await sleep(140);
  }
  return out;
}

const ZOO_WIKI_TITLES: Readonly<Record<string, string>> = {
  aardvark: 'Aardvark',
  antelope: 'Impala',
  bass: 'Largemouth_bass',
  bear: 'Brown_bear',
  boar: 'Wild_boar',
  buffalo: 'African_buffalo',
  calf: 'Holstein_Friesian',
  carp: 'Common_carp',
  catfish: 'Channel_catfish',
  cavy: 'Guinea_pig',
  cheetah: 'Cheetah',
  chicken: 'Chicken',
  chub: 'Squalius_cephalus',
  clam: 'Giant_clam',
  crab: 'Cancer_pagurus',
  crayfish: 'Crayfish',
  crow: 'Carrion_crow',
  deer: 'Red_deer',
  dogfish: 'Spiny_dogfish',
  dolphin: 'Common_bottlenose_dolphin',
  dove: 'Barbary_dove',
  duck: 'Mallard',
  elephant: 'African_bush_elephant',
  flamingo: 'Greater_flamingo',
  flea: 'Flea',
  frog: 'Common_frog',
  fruitbat: 'Pteropus',
  giraffe: 'Reticulated_giraffe',
  girl: 'Vitruvian_Man',
  gnat: 'Fungus_gnat',
  goat: 'Goat',
  gorilla: 'Western_gorilla',
  gull: 'European_herring_gull',
  haddock: 'Haddock',
  hamster: 'Golden_hamster',
  hare: 'European_hare',
  hawk: 'Red-tailed_hawk',
  herring: 'Atlantic_herring',
  honeybee: 'Western_honey_bee',
  housefly: 'Housefly',
  kiwi: 'Kiwi_(bird)',
  ladybird: 'Coccinella_septempunctata',
  lark: 'Eurasian_skylark',
  leopard: 'Leopard',
  lion: 'Lion',
  lobster: 'American_lobster',
  lynx: 'Eurasian_lynx',
  mink: 'American_mink',
  mole: 'European_mole',
  mongoose: 'Indian_grey_mongoose',
  moth: 'Atlas_moth',
  newt: 'Smooth_newt',
  octopus: 'Common_octopus',
  opossum: 'Virginia_opossum',
  oryx: 'Gemsbok',
  ostrich: 'Common_ostrich',
  parakeet: 'Rose-ringed_parakeet',
  penguin: 'Emperor_penguin',
  pheasant: 'Common_pheasant',
  pike: 'Northern_pike',
  piranha: 'Red-bellied_piranha',
  pitviper: 'Bothrops_asper',
  platypus: 'Platypus',
  polecat: 'European_polecat',
  pony: 'Shetland_pony',
  porpoise: 'Harbour_porpoise',
  puma: 'Cougar',
  pussycat: 'Cat',
  raccoon: 'Raccoon',
  reindeer: 'Reindeer',
  rhea: 'Greater_rhea',
  scorpion: 'Emperor_scorpion',
  seahorse: 'Short-snouted_seahorse',
  seal: 'Harbor_seal',
  sealion: 'California_sea_lion',
  seasnake: 'Yellow-bellied_sea_snake',
  seawasp: 'Chironex_fleckeri',
  skimmer: 'Black_skimmer',
  skua: 'Great_skua',
  slowworm: 'Slow_worm',
  slug: 'Red_slug',
  sole: 'Common_sole',
  sparrow: 'House_sparrow',
  squirrel: 'Eurasian_red_squirrel',
  starfish: 'Common_starfish',
  stingray: 'Southern_stingray',
  swan: 'Mute_swan',
  termite: 'Termite',
  toad: 'Common_toad',
  tortoise: 'Galapagos_tortoise',
  tuatara: 'Tuatara',
  tuna: 'Atlantic_bluefin_tuna',
  vampire: 'Common_vampire_bat',
  vole: 'Bank_vole',
  vulture: 'Griffon_vulture',
  wallaby: 'Red-necked_wallaby',
  wasp: 'Vespula_vulgaris',
  wolf: 'Wolf',
  worm: 'Lumbricus_terrestris',
  wren: 'Eurasian_wren',
};

function inferGenreFromDescription(rawGenre: unknown, wikiDesc: string): string {
  if (typeof rawGenre === 'string' && rawGenre.trim().length > 0) {
    return rawGenre.trim();
  }
  const d = wikiDesc.toLowerCase();
  if (d.includes('western')) return 'Western';
  if (d.includes('musical')) return 'Musical';
  if (d.includes('horror')) return 'Horror';
  if (d.includes('thriller') || d.includes('noir') || d.includes('mystery') || d.includes('suspense')) {
    return 'Thriller/Suspense';
  }
  if (d.includes('romantic comedy')) return 'Romantic Comedy';
  if (d.includes('comedy')) return 'Comedy';
  if (d.includes('adventure') || d.includes('swashbuckler') || d.includes('epic')) {
    return 'Adventure';
  }
  if (d.includes('action') || d.includes('war')) return 'Action';
  return 'Drama';
}

function makeShortFilmTitle(title: string): string {
  const cleaned = title.replace(/^The\s+/i, (m) => (title.length > 14 ? '' : m)).trim();
  if (cleaned.length <= 13) return cleaned;
  return `${cleaned.slice(0, 12).trim()}…`;
}

function cleanFileExtension(thumbUrl: string): string {
  const cleanUrl = thumbUrl.split('?')[0] ?? thumbUrl;
  const ext = extname(cleanUrl).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp') {
    return ext === '.jpeg' ? '.jpg' : ext;
  }
  return '.jpg';
}

async function harvestZooCommons(): Promise<UciZooWithCommons[]> {
  console.log('1/2 Harvesting Wikimedia Commons animal thumbnails for UCI Zoo...');
  mkdirSync(ASSETS_ZOO_DIR, { recursive: true });

  const existingZoo = JSON.parse(
    readFileSync(resolve(OPEN_DATA_DIR, 'uci-zoo.json'), 'utf8'),
  ) as UciZooWithCommons[];

  const uniqueSpecies = Array.from(new Set(existingZoo.map((z) => z.speciesName)));
  const wikiTitles = uniqueSpecies.map((sp) => ZOO_WIKI_TITLES[sp] ?? sp);

  const pageMap = await queryWikipediaPagesBatch(wikiTitles);
  const fileNames: string[] = [];
  for (const wt of wikiTitles) {
    const p = pageMap.get(wt);
    if (p?.pageimage) fileNames.push(p.pageimage);
  }

  const commonsMap = await queryCommonsFilesBatch(fileNames, 200);
  const creditBySpecies = new Map<string, CommonsMediaCredit>();

  for (const sp of uniqueSpecies) {
    const wt = ZOO_WIKI_TITLES[sp] ?? sp;
    const page = pageMap.get(wt);
    if (!page?.pageimage) continue;
    const info = commonsMap.get(page.pageimage);
    if (!info) continue;

    const thumbUrl = info.thumburl ?? info.url;
    if (!thumbUrl) continue;

    const extMeta = info.extmetadata ?? {};
    const licenseShort = stripHtml(extMeta.LicenseShortName?.value) || 'Public domain';
    const nonFree = stripHtml(extMeta.NonFree?.value);
    if (!isFreeCommonsLicense(licenseShort, nonFree)) continue;

    const authorRaw =
      stripHtml(extMeta.Artist?.value) ||
      stripHtml(extMeta.Credit?.value) ||
      'Wikimedia Commons contributor';
    const author = authorRaw.length > 72 ? `${authorRaw.slice(0, 70).trim()}…` : authorRaw;
    const licenseUrl = normalizeLicenseUrl(
      licenseShort,
      stripHtml(extMeta.LicenseUrl?.value),
    );

    const ext = cleanFileExtension(thumbUrl);
    const fileName = `${sp.replace(/[^a-z0-9_-]/gi, '_')}${ext}`;
    const localDiskPath = resolve(ASSETS_ZOO_DIR, fileName);
    if (!existsSync(localDiskPath)) {
      await downloadBinaryWithRetry(thumbUrl, localDiskPath);
      await sleep(95);
    }

    creditBySpecies.set(sp, {
      localPath: `/commons/zoo/${fileName}`,
      commonsFileUrl:
        info.descriptionurl ??
        `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(page.pageimage)}`,
      wikipediaUrl:
        page.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
      fileTitle: `File:${page.pageimage.replace(/_/g, ' ')}`,
      author,
      licenseShort,
      licenseUrl,
    });
  }

  console.log(`   -> Verified & downloaded ${creditBySpecies.size}/${uniqueSpecies.length} unique Zoo species photos.`);

  const enriched = existingZoo.map((z) => {
    const credit = creditBySpecies.get(z.speciesName);
    return credit ? { ...z, mediaCredit: credit } : z;
  });

  writeFileSync(
    resolve(OPEN_DATA_DIR, 'uci-zoo.json'),
    JSON.stringify(enriched, null, 2) + '\n',
  );
  return enriched;
}

async function harvestVegaCinemaCommons(): Promise<VegaMovieWithCommons[]> {
  console.log('2/2 Harvesting Public Domain Wikimedia Commons film posters for Vega Cinema...');
  rmSync(ASSETS_CINEMA_DIR, { recursive: true, force: true });
  mkdirSync(ASSETS_CINEMA_DIR, { recursive: true });

  const vegaRes = await fetchJsonWithRetry<Array<Record<string, unknown>>>(
    'https://raw.githubusercontent.com/vega/vega-datasets/main/data/movies.json',
  );

  interface RawCandidate {
    readonly raw: Record<string, unknown>;
    readonly title: string;
    readonly year: number;
    readonly votes: number;
    readonly wikiProbes: readonly string[];
  }

  const candidates: RawCandidate[] = [];
  const seenTitleYear = new Set<string>();

  for (const m of vegaRes) {
    if (
      typeof m['Title'] !== 'string' ||
      typeof m['IMDB Rating'] !== 'number' ||
      typeof m['IMDB Votes'] !== 'number' ||
      typeof m['Production Budget'] !== 'number' ||
      typeof m['Worldwide Gross'] !== 'number' ||
      typeof m['Release Date'] !== 'string'
    ) {
      continue;
    }
    const budget = Number(m['Production Budget']);
    const gross = Number(m['Worldwide Gross']);
    const votes = Number(m['IMDB Votes']);
    if (budget <= 50_000 || gross <= 50_000 || votes < 1500) continue;

    const yearMatch = String(m['Release Date']).match(/(19\d\d|20\d\d)/);
    if (!yearMatch) continue;
    const year = Number.parseInt(yearMatch[1]!, 10);
    // Focus on Golden-Age & classic cinema (<= 1976) where theatrical posters on Commons are Public Domain
    if (year < 1920 || year > 1976) continue;

    const title = String(m['Title']).trim();
    const dedupKey = `${title.toLowerCase()}|${year}`;
    if (seenTitleYear.has(dedupKey)) continue;
    seenTitleYear.add(dedupKey);

    candidates.push({
      raw: m,
      title,
      year,
      votes,
      wikiProbes: [
        `${title}_(${year}_film)`,
        `${title}_(${year + 1}_film)`,
        `${title}_(film)`,
        title.replace(/ /g, '_'),
      ],
    });
  }

  // Sort by audience prominence (IMDb votes descending)
  candidates.sort((a, b) => b.votes - a.votes);
  const topCandidates = candidates.slice(0, 230);

  const allProbes = Array.from(
    new Set(topCandidates.flatMap((c) => c.wikiProbes)),
  );
  const wikiPageMap = await queryWikipediaPagesBatch(allProbes);

  const matchedPages: Array<{
    readonly cand: RawCandidate;
    readonly page: WikiPageQueryEntry;
    readonly desc: string;
  }> = [];

  const usedPageIds = new Set<number>();
  for (const cand of topCandidates) {
    for (const probe of cand.wikiProbes) {
      const page = wikiPageMap.get(probe);
      if (!page?.pageimage || !page.pageid || usedPageIds.has(page.pageid)) continue;
      const desc = page.terms?.description?.[0] ?? '';
      // Strictly verify the Wikipedia entry describes a film!
      const looksLikeFilm =
        /\b(film|movie|motion picture|animated feature)\b/i.test(desc) ||
        /\(\d{4} film\)/i.test(page.title) ||
        /\(film\)/i.test(page.title);
      if (!looksLikeFilm) continue;

      // If description mentions a 4-digit year, verify it's within ±2 years of Vega's release date
      const descYearMatch = desc.match(/\b(19\d\d|20\d\d)\b/);
      if (descYearMatch) {
        const descYear = Number.parseInt(descYearMatch[1]!, 10);
        if (Math.abs(descYear - cand.year) > 2) continue;
      }

      usedPageIds.add(page.pageid);
      matchedPages.push({ cand, page, desc });
      break;
    }
  }

  const commonsMap = await queryCommonsFilesBatch(
    matchedPages.map((x) => x.page.pageimage!),
    240,
  );

  const verifiedFilms: VegaMovieWithCommons[] = [];
  for (const { cand, page, desc } of matchedPages) {
    if (verifiedFilms.length >= 64) break;
    const imgName = page.pageimage!;
    const info = commonsMap.get(imgName);
    if (!info) continue;

    const thumbUrl = info.thumburl ?? info.url;
    if (!thumbUrl) continue;

    const extMeta = info.extmetadata ?? {};
    const licenseShort = stripHtml(extMeta.LicenseShortName?.value) || '';
    const nonFree = stripHtml(extMeta.NonFree?.value);

    // Strictly require Public Domain / CC0 for Cinema theatrical posters & stills!
    if (!isPublicDomainLicense(licenseShort) || nonFree.toLowerCase() === 'true') {
      continue;
    }
    // Skip SVG or plain text logos so every node has a rich raster poster or film frame
    if (imgName.toLowerCase().endsWith('.svg') || /logo/i.test(imgName)) {
      continue;
    }

    const idx = verifiedFilms.length + 1;
    const ext = cleanFileExtension(thumbUrl);
    const slug = cand.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32);
    const fileName = `film-${idx}-${slug}${ext}`;
    const localDiskPath = resolve(ASSETS_CINEMA_DIR, fileName);

    if (!existsSync(localDiskPath)) {
      await downloadBinaryWithRetry(thumbUrl, localDiskPath);
      await sleep(95);
    }

    const m = cand.raw;
    const imdb = Number(m['IMDB Rating']);
    const rt =
      typeof m['Rotten Tomatoes Rating'] === 'number'
        ? Number(m['Rotten Tomatoes Rating'])
        : Math.min(99, Math.max(40, Math.round(imdb * 11)));
    const votes = Number(m['IMDB Votes']);
    const budget = Number(m['Production Budget']) / 1_000_000;
    const gross = Number(m['Worldwide Gross']) / 1_000_000;
    const runtime =
      typeof m['Running Time min'] === 'number' && Number(m['Running Time min']) > 45
        ? Number(m['Running Time min'])
        : 116;
    const roi = Math.min(18, gross / Math.max(0.25, budget));

    // 4D Reception & Critical Vector
    const imdbNorm = clamp01((imdb - 5.2) / 4.0);
    const rtNorm = clamp01(rt / 100);
    const votesNorm = clamp01((Math.log10(Math.max(100, votes)) - 3.0) / 2.8);
    const criticDelta = clamp01(0.5 + (rt / 100 - imdbNorm) * 0.9);

    // 4D Production & Commercial Scale Vector
    const budgetNorm = clamp01((Math.log10(Math.max(0.1, budget)) + 0.8) / 2.6);
    const grossNorm = clamp01((Math.log10(Math.max(0.2, gross)) + 0.4) / 2.9);
    const runtimeNorm = clamp01((runtime - 75) / 135);
    const roiNorm = clamp01(roi / 15);

    const authorRaw =
      stripHtml(extMeta.Artist?.value) ||
      stripHtml(extMeta.Credit?.value) ||
      'Original theatrical distributor (Public Domain)';
    const author = authorRaw.length > 72 ? `${authorRaw.slice(0, 70).trim()}…` : authorRaw;
    const licenseUrl = normalizeLicenseUrl(
      licenseShort,
      stripHtml(extMeta.LicenseUrl?.value),
    );

    verifiedFilms.push({
      id: `film-${idx}`,
      title: cand.title,
      shortTitle: makeShortFilmTitle(cand.title),
      releaseYear: cand.year,
      genre: inferGenreFromDescription(m['Major Genre'], desc),
      mpaa: typeof m['MPAA Rating'] === 'string' ? m['MPAA Rating'] : 'Approved',
      runtimeMin: runtime,
      imdbRating: imdb,
      rottenTomatoes: rt,
      budgetMusd: Number(budget.toFixed(2)),
      worldwideGrossMusd: Number(gross.toFixed(2)),
      receptionVector: [imdbNorm, rtNorm, votesNorm, criticDelta],
      productionVector: [budgetNorm, grossNorm, runtimeNorm, roiNorm],
      mediaCredit: {
        localPath: `/commons/cinema/${fileName}`,
        commonsFileUrl:
          info.descriptionurl ??
          `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(imgName)}`,
        wikipediaUrl:
          page.fullurl ??
          `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
        fileTitle: `File:${imgName.replace(/_/g, ' ')}`,
        author,
        licenseShort,
        licenseUrl,
      },
    });
  }

  console.log(`   -> Verified & downloaded ${verifiedFilms.length} Public Domain Vega Cinema posters.`);

  writeFileSync(
    resolve(OPEN_DATA_DIR, 'vega-movies.json'),
    JSON.stringify(verifiedFilms, null, 2) + '\n',
  );

  if (existsSync(OLD_CINEMA_DIR)) {
    rmSync(OLD_CINEMA_DIR, { recursive: true, force: true });
  }

  return verifiedFilms;
}

function writeThirdPartyNotices(
  films: readonly VegaMovieWithCommons[],
  zoo: readonly UciZooWithCommons[],
): void {
  const lines: string[] = [
    '# Third-Party Datasets & Media Notices',
    '',
    'The **SimplexViz** software libraries (`@simplex-viz/core`, `@simplex-viz/svg`, `@simplex-viz/react`) are licensed under the **MIT License**.',
    'Interactive example datasets and self-hosted source images in `/src/assets/commons/` and `/src/demo/data/open/` remain subject to their respective open-data and Wikimedia Commons licenses listed below.',
    'All source images in `/src/assets/commons/` are processed at build time via the Astro Asset Pipeline (`astro:assets` + Sharp) into compact WebP thumbnails without external tracking requests.',
    '',
    '## 1. Open Datasets (`/src/demo/data/open/`)',
    '',
    '- **arXiv.org Open-Access Metadata** (`arxiv-papers.json`): CC0 1.0 Public Domain Dedication — Cornell University arXiv e-Print Archive.',
    '- **GitHub Public Repository Metadata** (`github-vis-repos.json`): Public API metadata via GitHub REST Search API.',
    '- **Vega Datasets — Movies Catalog** (`vega-movies.json`): BSD-3-Clause License — University of Washington Interactive Data Lab (`vega/vega-datasets`).',
    '- **UCI ML Repository — Deterding Spoken Vowel Context** (`uci-vowels.json`): CC BY 4.0 — David Deterding, Mahesan Niranjan & Tony Robinson.',
    '- **UCI ML Repository — Zoo Animal Morphology** (`uci-zoo.json`): CC BY 4.0 — Richard S. Forsyth.',
    '- **Palmer Station Antarctica LTER — Penguins** (`palmer-penguins.json`): CC0 1.0 — Dr. Kristen Gorman & Palmer Station Antarctica LTER.',
    '',
    '## 2. Vega Cinema Thumbnails (`/src/assets/commons/cinema/` — Public Domain via Wikimedia Commons)',
    '',
    '| Film | Asset Key | Creator / Source | License | Commons Link |',
    '| :--- | :--- | :--- | :--- | :--- |',
  ];

  for (const f of films) {
    const c = f.mediaCredit;
    lines.push(
      `| ${f.title} (${f.releaseYear}) | \`${c.localPath}\` | ${c.author.replace(/\|/g, '/')} | [${c.licenseShort}](${c.licenseUrl}) | [Source](${c.commonsFileUrl}) |`,
    );
  }

  lines.push(
    '',
    '## 3. UCI Zoo Animal Thumbnails (`/src/assets/commons/zoo/` — Wikimedia Commons, resized WebP thumbnails)',
    '',
    '| Species | Asset Key | Creator / Attribution | License | Commons Link |',
    '| :--- | :--- | :--- | :--- | :--- |',
  );

  const seenPaths = new Set<string>();
  for (const z of zoo) {
    const c = z.mediaCredit;
    if (!c || seenPaths.has(c.localPath)) continue;
    seenPaths.add(c.localPath);
    lines.push(
      `| ${z.title} | \`${c.localPath}\` | ${c.author.replace(/\|/g, '/')} | [${c.licenseShort}](${c.licenseUrl}) | [Source](${c.commonsFileUrl}) |`,
    );
  }

  writeFileSync(resolve(ROOT_DIR, 'THIRD_PARTY_NOTICES.md'), lines.join('\n') + '\n');
  console.log('   -> Wrote THIRD_PARTY_NOTICES.md');
}

async function main() {
  const zoo = await harvestZooCommons();
  const films = await harvestVegaCinemaCommons();
  writeThirdPartyNotices(films, zoo);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
