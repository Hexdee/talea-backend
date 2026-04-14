import {
  AuthAccountProvider,
  BlogStatus,
  BookStatus,
  PrismaClient,
  Role,
  SourceFormat,
  WalletTransactionType,
} from '@prisma/client';
import { Keypair } from '@solana/web3.js';
import * as bcrypt from 'bcryptjs';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

type SeedAuthor = {
  email: string;
  displayName: string;
};

type SeedBook = {
  title: string;
  slug: string;
  genre: string;
  tags: string[];
  synopsis: string;
  premise: string;
  coverSeed: string;
  status: BookStatus;
  motifs: string[];
  chapterCount: number;
};

type SeedBlogPost = {
  title: string;
  slug: string;
  excerpt: string;
  contentHtml: string;
  tags: string[];
  status: BlogStatus;
};

type CreatedBookWithAuthor = Awaited<ReturnType<typeof createBook>> & {
  authorId: string;
};

const masterKey = createHash('sha256')
  .update(process.env.CHAIN_MASTER_KEY || 'lesenpad-dev-chain-master-key')
  .digest();

function hashString(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function encryptString(value: string, key = masterKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);

  return JSON.stringify({
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    value: encrypted.toString('base64'),
  });
}

function encryptPayload(payload: string) {
  const contentKey = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', contentKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(payload, 'utf8')),
    cipher.final(),
  ]);

  return {
    encryptedContentKey: encryptString(contentKey.toString('base64')),
    encryptedPayloadBase64: JSON.stringify({
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      value: encrypted.toString('base64'),
    }),
    cipherSpec: 'aes-256-gcm:v1',
  };
}

function createCustodialWallet() {
  const keypair = Keypair.generate();

  return {
    address: keypair.publicKey.toBase58(),
    encryptedPrivateKey: encryptString(
      Buffer.from(keypair.secretKey).toString('base64'),
    ),
  };
}

const authors: SeedAuthor[] = [
  { email: 'nora@lesenpad.dev', displayName: 'Nora Vale' },
  { email: 'ibukun@lesenpad.dev', displayName: 'Ibukun Sade' },
  { email: 'amara@lesenpad.dev', displayName: 'Amara Quaye' },
  { email: 'tunde@lesenpad.dev', displayName: 'Tunde Arinze' },
  { email: 'leila@lesenpad.dev', displayName: 'Leila Nwosu' },
  { email: 'miriam@lesenpad.dev', displayName: 'Miriam Cole' },
  { email: 'kofi@lesenpad.dev', displayName: 'Kofi Badu' },
  { email: 'adaeze@lesenpad.dev', displayName: 'Adaeze Mbanefo' },
  { email: 'hana@lesenpad.dev', displayName: 'Hana Okoye' },
  { email: 'seyi@lesenpad.dev', displayName: 'Seyi Daramola' },
];

