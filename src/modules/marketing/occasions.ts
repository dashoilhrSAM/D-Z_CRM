// Malaysian content calendar.
//
// WHY THIS EXISTS
// ---------------
// "根据马来西亚的节日与习惯去做编排" needs two different things, and the second matters
// more than the first:
//
//   1. The dates. Public holidays are reference data.
//   2. The RHYTHM around them. A motorcycle workshop does not sell because it is Raya —
//      it sells because a few million people are about to ride hundreds of kilometres
//      home and want the bike checked first. The value is in the lead time, not the date.
//
// So every occasion carries `leadDays` (when content should START, not when the holiday
// is) and `angleHint` (what to actually say). A planner that only knew holiday dates
// would post a Raya greeting on Raya and miss all the revenue.
//
// Dates come from the Ministry of Education / national holiday listings and are stored as
// plain YYYY-MM-DD at UTC midnight, matching the project's date convention. They are
// reference data with no organisation scope — every workshop in Malaysia shares them.

export type OccasionType = "FESTIVAL" | "NATIONAL" | "SCHOOL_HOLIDAY" | "PAYDAY" | "MONSOON" | "INDUSTRY";

export interface OccasionSeed {
  key: string;
  name: string;
  nameEn?: string;
  nameZh?: string;
  startDate: string; // YYYY-MM-DD (UTC midnight when stored)
  endDate?: string;
  type: OccasionType;
  /** 1-5. 5 = a peak demand driver. 2 = a weak signal that should yield to anything better. */
  relevance: number;
  /** How many days BEFORE startDate content should begin. */
  leadDays: number;
  angleHint: string;
  notes?: string;
}

const PRE_TRAVEL = "Perjalanan jauh balik kampung. Tumpu pemeriksaan keselamatan sebelum bertolak — brake, tayar, minyak hitam. Buka slot servis lebih awal daripada biasa.";

