import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT_DIR = resolve(process.cwd(), 'src/demo/data/open');
mkdirSync(OUT_DIR, { recursive: true });

export interface ArxivPaperRecord {
  readonly id: string;
  readonly arxivId: string;
  readonly title: string;
  readonly primaryAuthor: string;
  readonly publishedYear: number;
  readonly categories: readonly string[];
}

export interface GithubRepoRecord {
  readonly id: string;
  readonly fullName: string;
  readonly name: string;
  readonly description: string;
  readonly stars: number;
  readonly language: string;
  readonly topics: readonly string[];
  readonly url: string;
}

export interface VegaMovieRecord {
  readonly id: string;
  readonly title: string;
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
}

export interface UciVowelRecord {
  readonly id: string;
  readonly title: string;
  readonly speakerName: string;
  readonly speakerSex: 'Female' | 'Male';
  readonly vowelCode: string;
  readonly ipaSymbol: string;
  readonly exampleWord: string;
  readonly lpcVector: readonly number[];
  readonly envelopeBars: readonly number[];
}

export interface UciZooRecord {
  readonly id: string;
  readonly speciesName: string;
  readonly title: string;
  readonly taxonomicGroup: string;
  readonly legs: number;
  readonly aquatic: boolean;
  readonly airborne: boolean;
  readonly predator: boolean;
  readonly traits: readonly number[];
}

export interface PalmerPenguinRecord {
  readonly id: string;
  readonly title: string;
  readonly species: 'Adelie' | 'Chinstrap' | 'Gentoo';
  readonly island: 'Torgersen' | 'Biscoe' | 'Dream';
  readonly sex: 'FEMALE' | 'MALE';
  readonly billLengthMm: number;
  readonly billDepthMm: number;
  readonly flipperLengthMm: number;
  readonly bodyMassG: number;
  readonly morphVector: readonly number[];
}

const ALLOWED_ARXIV_CATS = new Set([
  'cs.CG',
  'cs.GR',
  'cs.HC',
  'cs.LG',
  'cs.CV',
  'cs.DS',
  'cs.PL',
  'cs.DC',
  'cs.AI',
  'cs.IR',
  'stat.ML',
  'math.MG',
  'math.OC',
]);

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchArxivPapers(): Promise<ArxivPaperRecord[]> {
  const queries = [
    'cat:cs.CG+AND+(cat:cs.GR+OR+cat:cs.DS+OR+cat:math.MG)',
    'cat:cs.GR+AND+(cat:cs.HC+OR+cat:cs.CV+OR+cat:cs.LG)',
    'cat:cs.HC+AND+(cat:cs.LG+OR+cat:cs.AI+OR+cat:cs.IR)',
    'cat:cs.PL+AND+(cat:cs.DC+OR+cat:cs.LG+OR+cat:cs.DS)',
    'cat:cs.LG+AND+cat:stat.ML+AND+(cat:cs.DS+OR+cat:math.OC)',
  ];

  const seen = new Map<string, ArxivPaperRecord>();

  for (const q of queries) {
    const url = `https://export.arxiv.org/api/query?search_query=${q}&sortBy=submittedDate&sortOrder=descending&max_results=30`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SimplexViz-OpenDataset-Fetcher/1.0' },
    });
    if (!res.ok) throw new Error(`arXiv fetch failed: ${res.status}`);
    const xml = await res.text();
    const entryBlocks = xml.split('<entry>').slice(1);

    for (const block of entryBlocks) {
      const idMatch = block.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+)<\/id>/);
      const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
      const authorMatch = block.match(/<author>\s*<name>([\s\S]*?)<\/name>/);
      const pubMatch = block.match(/<published>(\d{4})-/);
      const catMatches = [...block.matchAll(/<category[^>]*term="([^"]+)"/g)];

      if (!idMatch || !titleMatch || !authorMatch || !pubMatch) continue;
      const rawArxivId = idMatch[1]!.replace(/v\d+$/, '');
      if (seen.has(rawArxivId)) continue;

      const cats = Array.from(
        new Set(
          catMatches
            .map((m) => m[1]!)
            .filter((c) => ALLOWED_ARXIV_CATS.has(c)),
        ),
      ).slice(0, 4);

      if (cats.length < 2) continue;

      const cleanTitle = decodeXmlEntities(titleMatch[1]!).replace(/\$.*?\$/g, '').replace(/\s+/g, ' ').trim();
      if (cleanTitle.length < 12) continue;

      seen.set(rawArxivId, {
        id: `arxiv-${rawArxivId.replace(/[^a-zA-Z0-9.-]/g, '-')}`,
        arxivId: rawArxivId,
        title: cleanTitle,
        primaryAuthor: decodeXmlEntities(authorMatch[1]!),
        publishedYear: Number.parseInt(pubMatch[1]!, 10),
        categories: cats,
      });

      if (seen.size >= 76) break;
    }
    if (seen.size >= 76) break;
  }

  return [...seen.values()];
}