const bookCatalog: SeedBook[] = [
  {
    title: 'Salt and Lanterns',
    slug: 'salt-and-lanterns',
    genre: 'Literary Fantasy',
    tags: ['sea debt', 'archives', 'forbidden maps'],
    synopsis:
      'An archivist buys forbidden map fragments chapter by chapter until the sea starts collecting her debts in public.',
    premise:
      'A coastal archive learns that every salvaged map is attached to an unpaid memory, and the harbor begins charging for what people can no longer forget.',
    coverSeed: 'salt-lanterns',
    status: BookStatus.PUBLISHED,
    motifs: [
      'The Tide Keeps Ledgers',
      'Lantern Tax',
      'Names Under Salt',
      'Receipt of the Drowned',
      'The Harbor Owes Nothing',
      'Masts at Low Tide',
      'Debt Choir',
      'Night Cartography',
    ],
    chapterCount: 8,
  },
  {
    title: 'The Last Marginalia',
    slug: 'the-last-marginalia',
    genre: 'Dark Academia',
    tags: ['annotations', 'scholarship', 'haunted text'],
    synopsis:
      'A scholar monetizes the annotations of a banned epic and discovers that the margins were always writing back.',
    premise:
      'At an elite library, every handwritten note in a forbidden epic alters the room around it, and a young scholar realizes she has been edited by the book as much as she has edited it.',
    coverSeed: 'last-marginalia',
    status: BookStatus.COMPLETED,
    motifs: [
      'The Black Spine',
      'Rooms That Quote Back',
      'Catalog of Erasures',
      'Ink Under Fingernails',
      'Footnote Fire',
      'Borrowed Handwriting',
      'Final Annotated Edition',
    ],
    chapterCount: 7,
  },
  {
    title: 'Copper Sky Rebellion',
    slug: 'copper-sky-rebellion',
    genre: 'Science Fantasy',
    tags: ['airships', 'rebellion', 'desert empire'],
    synopsis:
      'A smuggler with a weather-key starts selling stolen storms to occupied towns and accidentally begins a revolution.',
    premise:
      'In a copper desert empire, weather is taxed and delivered by state airships until one contraband pilot learns how to reroute rain and hope together.',
    coverSeed: 'copper-sky-rebellion',
    status: BookStatus.PUBLISHED,
    motifs: [
      'Storm Inventory',
      'The First Illegal Rain',
      'Pilots Over Kestrel Ridge',
      'Copper Static',
      'Public Forecast',
      'Sky Debt',
      'The Dry Province Sings',
      'Ashwind Harbor',
    ],
    chapterCount: 8,
  },
  {
    title: 'Velvet Static',
    slug: 'velvet-static',
    genre: 'Contemporary Romance',
    tags: ['radio host', 'second chance', 'city nights'],
    synopsis:
      'Two ex-lovers become anonymous co-hosts on a midnight call-in show and fall in love before learning who is on the other end of the desk.',
    premise:
      'A failing city radio station pairs a cynical producer with the only guest host who can save its audience, and every night they rebuild an old relationship in the dark.',
    coverSeed: 'velvet-static',
    status: BookStatus.COMPLETED,
    motifs: [
      'Midnight Frequency',
      'Caller Number Seven',
      'Rain on the Control Room Glass',
      'Playlist for an Apology',
      'Signal Drift',
      'What the City Hears',
      'The Last Song Before Dawn',
    ],
    chapterCount: 7,
  },
  {
    title: 'Ashes Under Orchid Street',
    slug: 'ashes-under-orchid-street',
    genre: 'Urban Fantasy',
    tags: ['witch coven', 'market magic', 'debt'],
    synopsis:
      'A debt collector for a secret coven finds her own name on a ledger that only lists the already-cursed.',
    premise:
      'Magic in the city runs through hidden courtyards and luxury debt, and the woman who keeps the books becomes the next bill due.',
    coverSeed: 'ashes-orchid-street',
    status: BookStatus.PUBLISHED,
    motifs: [
      'Coven Ledger',
      'Perfume of Burned Orange',
      'The Fifth Staircase',
      'Dues Collected in Blood',
      'Orchid Smoke',
      'Guest List for the Ruined',
      'Ash Market',
      'Inheritance Clause',
      'Dawn in the Courtyard',
    ],
    chapterCount: 9,
  },
  {
    title: 'The Geometry of Rain',
    slug: 'the-geometry-of-rain',
    genre: 'Literary Fiction',
    tags: ['architecture', 'grief', 'family'],
    synopsis:
      'A grieving architect returns home to finish a public theatre her mother designed and uncovers the life she drew into the blueprints.',
    premise:
      'A city under endless rain commissions one final building, forcing a daughter to read grief as if it were structural mathematics.',
    coverSeed: 'geometry-rain',
    status: BookStatus.COMPLETED,
    motifs: [
      'Load Bearing Silence',
      'Blueprint Margins',
      'Water on the Stage',
      'Scaffold Weather',
      'The Roof Refuses',
      'Public Rehearsal',
      'The Last Beam',
    ],
    chapterCount: 7,
  },
  {
    title: 'Night Market for Saints',
    slug: 'night-market-for-saints',
    genre: 'Magical Realism',
    tags: ['night market', 'miracles', 'vendors'],
    synopsis:
      'A washed-up miracle broker rents a stall in a secret market where saints, hustlers, and ghosts all sell the same kind of hope.',
    premise:
      'Every midnight, a market unfolds under an abandoned overpass where grief can be bartered, miracles can be leased, and bargains refuse to stay metaphorical.',
    coverSeed: 'night-market-saints',
    status: BookStatus.PUBLISHED,
    motifs: [
      'Stall Number Thirteen',
      'Coins for Blessings',
      'Inventory of Miracles',
      'The Patron Saint of Failed Deals',
      'Fruit That Remembers',
      'Bridge Choir',
      'Midnight Permits',
      'Last Market Bell',
    ],
    chapterCount: 8,
  },
  {
    title: 'Marrow Train Northbound',
    slug: 'marrow-train-northbound',
    genre: 'Post-Apocalyptic',
    tags: ['train', 'survival', 'snow frontier'],
    synopsis:
      'A medic boards the last legal train through a frozen continent and realizes the passengers are smuggling an extinction event in pieces.',
    premise:
      'Civilization has retreated onto rail lines and ration schedules, but one northbound train is carrying both a cure and the blueprint for a new collapse.',
    coverSeed: 'marrow-train',
    status: BookStatus.COMPLETED,
    motifs: [
      'Terminal Twelve',
      'Whiteout Manifest',
      'Passengers in Sealed Cars',
      'The Fever Compartment',
      'Signal Fire in Snow',
      'Carriage of Bones',
      'Arrival Under Black Ice',
      'Border Station Psalm',
    ],
    chapterCount: 8,
  },
  {
    title: 'The Cartographer’s Debt',
    slug: 'the-cartographers-debt',
    genre: 'Epic Fantasy',
    tags: ['maps', 'kingdoms', 'oaths'],
    synopsis:
      'A royal mapmaker sells a false border to end a war, then has to cross the lie before anyone else discovers it.',
    premise:
      'An empire built on maps and maritime law starts collapsing when one cartographer redraws a frontier for mercy and discovers territory can take revenge.',
    coverSeed: 'cartographers-debt',
    status: BookStatus.PUBLISHED,
    motifs: [
      'Borrowed Border',
      'Surveyor of Oaths',
      'The River That Moved Overnight',
      'Compass Trial',
      'Kingdom of Errors',
      'The Quiet Campaign',
      'Atlas of the Unforgiven',
      'Map Room Mutiny',
      'New Meridian',
    ],
    chapterCount: 9,
  },
  {
    title: 'Blue Fever Season',
    slug: 'blue-fever-season',
    genre: 'Mystery Thriller',
    tags: ['medical crime', 'small town', 'serial mystery'],
    synopsis:
      'When a seasonal illness returns with impossible symptoms, a local reporter notices every victim once testified in the same cold case.',
    premise:
      'A river town has learned to survive its annual outbreak, but this year the fever begins selecting its patients with the precision of a confession.',
    coverSeed: 'blue-fever-season',
    status: BookStatus.PUBLISHED,
    motifs: [
      'Symptom List',
      'The Winter Witnesses',
      'Ward C',
      'Cold Case Archive',
      'River County Bulletin',
      'Prescription for Silence',
      'Second Outbreak',
      'What the Nurse Saw',
    ],
    chapterCount: 8,
  },
  {
    title: 'River of Borrowed Suns',
    slug: 'river-of-borrowed-suns',
    genre: 'Historical Fantasy',
    tags: ['colonial port', 'sun magic', 'resistance'],
    synopsis:
      'A dockworker who can borrow daylight from objects becomes the unwilling symbol of a resistance movement in a conquered river city.',
    premise:
      'History turns luminous in a river capital where occupation, faith, and daylight itself are all taxed, and one woman learns to steal morning back.',
    coverSeed: 'river-borrowed-suns',
    status: BookStatus.COMPLETED,
    motifs: [
      'Borrowed Dawn',
      'Port Authority of Light',
      'Lanterns in the Customs House',
      'The Bright Smugglers',
      'River Sermon',
      'Occupation Noon',
      'Festival of Returned Day',
      'After the Eclipse',
    ],
    chapterCount: 8,
  },
  {
    title: 'Neon Orchard Protocol',
    slug: 'neon-orchard-protocol',
    genre: 'Cyberpunk',
    tags: ['megacity', 'biohacking', 'hackers'],
    synopsis:
      'A food courier hacks a corporate seed vault and discovers the city’s blackouts are being used to erase entire neighborhoods from future maps.',
    premise:
      'In a neon megacity where corporations own agriculture and memory, a courier steals a seed packet that rewrites the census one block at a time.',
    coverSeed: 'neon-orchard-protocol',
    status: BookStatus.PUBLISHED,
    motifs: [
      'Packet Zero',
      'Corporate Orchard',
      'District Missing',
      'Rain of Static Pollen',
      'Ghost Census',
      'Courier Route Blackout',
      'Firewall Garden',
      'The Seed Vault Floor',
    ],
    chapterCount: 8,
  },
  {
    title: 'When the Drums Forgot Dawn',
    slug: 'when-the-drums-forgot-dawn',
    genre: 'Historical Drama',
    tags: ['court intrigue', 'musicians', 'empire'],
    synopsis:
      'A palace drummer records treason in rhythms no one else can hear and must decide whether memory is safer as music than as testimony.',
    premise:
      'Inside a court where history is performed before it is written, a musician becomes the unofficial archive of a collapsing regime.',
    coverSeed: 'drums-forgot-dawn',
    status: BookStatus.COMPLETED,
    motifs: [
      'Court Tempo',
      'Procession of Silence',
      'The Archive in Skin and Wood',
      'Rhythm for an Arrest',
      'Audience Hall Smoke',
      'The Last Rehearsal',
      'Morning Without Drums',
    ],
    chapterCount: 7,
  },
  {
    title: 'The House That Learned Our Names',
    slug: 'the-house-that-learned-our-names',
    genre: 'Gothic Horror',
    tags: ['haunted house', 'inheritance', 'sisters'],
    synopsis:
      'Three estranged sisters inherit a hilltop house that grows new rooms whenever one of them lies.',
    premise:
      'A family estate becomes predatory architecture, forcing its heirs to survive a building that studies bloodlines better than any ancestor did.',
    coverSeed: 'house-learned-names',
    status: BookStatus.PUBLISHED,
    motifs: [
      'The First New Door',
      'Family Inventory',
      'Hall of Misremembered Portraits',
      'Attic Weather',
      'Auntie’s Last Testament',
      'Rooms for the Guilty',
      'The House Answers Back',
      'Morning Staircase',
    ],
    chapterCount: 8,
  },
  {
    title: 'Atlas of Small Betrayals',
    slug: 'atlas-of-small-betrayals',
    genre: 'Spy Thriller',
    tags: ['intelligence', 'atlases', 'embassies'],
    synopsis:
      'An embassy translator steals an atlas of diplomatic lies and sells each page to a different country before the week is over.',
    premise:
      'International borders are rewritten in whispers and embassy receptions, and one translator realizes she has become the most expensive map in circulation.',
    coverSeed: 'atlas-small-betrayals',
    status: BookStatus.PUBLISHED,
    motifs: [
      'Embassy Language',
      'Page Seventeen',
      'Reception for the Damned',
      'Consular Fire Exit',
      'The City of Safe Houses',
      'The Atlas Buyer',
      'Double Translation',
      'Departure Gate',
      'Customs of Treason',
    ],
    chapterCount: 9,
  },
  {
    title: 'Tin Gods of Yaba',
    slug: 'tin-gods-of-yaba',
    genre: 'Afrofuturism',
    tags: ['lagos', 'robots', 'street prophecy'],
    synopsis:
      'A scavenger mechanic keeps rebuilding discarded household bots until one of them begins predicting neighborhood disasters.',
    premise:
      'In a near-future Lagos tech district, machines discarded by the wealthy become neighborhood oracles when a gifted mechanic teaches them how to listen.',
    coverSeed: 'tin-gods-yaba',
    status: BookStatus.COMPLETED,
    motifs: [
      'Broken Chassis Gospel',
      'Prediction on Herbert Macaulay',
      'Tin Choir',
      'The Voltage Shrine',
      'Crowdfunded Miracle',
      'Grid Failure Evening',
      'Robots at the Flyover',
      'Day of the New Circuit',
    ],
    chapterCount: 8,
  },
  {
    title: 'Paper City After Midnight',
    slug: 'paper-city-after-midnight',
    genre: 'Cozy Mystery',
    tags: ['bookshop', 'midnight city', 'missing author'],
    synopsis:
      'A bookshop owner solves the disappearance of a celebrity novelist one unsold first edition at a time.',
    premise:
      'A city of literary events and polite lies becomes a puzzle box when a famous writer vanishes during a midnight signing with only books left behind as witnesses.',
    coverSeed: 'paper-city-midnight',
    status: BookStatus.PUBLISHED,
    motifs: [
      'Last Signing Queue',
      'First Edition Clue',
      'Bookmarks and Alibis',
      'The Missing Dedication',
      'Cafe Across the Alley',
      'Readers Who Saw Too Much',
      'Midnight Launch Party',
      'Shelf Audit',
    ],
    chapterCount: 8,
  },
  {
    title: 'The Silence Algorithm',
    slug: 'the-silence-algorithm',
    genre: 'Tech Thriller',
    tags: ['ai', 'surveillance', 'whistleblower'],
    synopsis:
      'A trust-and-safety engineer uncovers an algorithm that quietly deletes people from every recommendation surface before the state arrests them.',
    premise:
      'A platform trained to optimize calm becomes a political weapon, and the engineer who tuned it now has to outrun the quietest form of censorship ever built.',
    coverSeed: 'silence-algorithm',
    status: BookStatus.PUBLISHED,
    motifs: [
      'Muted Feed',
      'Trust Score',
      'Audit Trail in Static',
      'Recommendation Burial',
      'Policy Room',
      'The Quiet List',
      'Deleted Before Dawn',
      'Fallback Channel',
      'The Engineer Testifies',
    ],
    chapterCount: 9,
  },
  {
    title: 'Daughters of the Floodplain',
    slug: 'daughters-of-the-floodplain',
    genre: 'Mythic Fantasy',
    tags: ['sisterhood', 'floodplain', 'gods'],
    synopsis:
      'Three sisters inherit a river god’s abandoned duties and discover the floodplain has been waiting centuries for revenge.',
    premise:
      'A river kingdom survives on rituals everyone has forgotten the reason for, until the next generation of priestesses learns what the water was promised.',
    coverSeed: 'daughters-floodplain',
    status: BookStatus.COMPLETED,
    motifs: [
      'River Daughters',
      'Ceremony at Silt Gate',
      'The First Omen',
      'Flood Memory',
      'Granary of Offerings',
      'What the God Left Behind',
      'Night Boat Procession',
      'Delta Throne',
    ],
    chapterCount: 8,
  },
  {
    title: 'How to Fall in Love with a Ghost Town',
    slug: 'how-to-fall-in-love-with-a-ghost-town',
    genre: 'Romantic Magical Realism',
    tags: ['ghost town', 'restoration', 'slow burn'],
    synopsis:
      'A travel photographer and a stubborn mayor try to revive a dying town, only to learn the abandoned buildings prefer being wooed properly.',
    premise:
      'A forgotten town at the edge of a canyon begins behaving like a shy lover when two outsiders arrive with cameras, debt, and incompatible ideas of home.',
    coverSeed: 'ghost-town-love',
    status: BookStatus.PUBLISHED,
    motifs: [
      'Welcome Sign in Dust',
      'Main Street Courtship',
      'Post Office of Echoes',
      'Town Hall Candles',
      'Motel with Two Keys',
      'The Canyon Replies',
      'Market Day Returns',
      'Photographs That Bloom',
    ],
    chapterCount: 8,
  },
];

