/**
 * Zoological vector silhouettes for all 101 species in the UCI Zoo dataset.
 * Coordinates live in a centered [-10, 10] × [-10, 10] icon viewport so glyphs
 * scale cleanly inside circular/squircle simplex medallions at any zoom level.
 */
export type ZooSymbolKind =
  | 'feline'
  | 'canid'
  | 'ursid'
  | 'cervid'
  | 'giraffe'
  | 'bovid'
  | 'elephant'
  | 'primate'
  | 'rodent-lagomorph'
  | 'bat'
  | 'cetacean'
  | 'pinniped'
  | 'raptor'
  | 'waterfowl'
  | 'flightless-bird'
  | 'songbird'
  | 'fish'
  | 'ray'
  | 'seahorse'
  | 'snake'
  | 'tortoise'
  | 'amphibian'
  | 'cephalopod'
  | 'crustacean'
  | 'starfish-mollusc'
  | 'insect';

export interface ZooSvgPrimitive {
  readonly tag: 'path' | 'circle' | 'ellipse';
  readonly attrs: Readonly<Record<string, string | number>>;
  readonly cutout?: boolean;
}

const SPECIES_SYMBOL_MAP: Readonly<Record<string, ZooSymbolKind>> = {
  // Felines
  lion: 'feline',
  leopard: 'feline',
  cheetah: 'feline',
  lynx: 'feline',
  puma: 'feline',
  pussycat: 'feline',

  // Canids & slender carnivores
  wolf: 'canid',
  aardvark: 'canid',
  mink: 'canid',
  mongoose: 'canid',
  polecat: 'canid',
  raccoon: 'canid',
  opossum: 'canid',

  // Ursids & suids
  bear: 'ursid',
  boar: 'ursid',

  // Cervids & horned antelopes
  antelope: 'cervid',
  deer: 'cervid',
  oryx: 'cervid',
  reindeer: 'cervid',
  goat: 'cervid',

  // Giraffe
  giraffe: 'giraffe',

  // Bovids & equids
  buffalo: 'bovid',
  calf: 'bovid',
  pony: 'bovid',

  // Elephant
  elephant: 'elephant',

  // Primates / hominids
  gorilla: 'primate',
  girl: 'primate',

  // Small mammals, marsupials & monotremes
  hare: 'rodent-lagomorph',
  squirrel: 'rodent-lagomorph',
  hamster: 'rodent-lagomorph',
  cavy: 'rodent-lagomorph',
  mole: 'rodent-lagomorph',
  vole: 'rodent-lagomorph',
  wallaby: 'rodent-lagomorph',
  platypus: 'rodent-lagomorph',

  // Chiroptera (Bats)
  fruitbat: 'bat',
  vampire: 'bat',

  // Marine mammals
  dolphin: 'cetacean',
  porpoise: 'cetacean',
  seal: 'pinniped',
  sealion: 'pinniped',

  // Birds of prey
  hawk: 'raptor',
  vulture: 'raptor',

  // Waterfowl & seabirds
  swan: 'waterfowl',
  flamingo: 'waterfowl',
  duck: 'waterfowl',
  gull: 'waterfowl',
  skimmer: 'waterfowl',
  skua: 'waterfowl',

  // Flightless birds
  penguin: 'flightless-bird',
  ostrich: 'flightless-bird',
  rhea: 'flightless-bird',
  kiwi: 'flightless-bird',

  // Songbirds & landfowl
  chicken: 'songbird',
  crow: 'songbird',
  dove: 'songbird',
  lark: 'songbird',
  parakeet: 'songbird',
  pheasant: 'songbird',
  sparrow: 'songbird',
  wren: 'songbird',

  // Fish
  bass: 'fish',
  carp: 'fish',
  catfish: 'fish',
  chub: 'fish',
  dogfish: 'fish',
  haddock: 'fish',
  herring: 'fish',
  pike: 'fish',
  piranha: 'fish',
  sole: 'fish',
  tuna: 'fish',
  stingray: 'ray',
  seahorse: 'seahorse',

  // Reptiles
  pitviper: 'snake',
  seasnake: 'snake',
  slowworm: 'snake',
  tortoise: 'tortoise',
  tuatara: 'tortoise',

  // Amphibians
  frog: 'amphibian',
  toad: 'amphibian',
  newt: 'amphibian',

  // Invertebrates
  octopus: 'cephalopod',
  seawasp: 'cephalopod',
  crab: 'crustacean',
  crayfish: 'crustacean',
  lobster: 'crustacean',
  scorpion: 'crustacean',
  starfish: 'starfish-mollusc',
  clam: 'starfish-mollusc',
  slug: 'starfish-mollusc',
  worm: 'starfish-mollusc',

  // Insects
  flea: 'insect',
  gnat: 'insect',
  honeybee: 'insect',
  housefly: 'insect',
  ladybird: 'insect',
  moth: 'insect',
  termite: 'insect',
  wasp: 'insect',
};