const ALLOWED_GH_TOPICS = new Set([
  'visualization',
  'data-visualization',
  'svg',
  'webgl',
  'canvas',
  'd3',
  'charts',
  'graph',
  'geometry',
  'threejs',
  'typescript',
  'javascript',
  'react',
  'rust',
  'wasm',
  'animation',
  'color',
  'machine-learning',
  'clustering',
  'diagrams',
  'network-analysis',
  'plotting',
  'dataviz',
]);

async function fetchGithubVisRepos(): Promise<GithubRepoRecord[]> {
  const queries = [
    'topic:data-visualization+stars:>800',
    'topic:webgl+topic:visualization+stars:>300',
    'topic:graph+topic:visualization+stars:>400',
  ];

  const seen = new Map<string, GithubRepoRecord>();

  for (const q of queries) {
    const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=45`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'SimplexViz-OpenDataset-Fetcher/1.0',
        Accept: 'application/vnd.github+json',
      },
    });
    if (!res.ok) throw new Error(`GitHub fetch failed: ${res.status}`);
    const data = (await res.json()) as {
      items?: Array<{
        full_name: string;
        name: string;
        description: string | null;
        stargazers_count: number;
        language: string | null;
        topics?: string[];
        html_url: string;
      }>;
    };

    for (const repo of data.items ?? []) {
      if (seen.has(repo.full_name)) continue;
      const rawTopics = (repo.topics ?? []).map((t) => t.toLowerCase());
      const filtered = rawTopics.filter((t) => ALLOWED_GH_TOPICS.has(t));
      const langTag = repo.language ? repo.language.toLowerCase() : null;
      if (langTag && ALLOWED_GH_TOPICS.has(langTag) && !filtered.includes(langTag)) {
        filtered.push(langTag);
      }
      const dedup = Array.from(new Set(filtered)).slice(0, 4);
      if (dedup.length < 2) continue;

      seen.set(repo.full_name, {
        id: `gh-${repo.full_name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`,
        fullName: repo.full_name,
        name: repo.name,
        description: (repo.description ?? 'Open-source visualization library').slice(0, 140),
        stars: repo.stargazers_count,
        language: repo.language ?? 'TypeScript',
        topics: dedup,
        url: repo.html_url,
      });

      if (seen.size >= 68) break;
    }
    if (seen.size >= 68) break;
  }

  return [...seen.values()];
}

function clamp01(v: number): number {
  return Number(Math.max(0.01, Math.min(0.99, v)).toFixed(4));
}

async function fetchVegaMovies(): Promise<VegaMovieRecord[]> {
  const res = await fetch(
    'https://raw.githubusercontent.com/vega/vega-datasets/main/data/movies.json',
  );
  if (!res.ok) throw new Error(`Vega movies fetch failed: ${res.status}`);
  const raw = (await res.json()) as Array<Record<string, unknown>>;

  const valid = raw.filter((m) => {
    return (
      typeof m['Title'] === 'string' &&
      typeof m['IMDB Rating'] === 'number' &&
      typeof m['Rotten Tomatoes Rating'] === 'number' &&
      typeof m['IMDB Votes'] === 'number' &&
      (m['IMDB Votes'] as number) > 35000 &&
      typeof m['Production Budget'] === 'number' &&
      (m['Production Budget'] as number) > 1_000_000 &&
      typeof m['Worldwide Gross'] === 'number' &&
      (m['Worldwide Gross'] as number) > 1_000_000 &&
      typeof m['Running Time min'] === 'number' &&
      typeof m['Major Genre'] === 'string' &&
      typeof m['Release Date'] === 'string'
    );
  });

  // Sort by votes descending and take a diverse 72-film subset across genres
  valid.sort((a, b) => (b['IMDB Votes'] as number) - (a['IMDB Votes'] as number));
  const picked: Array<Record<string, unknown>> = [];
  const genreCounts = new Map<string, number>();
  const seenTitles = new Set<string>();

  for (const m of valid) {
    const title = String(m['Title']).trim();
    if (seenTitles.has(title)) continue;
    const genre = String(m['Major Genre']);
    const c = genreCounts.get(genre) ?? 0;
    if (c >= 10) continue;
    genreCounts.set(genre, c + 1);
    seenTitles.add(title);
    picked.push(m);
    if (picked.length >= 72) break;
  }

  return picked.map((m, idx) => {
    const title = String(m['Title']).trim();
    const yearMatch = String(m['Release Date']).match(/(\d{4})/);
    const year = yearMatch ? Number.parseInt(yearMatch[1]!, 10) : 2000;
    const imdb = Number(m['IMDB Rating']);
    const rt = Number(m['Rotten Tomatoes Rating']);
    const votes = Number(m['IMDB Votes']);
    const budget = Number(m['Production Budget']) / 1_000_000;
    const gross = Number(m['Worldwide Gross']) / 1_000_000;
    const runtime = Number(m['Running Time min']);
    const roi = Math.min(12, gross / Math.max(1, budget));

    // 4D Reception & Critical Vector: [imdbNorm, rtNorm, popularityLog, criticConsensusBalance]
    const imdbNorm = clamp01((imdb - 4.5) / 4.8);
    const rtNorm = clamp01(rt / 100);
    const votesNorm = clamp01((Math.log10(votes) - 4.5) / 1.8);
    const criticDelta = clamp01(0.5 + (rt / 100 - imdbNorm) * 0.9);

    // 4D Production & Scale Vector: [budgetLog, grossLog, runtimeNorm, roiNorm]
    const budgetNorm = clamp01((Math.log10(budget) - 0.2) / 2.3);
    const grossNorm = clamp01((Math.log10(gross) - 0.8) / 2.5);
    const runtimeNorm = clamp01((runtime - 78) / 115);
    const roiNorm = clamp01(roi / 10);

    return {
      id: `film-${idx + 1}`,
      title,
      releaseYear: year,
      genre: String(m['Major Genre']),
      mpaa: typeof m['MPAA Rating'] === 'string' ? m['MPAA Rating'] : 'NR',
      runtimeMin: runtime,
      imdbRating: imdb,
      rottenTomatoes: rt,
      budgetMusd: Number(budget.toFixed(1)),
      worldwideGrossMusd: Number(gross.toFixed(1)),
      receptionVector: [imdbNorm, rtNorm, votesNorm, criticDelta],
      productionVector: [budgetNorm, grossNorm, runtimeNorm, roiNorm],
    };
  });
}

const VOWEL_META: ReadonlyArray<{
  readonly code: string;
  readonly ipa: string;
  readonly word: string;
}> = [
  { code: 'i:', ipa: '/iː/', word: 'hid' },
  { code: 'I', ipa: '/ɪ/', word: 'hId' },
  { code: 'E', ipa: '/ɛ/', word: 'hEd' },
  { code: 'A', ipa: '/æ/', word: 'hAd' },
  { code: 'a:', ipa: '/ɑː/', word: 'hYd' },
  { code: 'Y', ipa: '/ʌ/', word: 'had' },
  { code: 'O', ipa: '/ɒ/', word: 'hOd' },
  { code: 'C:', ipa: '/ɔː/', word: 'hod' },
  { code: 'U', ipa: '/ʊ/', word: 'hUd' },
  { code: 'u:', ipa: '/uː/', word: 'hud' },
  { code: '3:', ipa: '/ɜː/', word: 'hed' },
];

const SPEAKER_NAMES = [
  'Andrew', 'Bill', 'David', 'Mark', 'Jo', 'Kate', ' Penny', 'Sarah',
  'Mike', 'Nick', 'Rich', 'Tim', ' Wendy', 'agi', 'lisa',
].map((s) => s.trim());

async function fetchUciVowels(): Promise<UciVowelRecord[]> {
  const res = await fetch(
    'https://archive.ics.uci.edu/ml/machine-learning-databases/undocumented/connectionist-bench/vowel/vowel-context.data',
  );
  if (!res.ok) throw new Error(`UCI vowel fetch failed: ${res.status}`);
  const text = await res.text();
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // Format: Train/Test(0), SpeakerNumber(1: 0..14), Sex(2: 0=Male,1=Female? In Deterding: speakers 0-3 M, 4-7 F, 8-11 M, 12-14 F), f0..f9 (cols 3..12), Class (col 13: 0..10)
  // Take frame 0 (first occurrence) for 6 diverse speakers (3 Male, 3 Female) × 11 vowels = 66 real recordings
  const targetSpeakers = new Set([0, 2, 4, 5, 8, 12]);
  const picked = new Map<string, { spk: number; sex: number; feats: number[]; cls: number }>();

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 14) continue;
    const spk = Number.parseInt(parts[1]!, 10);
    const sexFlag = Number.parseInt(parts[2]!, 10);
    const cls = Number.parseInt(parts[13]!, 10);
    if (!targetSpeakers.has(spk) || Number.isNaN(cls) || cls < 0 || cls > 10) continue;
    const key = `${spk}-${cls}`;
    if (picked.has(key)) continue;
    const feats = parts.slice(3, 13).map((x) => Number.parseFloat(x));
    if (feats.some((v) => Number.isNaN(v))) continue;
    picked.set(key, { spk, sex: sexFlag, feats, cls });
  }

  // Compute min/max per LPC feature for clean [0,1] normalization while preserving geometry
  const mins = Array<number>(10).fill(Infinity);
  const maxs = Array<number>(10).fill(-Infinity);
  for (const item of picked.values()) {
    item.feats.forEach((v, i) => {
      if (v < mins[i]!) mins[i] = v;
      if (v > maxs[i]!) maxs[i] = v;
    });
  }

  const out: UciVowelRecord[] = [];
  let idx = 1;
  for (const item of picked.values()) {
    const meta = VOWEL_META[item.cls]!;
    const spkName = SPEAKER_NAMES[item.spk] ?? `Speaker ${item.spk + 1}`;
    const speakerSex: 'Female' | 'Male' = item.sex === 1 ? 'Female' : 'Male';
    const normVec = item.feats.map((v, i) =>
      clamp01((v - mins[i]!) / Math.max(1e-6, maxs[i]! - mins[i]!)),
    );
    const bars = normVec.map((v) => Number((0.18 + v * 0.8).toFixed(2)));

    out.push({
      id: `vowel-${idx++}`,
      title: `${meta.word} ${meta.ipa} (${spkName})`,
      speakerName: spkName,
      speakerSex,
      vowelCode: meta.code,
      ipaSymbol: meta.ipa,
      exampleWord: meta.word,
      lpcVector: normVec,
      envelopeBars: bars,
    });
  }

  return out;
}

const ZOO_CLASSES: Record<number, string> = {
  1: 'Mammal',
  2: 'Bird',
  3: 'Reptile',
  4: 'Fish',
  5: 'Amphibian',
  6: 'Bug / Insect',
  7: 'Invertebrate',
};

function capitalizeWords(s: string): string {
  return s.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

async function fetchUciZoo(): Promise<UciZooRecord[]> {
  const res = await fetch(
    'https://archive.ics.uci.edu/ml/machine-learning-databases/zoo/zoo.data',
  );
  if (!res.ok) throw new Error(`UCI Zoo fetch failed: ${res.status}`);
  const text = await res.text();
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return lines.map((line, idx) => {
    const cols = line.split(',');
    const rawName = cols[0]!;
    const rawNums = cols.slice(1, 17).map((v) => Number.parseInt(v, 10));
    const classId = Number.parseInt(cols[17]!, 10);
    // Normalize legs (index 12, values 0..8) into [0, 1] so all 16 biological traits lie in [0, 1]
    const traits = rawNums.map((val, i) =>
      i === 12 ? Number((val / 8).toFixed(3)) : val,
    );

    return {
      id: `zoo-${idx + 1}-${rawName}`,
      speciesName: rawName,
      title: capitalizeWords(rawName),
      taxonomicGroup: ZOO_CLASSES[classId] ?? 'Vertebrate',
      legs: rawNums[12] ?? 0,
      aquatic: rawNums[5] === 1,
      airborne: rawNums[4] === 1,
      predator: rawNums[6] === 1,
      traits,
    };
  });
}

async function fetchPalmerPenguins(): Promise<PalmerPenguinRecord[]> {
  const res = await fetch(
    'https://raw.githubusercontent.com/vega/vega-datasets/main/data/penguins.json',
  );
  if (!res.ok) throw new Error(`Palmer penguins fetch failed: ${res.status}`);
  const raw = (await res.json()) as Array<Record<string, unknown>>;

  const complete = raw.filter(
    (p) =>
      (p['Species'] === 'Adelie' || p['Species'] === 'Chinstrap' || p['Species'] === 'Gentoo') &&
      (p['Island'] === 'Torgersen' || p['Island'] === 'Biscoe' || p['Island'] === 'Dream') &&
      (p['Sex'] === 'FEMALE' || p['Sex'] === 'MALE') &&
      typeof p['Beak Length (mm)'] === 'number' &&
      typeof p['Beak Depth (mm)'] === 'number' &&
      typeof p['Flipper Length (mm)'] === 'number' &&
      typeof p['Body Mass (g)'] === 'number',
  );

  // Stratified sample of 84 real field specimens (up to 28 per species)
  const speciesCount = new Map<string, number>();
  const sampled: Array<Record<string, unknown>> = [];
  for (const p of complete) {
    const sp = String(p['Species']);
    const c = speciesCount.get(sp) ?? 0;
    if (c >= 28) continue;
    speciesCount.set(sp, c + 1);
    sampled.push(p);
    if (sampled.length >= 84) break;
  }

  return sampled.map((p, idx) => {
    const species = p['Species'] as PalmerPenguinRecord['species'];
    const island = p['Island'] as PalmerPenguinRecord['island'];
    const sex = p['Sex'] as PalmerPenguinRecord['sex'];
    const bl = Number(p['Beak Length (mm)']);
    const bd = Number(p['Beak Depth (mm)']);
    const fl = Number(p['Flipper Length (mm)']);
    const bm = Number(p['Body Mass (g)']);
    const ratio = bl / Math.max(1, bd);

    const morphVector = [
      clamp01((bl - 32) / 28),
      clamp01((bd - 13) / 9),
      clamp01((fl - 170) / 62),
      clamp01((bm - 2700) / 3600),
      clamp01((ratio - 1.8) / 1.8),
      sex === 'MALE' ? 0.78 : 0.22,
    ];

    return {
      id: `penguin-${idx + 1}`,
      title: `${species} #${idx + 1} (${island}, ${sex === 'FEMALE' ? 'F' : 'M'})`,
      species,
      island,
      sex,
      billLengthMm: bl,
      billDepthMm: bd,
      flipperLengthMm: fl,
      bodyMassG: bm,
      morphVector,
    };
  });
}