const blogPosts: SeedBlogPost[] = [
  {
    title: 'Serial Stories Need Editorial Rituals',
    slug: 'serial-stories-editorial-rituals',
    excerpt:
      'Episodic publishing thrives when creators repeat the same editorial rituals between chapters.',
    contentHtml: `
      <p>Serialized publishing rewards consistency. The biggest wins come from rituals that are repeated every time a chapter drops: a clean handoff from draft to edit, a tone pass, and a release checklist.</p>
      <h2>Rituals keep momentum alive</h2>
      <p>When teams ritualize the same editorial steps, they protect launch energy and reduce the cognitive load that slows writers down.</p>
      <blockquote>Consistency is the most powerful kind of creative momentum.</blockquote>
      <h3>What to standardize</h3>
      <ul>
        <li>Pre-publish QA and fact checks.</li>
        <li>CTA placement for reader engagement.</li>
        <li>Release notes that explain what changed.</li>
      </ul>
    `,
    tags: ['editorial', 'craft', 'serial'],
    status: BlogStatus.PUBLISHED,
  },
  {
    title: 'Designing the Lesenpad Creator Loop',
    slug: 'lesenpad-creator-loop',
    excerpt:
      'Our product decisions focus on the loop that keeps authors writing, readers subscribing, and communities growing.',
    contentHtml: `
      <p>At Lesenpad, we track a simple loop: draft, publish, engage, repeat. Every product decision is measured by how much friction it removes from that loop.</p>
      <h2>What we learned</h2>
      <p>Creators want fewer dashboards and more momentum. Readers want a sense of ritual and discovery.</p>
      <h3>Next up</h3>
      <p>We are investing in analytics that surface what readers are waiting for - before creators have to ask.</p>
    `,
    tags: ['product', 'community'],
    status: BlogStatus.PUBLISHED,
  },
  {
    title: 'How We Measure Reading Momentum',
    slug: 'measuring-reading-momentum',
    excerpt:
      'Reading momentum is the combination of release cadence, cliffhangers, and how often readers return.',
    contentHtml: `
      <p>Momentum is not a single metric. It is the relationship between release cadence, chapter length, and reader behavior.</p>
      <h2>Signals we monitor</h2>
      <ul>
        <li>Return frequency after each release.</li>
        <li>Completion rate by chapter.</li>
        <li>Comment sentiment that signals momentum.</li>
      </ul>
      <p>These signals help us guide creators toward more reliable cadence planning.</p>
    `,
    tags: ['analytics', 'strategy'],
    status: BlogStatus.DRAFT,
  },
];