export const MY_CALENDAR: OccasionSeed[] = [
  // ---------- 2026 (remaining) ----------
  { key: "MY-2026-MALAYSIA-DAY", name: "Hari Malaysia", nameEn: "Malaysia Day", nameZh: "马来西亚日", startDate: "2026-09-16", type: "NATIONAL", relevance: 3, leadDays: 7,
    angleHint: "Cuti panjang hujung minggu. Ramai keluar berjalan — tumpu pemeriksaan keselamatan ringkas sebelum perjalanan." },
  { key: "MY-2026-DEEPAVALI", name: "Deepavali", nameEn: "Deepavali", nameZh: "屠妖节", startDate: "2026-11-08", type: "FESTIVAL", relevance: 4, leadDays: 14, angleHint: PRE_TRAVEL },
  { key: "MY-2026-SCHOOL-END", name: "Cuti akhir tahun persekolahan", nameEn: "End of school year", nameZh: "学年末假期", startDate: "2026-12-04", endDate: "2026-12-31", type: "SCHOOL_HOLIDAY", relevance: 3, leadDays: 10,
    angleHint: "Cuti sekolah panjang — keluarga ramai merancang perjalanan. Tawar pemeriksaan pra-perjalanan untuk motosikal keluarga." },
  { key: "MY-2026-CHRISTMAS", name: "Krismas", nameEn: "Christmas Day", nameZh: "圣诞节", startDate: "2026-12-25", type: "FESTIVAL", relevance: 3, leadDays: 14, angleHint: PRE_TRAVEL },
  { key: "MY-2026-MONSOON", name: "Monsun Timur Laut", nameEn: "Northeast monsoon", nameZh: "东北季风", startDate: "2026-11-01", endDate: "2027-03-31", type: "MONSOON", relevance: 4, leadDays: 7,
    angleHint: "Musim hujan. Cengkaman tayar dan keupayaan brake paling kritikal sekarang — jadikan keselamatan dalam hujan tema utama. Bunga tayar kurang, jarak berhenti jadi jauh lebih panjang.",
    notes: "Peak rainfall Nov-Jan, worst on the east coast and Sabah/Sarawak. Riding-safety content outperforms price content in this window." },

  // ---------- 2027 ----------
  { key: "MY-2027-CNY", name: "Tahun Baru Cina", nameEn: "Chinese New Year", nameZh: "农历新年", startDate: "2027-02-06", type: "FESTIVAL", relevance: 5, leadDays: 21, angleHint: PRE_TRAVEL,
    notes: "One of the two biggest long-distance travel events of the year. Competition for service slots is highest — push early booking hardest here." },
  { key: "MY-2027-CNY-2", name: "Tahun Baru Cina (hari kedua)", nameEn: "Chinese New Year (day 2)", nameZh: "农历新年初二", startDate: "2027-02-07", type: "FESTIVAL", relevance: 4, leadDays: 21, angleHint: PRE_TRAVEL },
  { key: "MY-2027-RAYA-AIDILFITRI", name: "Hari Raya Aidilfitri", nameEn: "Hari Raya Aidilfitri", nameZh: "开斋节", startDate: "2027-03-09", type: "FESTIVAL", relevance: 5, leadDays: 28, angleHint: PRE_TRAVEL,
    notes: "The single largest travel event of the Malaysian year — balik kampung at national scale. Start earliest: workshops book out weeks ahead." },
  { key: "MY-2027-RAYA-AIDILFITRI-2", name: "Hari Raya Aidilfitri (hari kedua)", nameEn: "Hari Raya Aidilfitri (day 2)", nameZh: "开斋节次日", startDate: "2027-03-10", type: "FESTIVAL", relevance: 4, leadDays: 28, angleHint: PRE_TRAVEL },
  { key: "MY-2027-LABOUR-DAY", name: "Hari Pekerja", nameEn: "Labour Day", nameZh: "劳动节", startDate: "2027-05-01", type: "NATIONAL", relevance: 2, leadDays: 5,
    angleHint: "Cuti umum. Tumpu promosi ringan atau kandungan kesedaran, bukan jualan agresif." },
  { key: "MY-2027-RAYA-HAJI", name: "Hari Raya Haji", nameEn: "Hari Raya Haji", nameZh: "哈芝节", startDate: "2027-05-16", type: "FESTIVAL", relevance: 4, leadDays: 14, angleHint: PRE_TRAVEL },
  { key: "MY-2027-WESAK", name: "Hari Wesak", nameEn: "Wesak Day", nameZh: "卫塞节", startDate: "2027-05-20", type: "FESTIVAL", relevance: 3, leadDays: 10, angleHint: PRE_TRAVEL },
  { key: "MY-2027-AWAL-MUHARRAM", name: "Awal Muharram", nameEn: "Awal Muharram", nameZh: "伊斯兰新年", startDate: "2027-06-06", type: "FESTIVAL", relevance: 3, leadDays: 10,
    angleHint: "Cuti umum keagamaan. Kandungan bernada hormat — elak jualan agresif." },
  { key: "MY-2027-AGONG-BIRTHDAY", name: "Hari Keputeraan YDP Agong", nameEn: "Agong's Birthday", nameZh: "元首诞辰", startDate: "2027-06-07", type: "NATIONAL", relevance: 3, leadDays: 7, angleHint: PRE_TRAVEL },
  { key: "MY-2027-MAULIDUR-RASUL", name: "Maulidur Rasul", nameEn: "Maulidur Rasul", nameZh: "先知诞辰", startDate: "2027-08-15", type: "FESTIVAL", relevance: 3, leadDays: 10,
    angleHint: "Cuti umum keagamaan. Kandungan bernada hormat — elak jualan agresif." },
  { key: "MY-2027-MERDEKA", name: "Hari Kebangsaan", nameEn: "National Day (Merdeka)", nameZh: "国庆日", startDate: "2027-08-31", type: "NATIONAL", relevance: 4, leadDays: 14,
    angleHint: "Semangat kebangsaan. Boleh kaitkan dengan perjalanan merentas negeri — motosikal sebagai cara rakyat Malaysia bergerak. Nada bangga, bukan diskaun." },
  { key: "MY-2027-MALAYSIA-DAY", name: "Hari Malaysia", nameEn: "Malaysia Day", nameZh: "马来西亚日", startDate: "2027-09-16", type: "NATIONAL", relevance: 3, leadDays: 7,
    angleHint: "Cuti panjang hujung minggu. Tumpu pemeriksaan keselamatan ringkas sebelum perjalanan." },
  { key: "MY-2027-DEEPAVALI", name: "Deepavali", nameEn: "Deepavali", nameZh: "屠妖节", startDate: "2027-10-29", type: "FESTIVAL", relevance: 4, leadDays: 14, angleHint: PRE_TRAVEL },
  { key: "MY-2027-MONSOON", name: "Monsun Timur Laut", nameEn: "Northeast monsoon", nameZh: "东北季风", startDate: "2027-11-01", endDate: "2028-03-31", type: "MONSOON", relevance: 4, leadDays: 7,
    angleHint: "Musim hujan bermula. Cengkaman tayar dan brake paling kritikal — keselamatan dalam hujan sebagai tema utama." },
  { key: "MY-2027-CHRISTMAS", name: "Krismas", nameEn: "Christmas Day", nameZh: "圣诞节", startDate: "2027-12-25", type: "FESTIVAL", relevance: 3, leadDays: 14, angleHint: PRE_TRAVEL },
];