async function main() {
  console.log('Fetching real open datasets...');
  const [arxiv, githubRepos, movies, vowels, zoo, penguins] = await Promise.all([
    fetchArxivPapers(),
    fetchGithubVisRepos(),
    fetchVegaMovies(),
    fetchUciVowels(),
    fetchUciZoo(),
    fetchPalmerPenguins(),
  ]);

  writeFileSync(resolve(OUT_DIR, 'arxiv-papers.json'), JSON.stringify(arxiv, null, 2) + '\n');
  writeFileSync(resolve(OUT_DIR, 'github-vis-repos.json'), JSON.stringify(githubRepos, null, 2) + '\n');
  writeFileSync(resolve(OUT_DIR, 'vega-movies.json'), JSON.stringify(movies, null, 2) + '\n');
  writeFileSync(resolve(OUT_DIR, 'uci-vowels.json'), JSON.stringify(vowels, null, 2) + '\n');
  writeFileSync(resolve(OUT_DIR, 'uci-zoo.json'), JSON.stringify(zoo, null, 2) + '\n');
  writeFileSync(resolve(OUT_DIR, 'palmer-penguins.json'), JSON.stringify(penguins, null, 2) + '\n');

  console.log({
    arxiv: arxiv.length,
    githubRepos: githubRepos.length,
    movies: movies.length,
    vowels: vowels.length,
    zoo: zoo.length,
    penguins: penguins.length,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