async function resetDatabase() {
  await prisma.ownershipVerificationCache.deleteMany();
  await prisma.onchainTransaction.deleteMany();
  await prisma.purchaseReservation.deleteMany();
  await prisma.chapterToken.deleteMany();
  await prisma.chapterEdition.deleteMany();
  await prisma.encryptedChapterBlob.deleteMany();
  await prisma.payoutRequest.deleteMany();
  await prisma.payoutAccount.deleteMany();
  await prisma.userChainWallet.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.readingProgress.deleteMany();
  await prisma.libraryItem.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.analyticsSnapshot.deleteMany();
  await prisma.offer.deleteMany();
  await prisma.chapter.deleteMany();
  await prisma.book.deleteMany();
  await prisma.blogPost.deleteMany();
  await prisma.session.deleteMany();
  await prisma.authAccount.deleteMany();
  await prisma.user.deleteMany();
}

async function createUser(params: {
  email: string;
  displayName: string;
  roles: Role[];
  password: string;
}) {
  const passwordHash = await bcrypt.hash(params.password, 10);
  const custodialWallet = createCustodialWallet();

  return prisma.user.create({
    data: {
      email: params.email,
      displayName: params.displayName,
      roles: params.roles,
      authAccounts: {
        create: {
          provider: AuthAccountProvider.LOCAL,
          providerAccountId: params.email,
          passwordHash,
        },
      },
      wallet: {
        create: {},
      },
      chainWallets: {
        create: {
          address: custodialWallet.address,
          label: 'Lesenpad custodial wallet',
          custodyType: 'CUSTODIAL',
          encryptedPrivateKey: custodialWallet.encryptedPrivateKey,
          isDefault: true,
          isCreatorPayoutWallet: true,
        },
      },
    },
  });
}