/** Payday rows: most Malaysian salaries land on or near the 25th, and discretionary
 *  spending (deferred servicing) follows. Low relevance on purpose — it should surface
 *  only when nothing stronger is in the window. */
export function paydayOccasions(fromYyyyMm: string, months: number): OccasionSeed[] {
  const out: OccasionSeed[] = [];
  const [y0, m0] = fromYyyyMm.split("-").map(Number);
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(y0, m0 - 1 + i, 25));
    const ym = d.toISOString().slice(0, 7);
    out.push({
      key: "MY-PAYDAY-" + ym,
      name: "Hari gaji", nameEn: "Payday", nameZh: "发薪日",
      startDate: ym + "-25", type: "PAYDAY", relevance: 2, leadDays: 3,
      angleHint: "Duit baru masuk. Masa terbaik untuk servis yang selama ini ditangguh — penyelenggaraan tertunggak, tayar, atau tukar minyak.",
    });
  }
  return out;
}

/** UTC midnight for a YYYY-MM-DD string — the project-wide date convention. */
export function utcDay(iso: string): Date {
  return new Date(iso + "T00:00:00Z");
}

export interface OccasionLike {
  startDate: Date | string;
  endDate?: Date | string | null;
  leadDays: number;
}

/**
 * The window in which content about this occasion should run.
 * It OPENS `leadDays` before the date and runs through the end date (or the date itself).
 * This is the whole point: a Raya post published on Raya is worthless.
 */
export function contentWindow(o: OccasionLike): { from: Date; to: Date } {
  const start = typeof o.startDate === "string" ? utcDay(o.startDate) : o.startDate;
  const end = o.endDate ? (typeof o.endDate === "string" ? utcDay(o.endDate) : o.endDate) : start;
  return { from: new Date(start.getTime() - o.leadDays * 86_400_000), to: end };
}

/** Is this occasion's content window open on `date`? */
export function isWindowOpen(o: OccasionLike, date: Date): boolean {
  const { from, to } = contentWindow(o);
  return date >= from && date <= to;
}

/** How many days until the occasion itself (negative once it has passed). */
export function daysUntil(o: OccasionLike, date: Date): number {
  const start = typeof o.startDate === "string" ? utcDay(o.startDate) : o.startDate;
  return Math.round((start.getTime() - date.getTime()) / 86_400_000);
}

export interface RankedOccasion<T> { occasion: T; daysUntil: number; windowOpen: boolean; urgency: number }

/**
 * Rank occasions for planning on `date`.
 *
 * Urgency blends relevance with proximity INSIDE the content window: the closer the date
 * gets while the window is still open, the more urgent it is. Occasions whose window has
 * not opened, or that are already past, fall to the bottom.
 */
export function rankOccasions<T extends OccasionLike & { relevance: number }>(occasions: T[], date: Date): RankedOccasion<T>[] {
  return occasions
    .map((o) => {
      const windowOpen = isWindowOpen(o, date);
      const d = daysUntil(o, date);
      // 0 when the window just opened, rising to relevance*2 on the day itself
      const proximity = d <= 0 ? 1 : Math.max(0, 1 - d / Math.max(1, o.leadDays));
      const urgency = windowOpen ? o.relevance * (0.5 + proximity) : d > 0 ? -d / 1000 : -100;
      return { occasion: o, daysUntil: d, windowOpen, urgency: Math.round(urgency * 1000) / 1000 };
    })
    .sort((a, b) => b.urgency - a.urgency);
}