export function resolveZooSymbolKind(
  speciesName: string,
  taxonomicGroup: string,
): ZooSymbolKind {
  const key = speciesName.trim().toLowerCase();
  const mapped = SPECIES_SYMBOL_MAP[key];
  if (mapped) return mapped;
  switch (taxonomicGroup) {
    case 'Mammal':
      return 'canid';
    case 'Bird':
      return 'songbird';
    case 'Fish':
      return 'fish';
    case 'Reptile':
      return 'tortoise';
    case 'Amphibian':
      return 'amphibian';
    case 'Bug / Insect':
      return 'insect';
    default:
      return 'starfish-mollusc';
  }
}

export const ZOO_SYMBOL_PRIMITIVES: Readonly<
  Record<ZooSymbolKind, readonly ZooSvgPrimitive[]>
> = {
  // Cat head silhouette with pointed ears + nose bridge
  feline: [
    {
      tag: 'path',
      attrs: {
        d: 'M -6.2 -7.2 L -3.1 -3.6 Q 0 -4.3 3.1 -3.6 L 6.2 -7.2 L 6.8 -1.2 Q 7.2 3.8 3.6 6.2 Q 0 7.8 -3.6 6.2 Q -7.2 3.8 -6.8 -1.2 Z',
      },
    },
    { tag: 'circle', attrs: { cx: -2.5, cy: -0.3, r: 1.05 }, cutout: true },
    { tag: 'circle', attrs: { cx: 2.5, cy: -0.3, r: 1.05 }, cutout: true },
    {
      tag: 'path',
      attrs: { d: 'M -1.3 2.6 L 1.3 2.6 L 0 4.2 Z' },
      cutout: true,
    },
  ],

  // Alert wolf / fox profile facing right
  canid: [
    {
      tag: 'path',
      attrs: {
        d: 'M -6.5 6.8 L -5.8 -1.2 L -4.2 -7.2 L -1.2 -3.2 L 1.2 -6.6 L 2.4 -2.2 L 7.6 0.4 L 7.2 2.4 L 3.2 3.2 L 1.8 6.8 Z',
      },
    },
    { tag: 'circle', attrs: { cx: 1.4, cy: -0.2, r: 0.95 }, cutout: true },
  ],

  // Rounded bear head with round ears + snout
  ursid: [
    { tag: 'circle', attrs: { cx: -4.8, cy: -4.8, r: 2.3 } },
    { tag: 'circle', attrs: { cx: 4.8, cy: -4.8, r: 2.3 } },
    { tag: 'circle', attrs: { cx: 0, cy: 0.6, r: 6.1 } },
    { tag: 'ellipse', attrs: { cx: 0, cy: 2.4, rx: 2.5, ry: 1.9 }, cutout: true },
    { tag: 'circle', attrs: { cx: -2.3, cy: -0.9, r: 0.85 }, cutout: true },
    { tag: 'circle', attrs: { cx: 2.3, cy: -0.9, r: 0.85 }, cutout: true },
  ],

  // Deer / antelope head with branching antlers
  cervid: [
    {
      tag: 'path',
      attrs: {
        d: 'M -3.4 6.8 L -2.6 1.6 L -5.6 -0.2 L -3.2 -1.8 L -6.2 -7.4 L -4.6 -7.6 L -2.6 -3.8 L -1.4 -6.4 L -0.2 -6.0 L -1.5 -2.6 Q 0 -3.0 1.5 -2.6 L 0.2 -6.0 L 1.4 -6.4 L 2.6 -3.8 L 4.6 -7.6 L 6.2 -7.4 L 3.2 -1.8 L 5.6 -0.2 L 2.6 1.6 L 3.4 6.8 Q 0 7.6 -3.4 6.8 Z',
      },
    },
    { tag: 'circle', attrs: { cx: -1.4, cy: 0.8, r: 0.75 }, cutout: true },
    { tag: 'circle', attrs: { cx: 1.4, cy: 0.8, r: 0.75 }, cutout: true },
  ],

  // Giraffe long neck + ossicones profile
  giraffe: [
    {
      tag: 'path',
      attrs: {
        d: 'M -4.8 7.5 L -1.6 -3.8 L -2.6 -7.4 L -1.3 -7.6 L -0.6 -4.8 L 0.8 -7.5 L 2.0 -7.2 L 1.1 -4.4 L 6.4 -2.8 L 5.9 -0.8 L 2.0 -0.6 L 0.8 7.5 Z',
      },
    },
    { tag: 'circle', attrs: { cx: 1.6, cy: -2.6, r: 0.75 }, cutout: true },
    { tag: 'circle', attrs: { cx: -1.1, cy: 3.4, r: 0.9 }, cutout: true },
  ],

  // Sturdy horned buffalo / ungulate head
  bovid: [
    {
      tag: 'path',
      attrs: {
        d: 'M -7.6 -3.6 Q -6.8 -7.2 -3.6 -4.6 L 3.6 -4.6 Q 6.8 -7.2 7.6 -3.6 Q 7.4 -0.4 4.4 -1.4 L 3.8 5.4 Q 0 7.2 -3.8 5.4 L -4.4 -1.4 Q -7.4 -0.4 -7.6 -3.6 Z',
      },
    },
    { tag: 'circle', attrs: { cx: -2.0, cy: 0.2, r: 0.85 }, cutout: true },
    { tag: 'circle', attrs: { cx: 2.0, cy: 0.2, r: 0.85 }, cutout: true },
  ],

  // Elephant head + large ears + curved trunk
  elephant: [
    {
      tag: 'path',
      attrs: {
        d: 'M -7.6 -2.4 Q -7.8 -6.4 -3.2 -5.8 Q 0 -6.8 3.2 -5.8 Q 7.8 -6.4 7.6 -2.4 Q 7.4 2.2 3.8 2.4 L 2.2 2.0 Q 2.0 6.8 4.6 6.6 L 4.6 8.0 Q 0.2 8.2 -0.8 3.2 L -1.8 2.0 L -3.8 2.4 Q -7.4 2.2 -7.6 -2.4 Z',
      },
    },
    { tag: 'circle', attrs: { cx: -2.0, cy: -1.8, r: 0.8 }, cutout: true },
    { tag: 'circle', attrs: { cx: 2.0, cy: -1.8, r: 0.8 }, cutout: true },
  ],

  // Primate / hominid head & shoulders
  primate: [
    { tag: 'circle', attrs: { cx: 0, cy: -2.4, r: 4.1 } },
    {
      tag: 'path',
      attrs: {
        d: 'M -6.8 7.2 Q -6.4 2.4 0 2.4 Q 6.4 2.4 6.8 7.2 Z',
      },
    },
    { tag: 'circle', attrs: { cx: -1.5, cy: -2.8, r: 0.75 }, cutout: true },
    { tag: 'circle', attrs: { cx: 1.5, cy: -2.8, r: 0.75 }, cutout: true },
  ],

  // Hare / small mammal with tall alert ears
  'rodent-lagomorph': [
    {
      tag: 'path',
      attrs: {
        d: 'M -3.2 -1.2 Q -4.4 -7.6 -2.0 -7.8 Q -0.4 -7.6 -0.8 -1.6 Q 0 -1.8 0.8 -1.6 Q 0.4 -7.6 2.0 -7.8 Q 4.4 -7.6 3.2 -1.2 Q 5.6 0.8 4.8 4.6 Q 3.8 7.2 0 7.2 Q -3.8 7.2 -4.8 4.6 Q -5.6 0.8 -3.2 -1.2 Z',
      },
    },
    { tag: 'circle', attrs: { cx: -1.7, cy: 2.2, r: 0.8 }, cutout: true },
    { tag: 'circle', attrs: { cx: 1.7, cy: 2.2, r: 0.8 }, cutout: true },
  ],

  // Spread scalloped bat wings
  bat: [
    {
      tag: 'path',
      attrs: {
        d: 'M 0 -2.6 L -1.4 -4.8 L -2.2 -2.6 L -8.2 -4.4 Q -7.8 1.2 -5.4 3.4 Q -4.0 1.4 -2.6 3.6 Q -1.2 1.8 0 4.6 Q 1.2 1.8 2.6 3.6 Q 4.0 1.4 5.4 3.4 Q 7.8 1.2 8.2 -4.4 L 2.2 -2.6 L 1.4 -4.8 Z',
      },
    },
  ],

  // Arched leaping dolphin silhouette
  cetacean: [
    {
      tag: 'path',
      attrs: {
        d: 'M -7.4 4.2 Q -5.2 -5.4 1.6 -4.6 L 2.8 -7.2 L 3.6 -4.0 Q 7.2 -2.2 7.8 1.2 L 5.2 1.2 Q 2.4 -1.4 -1.6 0.6 Q -4.2 2.0 -5.0 5.4 L -7.6 6.8 L -6.2 4.4 Z',
      },
    },
    { tag: 'circle', attrs: { cx: 4.8, cy: -0.8, r: 0.7 }, cutout: true },
  ],

  // Sleek curved seal silhouette
  pinniped: [
    {
      tag: 'path',
      attrs: {
        d: 'M -6.8 5.2 Q -7.6 2.8 -5.0 2.0 Q -2.2 1.4 -0.4 -2.8 Q 1.0 -6.4 4.2 -5.8 Q 6.8 -5.2 6.4 -2.8 Q 4.4 -1.8 3.6 1.6 L 6.6 4.4 L 3.2 5.2 Q -2.0 6.6 -6.8 5.2 Z',
      },
    },
    { tag: 'circle', attrs: { cx: 4.0, cy: -4.1, r: 0.7 }, cutout: true },
  ],

  // Soaring raptor / hawk silhouette
  raptor: [
    {
      tag: 'path',
      attrs: {
        d: 'M 0 -5.6 L 1.6 -3.2 L 8.2 -5.4 L 6.6 0.4 L 2.2 1.2 L 3.2 6.4 L 0 4.8 L -3.2 6.4 L -2.2 1.2 L -6.6 0.4 L -8.2 -5.4 L -1.6 -3.2 Z',
      },
    },
  ],

  // Graceful swimming swan / waterfowl silhouette
  waterfowl: [
    {
      tag: 'path',
      attrs: {
        d: 'M 2.4 -6.8 Q 5.2 -6.8 5.4 -4.2 L 7.4 -3.6 L 5.2 -2.6 Q 4.2 -2.4 3.4 -4.2 Q 2.2 -4.4 2.0 -1.2 Q 1.8 1.2 4.8 1.2 L -6.6 1.8 Q -6.8 6.2 0.6 6.2 Q 6.4 6.2 6.8 1.8 Z',
      },
    },
  ],

  // Upright penguin / flightless bird silhouette
  'flightless-bird': [
    {
      tag: 'path',
      attrs: {
        d: 'M -0.6 -7.2 Q 2.8 -7.2 3.2 -4.0 L 5.6 -3.2 L 3.2 -2.2 Q 4.8 1.6 3.6 6.8 L -3.2 6.8 Q -5.2 2.2 -3.4 -2.6 Q -3.4 -7.2 -0.6 -7.2 Z',
      },
    },
    {
      tag: 'ellipse',
      attrs: { cx: 0.5, cy: 1.8, rx: 1.7, ry: 3.4 },
      cutout: true,
    },
  ],

  // Perched songbird profile with tail & beak
  songbird: [
    {
      tag: 'path',
      attrs: {
        d: 'M -7.6 5.2 L -3.2 1.8 Q -3.6 -3.4 0.8 -4.8 Q 4.2 -5.8 5.2 -2.8 L 7.8 -2.0 L 5.4 -0.8 Q 5.2 3.8 0.4 4.6 L -5.4 6.6 Z',
      },
    },
    { tag: 'circle', attrs: { cx: 3.2, cy: -2.6, r: 0.75 }, cutout: true },
  ],

  // Streamlined fish with dorsal fin & forked tail
  fish: [
    {
      tag: 'path',
      attrs: {
        d: 'M -7.8 -4.2 L -4.2 0 L -7.8 4.2 L -4.6 1.6 Q -0.8 5.4 4.4 3.2 Q 7.8 1.6 8.0 0 Q 7.8 -1.6 4.4 -3.2 L 1.2 -6.0 L -0.8 -3.4 Q -3.0 -2.8 -4.6 -1.6 Z',
      },
    },
    { tag: 'circle', attrs: { cx: 4.8, cy: -0.6, r: 0.85 }, cutout: true },
  ],

  // Diamond stingray / manta silhouette with tail
  ray: [
    {
      tag: 'path',
      attrs: {
        d: 'M 0 -7.4 L 7.8 -0.8 L 1.6 2.8 L 0.6 8.0 L -0.6 8.0 L -1.6 2.8 L -7.8 -0.8 Z',
      },
    },
    { tag: 'circle', attrs: { cx: -1.8, cy: -2.6, r: 0.7 }, cutout: true },
    { tag: 'circle', attrs: { cx: 1.8, cy: -2.6, r: 0.7 }, cutout: true },
  ],

  // Curled seahorse profile
  seahorse: [
    {
      tag: 'path',
      attrs: {
        d: 'M -1.2 -7.4 Q 2.6 -7.4 3.0 -4.8 L 6.2 -4.2 L 3.0 -3.0 Q 4.2 -0.2 1.8 2.8 Q -0.8 5.6 1.6 6.6 Q 3.0 6.8 2.6 5.2 L 4.2 5.4 Q 4.6 8.2 0.8 8.0 Q -3.2 7.6 -2.2 3.0 Q -0.4 -0.4 -2.2 -3.6 Q -3.2 -7.0 -1.2 -7.4 Z',
      },
    },
    { tag: 'circle', attrs: { cx: 1.2, cy: -5.2, r: 0.65 }, cutout: true },
  ],

  // S-coiled serpent silhouette
  snake: [
    {
      tag: 'path',
      attrs: {
        d: 'M 4.6 -6.8 Q 7.4 -6.4 6.2 -3.8 Q 4.4 -2.2 -1.8 -2.2 Q -6.8 -2.2 -6.4 1.2 Q -6.0 4.2 1.8 4.2 Q 6.8 4.2 6.4 7.2 L -4.6 7.2 L -4.6 5.4 L 2.8 5.4 Q 3.8 5.4 2.4 5.4 Q -4.2 5.2 -4.2 1.2 Q -4.2 -0.4 1.8 -0.4 Q 5.8 -0.4 4.6 -4.6 L 1.6 -5.2 Z',
      },
    },
  ],

  // Domed shell tortoise silhouette
  tortoise: [
    {
      tag: 'path',
      attrs: {
        d: 'M -5.8 2.2 Q -5.6 -5.4 0.2 -5.4 Q 5.6 -5.4 5.8 2.2 L 8.2 0.4 Q 8.8 2.2 6.2 3.4 L 4.8 3.4 L 5.2 6.2 L 2.8 6.2 L 2.4 3.6 L -2.4 3.6 L -2.8 6.2 L -5.2 6.2 L -4.8 3.4 L -7.4 3.0 Z',
      },
    },
    {
      tag: 'path',
      attrs: { d: 'M -3.0 -1.2 L 0.2 -3.4 L 3.2 -1.2 L 2.2 1.6 L -2.2 1.6 Z' },
      cutout: true,
    },
  ],

  // Dorsal frog silhouette with splayed hind/fore legs
  amphibian: [
    {
      tag: 'path',
      attrs: {
        d: 'M 0 -6.4 Q 3.8 -5.8 4.2 -2.2 L 7.6 -4.2 L 6.6 -1.4 L 4.4 0.2 Q 4.8 3.2 2.8 4.6 L 6.8 6.8 L 3.8 7.4 L 1.2 5.2 L -1.2 5.2 L -3.8 7.4 L -6.8 6.8 L -2.8 4.6 Q -4.8 3.2 -4.4 0.2 L -6.6 -1.4 L -7.6 -4.2 L -4.2 -2.2 Q -3.8 -5.8 0 -6.4 Z',
      },
    },
    { tag: 'circle', attrs: { cx: -2.0, cy: -4.0, r: 0.85 }, cutout: true },
    { tag: 'circle', attrs: { cx: 2.0, cy: -4.0, r: 0.85 }, cutout: true },
  ],

  // Domed octopus mantle with splayed tentacles
  cephalopod: [
    {
      tag: 'path',
      attrs: {
        d: 'M 0 -7.2 Q 5.2 -7.2 5.0 -1.6 Q 4.8 0.8 3.6 1.6 L 7.4 4.8 L 5.8 6.2 L 2.4 3.0 L 3.2 7.4 L 1.2 7.6 L 0.4 3.4 L -0.4 3.4 L -1.2 7.6 L -3.2 7.4 L -2.4 3.0 L -5.8 6.2 L -7.4 4.8 L -3.6 1.6 Q -4.8 0.8 -5.0 -1.6 Q -5.2 -7.2 0 -7.2 Z',
      },
    },
    { tag: 'circle', attrs: { cx: -1.8, cy: -2.2, r: 0.8 }, cutout: true },
    { tag: 'circle', attrs: { cx: 1.8, cy: -2.2, r: 0.8 }, cutout: true },
  ],

  // Crustacean carapace with raised claws
  crustacean: [
    {
      tag: 'path',
      attrs: {
        d: 'M -4.2 -2.2 L -7.2 -5.2 Q -6.8 -7.8 -4.0 -7.2 L -4.8 -5.2 L -2.8 -3.4 Q 0 -4.4 2.8 -3.4 L 4.8 -5.2 L 4.0 -7.2 Q 6.8 -7.8 7.2 -5.2 L 4.2 -2.2 Q 5.8 0.8 4.4 4.2 L 7.2 5.8 L 5.8 7.0 L 3.2 5.0 Q 0 6.2 -3.2 5.0 L -5.8 7.0 L -7.2 5.8 L -4.4 4.2 Q -5.8 0.8 -4.2 -2.2 Z',
      },
    },
    { tag: 'circle', attrs: { cx: -1.6, cy: -1.8, r: 0.7 }, cutout: true },
    { tag: 'circle', attrs: { cx: 1.6, cy: -1.8, r: 0.7 }, cutout: true },
  ],

  // 5-arm sea star / marine invertebrate silhouette
  'starfish-mollusc': [
    {
      tag: 'path',
      attrs: {
        d: 'M 0 -7.6 L 2.0 -2.4 L 7.5 -2.2 L 3.1 1.2 L 4.7 6.6 L 0 3.5 L -4.7 6.6 L -3.1 1.2 L -7.5 -2.2 L -2.0 -2.4 Z',
      },
    },
    { tag: 'circle', attrs: { cx: 0, cy: 0, r: 1.2 }, cutout: true },
  ],

  // Symmetric 4-wing bee / insect with head & abdomen
  insect: [
    { tag: 'circle', attrs: { cx: 0, cy: -5.4, r: 1.9 } },
    { tag: 'ellipse', attrs: { cx: 0, cy: 1.8, rx: 2.3, ry: 5.0 } },
    {
      tag: 'path',
      attrs: {
        d: 'M -1.8 -2.2 Q -7.8 -5.2 -7.4 -0.8 Q -7.0 2.0 -2.0 0.8 Z',
      },
    },
    {
      tag: 'path',
      attrs: {
        d: 'M 1.8 -2.2 Q 7.8 -5.2 7.4 -0.8 Q 7.0 2.0 2.0 0.8 Z',
      },
    },
    {
      tag: 'path',
      attrs: { d: 'M -1.8 1.6 L 1.8 1.6 L 1.8 2.8 L -1.8 2.8 Z' },
      cutout: true,
    },
    {
      tag: 'path',
      attrs: { d: 'M -1.6 4.0 L 1.6 4.0 L 1.4 5.1 L -1.4 5.1 Z' },
      cutout: true,
    },
  ],
};