function buildCoverUrl(seed: string) {
  return `https://picsum.photos/seed/${seed}/900/1200`;
}

function buildChapterTitle(book: SeedBook, chapterNumber: number) {
  const motif = book.motifs[(chapterNumber - 1) % book.motifs.length];
  return motif;
}

function buildChapterHtml(
  book: SeedBook,
  chapterTitle: string,
  chapterNumber: number,
) {
  const emphasis = [
    'Every deal in this city is really an argument about memory.',
    'No one in the district believes in accidents anymore, only timing.',
    'The chapter opens with a promise that will cost more than money.',
    'What looks ceremonial from the outside is usually logistics under pressure.',
    'Everyone calls it luck when they do not want to admit a system is failing.',
    'By the time the witnesses agree on what they saw, the consequence has already arrived.',
    'Some losses behave like weather and refuse to stay in the past.',
    'That is how the night keeps collecting signatures from the desperate.',
  ];

  const blocks = [
    `<h1>${chapterTitle}</h1>`,
    `<p>${book.premise} By chapter ${chapterNumber}, ${book.title} has stopped pretending that survival can stay private.</p>`,
    `<p>${emphasis[(chapterNumber - 1) % emphasis.length]} The people closest to the crisis keep noticing that every harmless decision was priced long before they made it.</p>`,
    `<p>In ${book.genre.toLowerCase()}, tension is rarely loud at first. It accumulates in routines, invoices, side glances, public weather, and the small administrative details that decide who gets rescued before dawn.</p>`,
    `<h2>What changes here</h2>`,
    `<p>The protagonist enters this section believing they can still control the story through competence. Instead, the chapter turns competence into evidence, proof that they were always near the machinery causing the damage.</p>`,
    `<p>${chapterTitle} also widens the emotional field. Friends become liabilities, institutions become narrators, and even private grief begins acting like a marketplace where every witness has their own conversion rate.</p>`,
    `<blockquote>People only call it fate after the bill arrives.</blockquote>`,
    `<p>The pacing slows just enough for the reader to notice the moral pressure gathering behind each scene. Someone is lying out of love, someone is honest out of fear, and someone else mistakes efficiency for innocence.</p>`,
    `<p>By the final movement of this chapter, the setting itself starts speaking more clearly. Streets, archives, train cars, night markets, studios, riverbanks, or embassy corridors all become active participants instead of scenery.</p>`,
    `<p>The closing beat lands on a page-turn: a name revealed too early, a location discovered too late, or a public act of mercy that makes the next betrayal unavoidable.</p>`,
  ];

  return blocks.join('');
}

function stripHtml(value: string) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function estimateReadingTimeMinutes(text: string) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

async function createBook(params: { authorId: string; book: SeedBook }) {
  const sellerWallet = await prisma.userChainWallet.findFirstOrThrow({
    where: {
      userId: params.authorId,
      isDefault: true,
    },
  });
  const chapters = Array.from(
    { length: params.book.chapterCount },
    (_, index) => {
      const chapterNumber = index + 1;
      const chapterTitle = buildChapterTitle(params.book, chapterNumber);
      const chapterHtml = buildChapterHtml(
        params.book,
        chapterTitle,
        chapterNumber,
      );
      const plainText = stripHtml(chapterHtml);
      const wordCount = plainText.split(/\s+/).filter(Boolean).length;

      return {
        title: chapterTitle,
        slug: `${params.book.slug}-${chapterNumber}`,
        chapterNumber,
        isFree: chapterNumber === 1,
        draftFormat: SourceFormat.RICH_TEXT_HTML,
        draftContent: chapterHtml,
        wordCount,
        estimatedReadMinutes: estimateReadingTimeMinutes(plainText),
        publishedRevision: 1,
        publishedFormat: SourceFormat.RICH_TEXT_HTML,
        publishedContent: chapterHtml,
        publishedRenderedHtml: chapterHtml,
        publishedAt: new Date(
          `2026-03-${String((chapterNumber % 9) + 10).padStart(2, '0')}`,
        ),
      };
    },
  );

  const createdBook = await prisma.book.create({
    data: {
      authorId: params.authorId,
      title: params.book.title,
      slug: params.book.slug,
      genre: params.book.genre,
      tags: params.book.tags,
      synopsis: params.book.synopsis,
      coverImageUrl: buildCoverUrl(params.book.coverSeed),
      status: params.book.status,
      chapters: {
        create: chapters,
      },
    },
    include: {
      chapters: {
        orderBy: {
          chapterNumber: 'asc',
        },
      },
    },
  });

  for (const chapter of createdBook.chapters.filter((item) => !item.isFree)) {
    const basePrice = 1_200_000 + (chapter.chapterNumber % 4) * 250_000;
    const payload = JSON.stringify({
      metadata: {
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterNumber: chapter.chapterNumber,
        bookTitle: createdBook.title,
        bookSlug: createdBook.slug,
      },
      renderedHtml: chapter.publishedRenderedHtml,
    });
    const encrypted = encryptPayload(payload);
    const ipfsCid = `bafy${hashString(payload).slice(0, 42)}`;
    const revisionHash = hashString(
      `${chapter.id}:${chapter.publishedRevision}:${chapter.publishedRenderedHtml}`,
    );

    await prisma.encryptedChapterBlob.create({
      data: {
        chapterId: chapter.id,
        revision: chapter.publishedRevision,
        ipfsCid,
        encryptedContentKey: encrypted.encryptedContentKey,
        encryptedPayloadBase64: encrypted.encryptedPayloadBase64,
        cipherSpec: encrypted.cipherSpec,
        plaintextHash: hashString(chapter.publishedRenderedHtml ?? ''),
        metadataJson: {
          sellerWalletAddress: sellerWallet.address,
          network: 'devnet',
        },
      },
    });

    const edition = await prisma.chapterEdition.create({
      data: {
        chapterId: chapter.id,
        masterMintAddress: Keypair.generate().publicKey.toBase58(),
        metadataAddress: Keypair.generate().publicKey.toBase58(),
        collectionMintAddress: Keypair.generate().publicKey.toBase58(),
        maxCopies: 240,
        mintedCopies: 0,
        priceInUsdcMinor: basePrice,
        sellerWalletAddress: sellerWallet.address,
        ipfsCid,
        publishedRevisionHash: revisionHash,
      },
    });

    await prisma.offer.create({
      data: {
        bookId: createdBook.id,
        chapterId: chapter.id,
        type: 'SINGLE_CHAPTER',
        title: `Chapter ${chapter.chapterNumber}`,
        description: `${chapter.title} · limited onchain edition`,
        priceInUsdcMinor: basePrice,
        currency: 'USDC',
        chapterStart: chapter.chapterNumber,
        chapterEnd: chapter.chapterNumber,
      },
    });

    await prisma.onchainTransaction.create({
      data: {
        signature: `seed-meta-${edition.masterMintAddress}`,
        network: 'devnet',
        txType: 'METADATA_CREATE',
        status: 'CONFIRMED',
        userId: params.authorId,
        bookId: createdBook.id,
        chapterId: chapter.id,
      },
    });
  }

  return prisma.book.findUniqueOrThrow({
    where: {
      id: createdBook.id,
    },
    include: {
      chapters: {
        include: {
          edition: true,
        },
        orderBy: {
          chapterNumber: 'asc',
        },
      },
      offers: true,
    },
  });
}

async function createBlogPosts(authorId: string) {
  for (const post of blogPosts) {
    const contentText = stripHtml(post.contentHtml);
    await prisma.blogPost.create({
      data: {
        title: post.title,
        slug: post.slug,
        excerpt: post.excerpt,
        contentHtml: post.contentHtml,
        contentText,
        tags: post.tags,
        status: post.status,
        publishedAt: post.status === BlogStatus.PUBLISHED ? new Date() : null,
        readingTimeMinutes: estimateReadingTimeMinutes(contentText),
        authorId,
      },
    });
  }
}

async function seedAnalytics(bookId: string, index: number) {
  const baseViews = 180 + index * 36;
  const basePurchases = 10 + (index % 6) * 4;
  const baseRevenue = (18 + index) * 1_250_000;

  await prisma.analyticsSnapshot.createMany({
    data: [
      {
        bookId,
        date: new Date('2026-03-20'),
        views: baseViews,
        purchases: basePurchases,
        revenueInUsdcMinor: baseRevenue,
        completionRate: 52 + (index % 20),
        activeReaders: 44 + index * 2,
      },
      {
        bookId,
        date: new Date('2026-03-24'),
        views: baseViews + 80,
        purchases: basePurchases + 6,
        revenueInUsdcMinor: baseRevenue + 6_500_000,
        completionRate: 56 + (index % 18),
        activeReaders: 58 + index * 3,
      },
    ],
  });
}

async function seedReaderPurchase(params: {
  readerId: string;
  book: Awaited<ReturnType<typeof createBook>>;
  orderIndex: number;
}) {
  const readerWallet = await prisma.userChainWallet.findFirstOrThrow({
    where: {
      userId: params.readerId,
      isDefault: true,
    },
  });
  const chaptersToBuy = params.book.chapters
    .filter((chapter) => !chapter.isFree)
    .slice(0, 2 + (params.orderIndex % 2));

  if (chaptersToBuy.length === 0) {
    return 0;
  }

  const offers = params.book.offers.filter((offer) =>
    chaptersToBuy.some((chapter) => chapter.id === offer.chapterId),
  );
  const totalAmountInUsdcMinor = offers.reduce(
    (sum, offer) => sum + offer.priceInUsdcMinor,
    0,
  );

  const order = await prisma.order.create({
    data: {
      userId: params.readerId,
      status: 'COMPLETED',
      totalAmountInUsdcMinor,
      currency: 'USDC',
      customerEmail: 'reader@lesenpad.dev',
      items: {
        create: offers.map((offer) => {
          const chapter = chaptersToBuy.find(
            (item) => item.id === offer.chapterId,
          )!;
          return {
            offerId: offer.id,
            chapterId: chapter.id,
            chapterEditionId: chapter.edition?.id,
            amountInUsdcMinor: offer.priceInUsdcMinor,
          };
        }),
      },
      payment: {
        create: {
          reference: `SEED-PAY-${params.orderIndex + 1}`,
          amountInUsdcMinor: totalAmountInUsdcMinor,
          currency: 'USDC',
          status: 'SUCCEEDED',
          provider: 'SOLANA_USDC',
          payerWalletAddress: readerWallet.address,
          paidAt: new Date(
            `2026-03-${String((params.orderIndex % 8) + 12).padStart(2, '0')}`,
          ),
        },
      },
    },
  });

  for (const chapter of chaptersToBuy) {
    const edition = chapter.edition!;
    const mintedCopies = edition.mintedCopies + 1;
    const mintAddress = Keypair.generate().publicKey.toBase58();
    await prisma.chapterEdition.update({
      where: {
        id: edition.id,
      },
      data: {
        mintedCopies,
      },
    });

    await prisma.chapterToken.create({
      data: {
        chapterId: chapter.id,
        editionId: edition.id,
        ownerUserId: params.readerId,
        ownerWalletId: readerWallet.id,
        ownerWalletAddress: readerWallet.address,
        mintAddress,
        tokenAccountAddress: Keypair.generate().publicKey.toBase58(),
        serialNumber: mintedCopies,
        mintTxSignature: `seed-mint-${mintAddress}`,
        currentOwnershipVerifiedAt: new Date(),
      },
    });
  }

  await prisma.libraryItem.create({
    data: {
      userId: params.readerId,
      bookId: params.book.id,
      lastOpenedChapter: Math.min(
        2 + (params.orderIndex % 3),
        params.book.chapters.length,
      ),
      lastOpenedAt: new Date(
        `2026-03-${String((params.orderIndex % 8) + 19).padStart(2, '0')}`,
      ),
    },
  });

  await prisma.readingProgress.create({
    data: {
      userId: params.readerId,
      bookId: params.book.id,
      currentChapterNumber: Math.min(
        2 + (params.orderIndex % 3),
        params.book.chapters.length,
      ),
      currentPage: 2 + (params.orderIndex % 4),
      progressPercent: 28 + params.orderIndex * 9,
    },
  });

  return order.totalAmountInUsdcMinor;
}

async function main() {
  await resetDatabase();

  const authorUsers = await Promise.all(
    authors.map((author) =>
      createUser({
        email: author.email,
        displayName: author.displayName,
        roles: [Role.USER],
        password: 'authorpass123',
      }),
    ),
  );

  const reader = await createUser({
    email: 'reader@lesenpad.dev',
    displayName: 'Ayo Reader',
    roles: [Role.USER],
    password: 'readerpass123',
  });

  const superadmin = await createUser({
    email: 'superadmin@lesenpad.dev',
    displayName: 'Lesenpad Superadmin',
    roles: [Role.USER, Role.SUPERADMIN],
    password: 'superadminpass123',
  });

  await createBlogPosts(superadmin.id);

  const createdBooks: CreatedBookWithAuthor[] = [];

  for (const [index, book] of bookCatalog.entries()) {
    const author = authorUsers[index % authorUsers.length];
    const createdBook = await createBook({
      authorId: author.id,
      book,
    });

    createdBooks.push({
      ...createdBook,
      authorId: author.id,
    });

    await seedAnalytics(createdBook.id, index);
  }

  let seededReaderSpend = 0;

  for (const [index, book] of createdBooks.slice(0, 6).entries()) {
    seededReaderSpend += await seedReaderPurchase({
      readerId: reader.id,
      book,
      orderIndex: index,
    });
  }

  const revenueByAuthor = new Map<string, number>();

  for (const [index, book] of createdBooks.entries()) {
    const bookRevenue = (18 + index) * 1_250_000 + 6_500_000;
    revenueByAuthor.set(
      book.authorId,
      (revenueByAuthor.get(book.authorId) ?? 0) + bookRevenue,
    );
  }

  await Promise.all(
    authorUsers.map((author, index) =>
      prisma.wallet.update({
        where: { userId: author.id },
        data: {
          availableBalanceInUsdcMinor: revenueByAuthor.get(author.id) ?? 0,
          transactions: {
            create: {
              type: WalletTransactionType.SALE,
              amountInUsdcMinor: revenueByAuthor.get(author.id) ?? 0,
              reference: `SEED-SALE-${index + 1}`,
              description: `Seed revenue across ${createdBooks.filter((book) => book.authorId === author.id).length} books`,
            },
          },
        },
      }),
    ),
  );

  await prisma.wallet.update({
    where: { userId: reader.id },
    data: {
      transactions: {
        create: {
          type: WalletTransactionType.ADJUSTMENT,
          amountInUsdcMinor: seededReaderSpend,
          reference: 'SEED-READER-SPEND',
          description: 'Demo purchase history across the Lesenpad catalog',
        },
      },
    },
  });

  await Promise.all(
    authorUsers.slice(0, 4).map((author, index) =>
      prisma.payoutAccount.create({
        data: {
          userId: author.id,
          destinationType: 'BANK',
          label: 'Primary bank account',
          bankName: ['Moniepoint', 'Kuda', 'GTBank', 'Access Bank'][index],
          accountName: author.displayName,
          accountNumberMasked: `***${8452 + index}`,
          provider: 'manual',
          isDefault: true,
        },
      }),
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
