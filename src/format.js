/**
 * Turn Matrix's verbose JSON into compact text.
 *
 * These results are read by a model with a finite context, so the goal is
 * maximum signal per token: one line per leg, no repeated boilerplate, and
 * stable rank numbers the follow-up detail call can refer to.
 */

/** "USD9810.93" -> { currency: "USD", value: 9810.93 } */
export function parsePrice(display) {
  if (!display) return { currency: null, value: null };
  const m = String(display).match(/^([A-Z]{3})?\s*\$?\s*([\d,]+(?:\.\d+)?)/);
  if (!m) return { currency: null, value: null };
  return {
    currency: m[1] || null,
    value: Number.parseFloat(m[2].replace(/,/g, "")),
  };
}

export const hm = (min) =>
  min == null ? "?" : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;

/** Matrix returns local times as "2026-10-15T01:30"; keep date + HH:MM only. */
const clock = (iso) => (iso ? iso.slice(11, 16) : "??:??");
const day = (iso) => (iso ? iso.slice(0, 10) : "????-??-??");

/** Arrival on a later calendar day than departure -> "+1", "+2". */
function dayOffset(dep, arr) {
  if (!dep || !arr) return "";
  const d = Math.round(
    (Date.parse(arr.slice(0, 10)) - Date.parse(dep.slice(0, 10))) / 86400000
  );
  return d > 0 ? `+${d}` : "";
}

export function normalizeSolution(sol) {
  const price = parsePrice(sol.displayTotal);
  const slices = (sol.itinerary?.slices || []).map((s) => ({
    origin: s.origin?.code,
    destination: s.destination?.code,
    departure: s.departure,
    arrival: s.arrival,
    flights: s.flights || [],
    cabins: [...new Set(s.cabins || [])],
    durationMinutes: s.duration || 0,
    stops: Math.max(0, (s.flights || []).length - 1),
  }));
  return {
    id: sol.id,
    priceDisplay: sol.displayTotal,
    price: price.value,
    currency: price.currency,
    carriers: (sol.itinerary?.carriers || []).map((c) => c.code),
    totalDurationMinutes: slices.reduce((a, s) => a + s.durationMinutes, 0),
    slices,
  };
}

const SORTS = {
  price: (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
  duration: (a, b) => a.totalDurationMinutes - b.totalDurationMinutes,
  departure: (a, b) =>
    String(a.slices[0]?.departure).localeCompare(String(b.slices[0]?.departure)),
  arrival: (a, b) =>
    String(a.slices.at(-1)?.arrival).localeCompare(String(b.slices.at(-1)?.arrival)),
  stops: (a, b) =>
    a.slices.reduce((n, s) => n + s.stops, 0) -
      b.slices.reduce((n, s) => n + s.stops, 0) ||
    (a.price ?? Infinity) - (b.price ?? Infinity),
};

export function sortSolutions(sols, sort = "price") {
  return [...sols].sort(SORTS[sort] || SORTS.price);
}

/**
 * Matrix often returns the same priced fare several times with different
 * outbound departure times. Keeping every variant buries genuinely different
 * options, so collapse on price + the flight numbers actually flown.
 */
export function dedupe(sols) {
  const seen = new Map();
  for (const s of sols) {
    const key = `${s.priceDisplay}|${s.slices.map((x) => x.flights.join(">")).join("|")}`;
    if (!seen.has(key)) seen.set(key, s);
  }
  return [...seen.values()];
}

export function renderSolutions(sols, { searchId, totalCount, sort } = {}) {
  if (!sols.length) {
    return "No itineraries found. Try relaxing the routing code, raising maxStops, or shifting dates.";
  }
  const lines = [];
  const multi = sols[0].slices.length > 1;
  lines.push(
    `${sols.length} itinerar${sols.length === 1 ? "y" : "ies"}` +
      (totalCount ? ` (of ${totalCount} found)` : "") +
      (sort ? `, sorted by ${sort}` : "")
  );
  lines.push("");

  sols.forEach((s, i) => {
    const stops = s.slices.reduce((n, x) => n + x.stops, 0);
    lines.push(
      `#${i + 1}  ${s.priceDisplay}  ·  ${hm(s.totalDurationMinutes)} total  ·  ` +
        `${stops} stop${stops === 1 ? "" : "s"}  ·  ${s.carriers.join("/")}`
    );
    s.slices.forEach((sl, li) => {
      const label = multi ? `  leg ${li + 1}: ` : "  ";
      lines.push(
        `${label}${sl.origin}→${sl.destination}  ${day(sl.departure)} ` +
          `${clock(sl.departure)}–${clock(sl.arrival)}${dayOffset(
            sl.departure,
            sl.arrival
          )}  ${hm(sl.durationMinutes)}  ` +
          `${sl.flights.join(", ") || "?"}` +
          (sl.cabins.length ? `  [${sl.cabins.join("/")}]` : "")
      );
    });
    lines.push("");
  });

  if (searchId) {
    lines.push(
      `Search ID: ${searchId} — pass this to get_itinerary_details with a rank ` +
        `(#N above) to see fare classes, booking codes, and aircraft.`
    );
  }
  return lines.join("\n");
}

export function renderDetail(booking, fallback) {
  const slices = booking?.itinerary?.slices?.length
    ? booking.itinerary.slices
    : fallback?.itinerary?.slices || [];
  if (!slices.length) return "No booking detail returned for that itinerary.";

  const out = [];
  slices.forEach((sl, i) => {
    // bookingDetails often omits slice-level duration, so derive it from the
    // segments (which includes layovers only if the engine supplied them).
    const dur =
      sl.duration ||
      (sl.segments || []).reduce((a, s) => a + (s.duration || 0), 0) ||
      null;
    out.push(
      `Leg ${i + 1}: ${sl.origin?.code}→${sl.destination?.code}  ` +
        `${day(sl.departure)} ${clock(sl.departure)}–${clock(sl.arrival)}` +
        `${dayOffset(sl.departure, sl.arrival)}  ${hm(dur)}`
    );
    for (const seg of sl.segments || []) {
      const infos = seg.bookingInfos || [];
      const rbd = [...new Set(infos.map((b) => b.bookingCode).filter(Boolean))];
      const cabins = [...new Set(infos.map((b) => b.cabin).filter(Boolean))];
      const fares = [...new Set(infos.map((b) => b.fareBasisCode).filter(Boolean))];
      const aircraft = (seg.legs || [])
        .map((l) => l.aircraft?.shortName)
        .filter(Boolean);
      out.push(
        `   ${seg.carrier?.code || "??"}${seg.flight?.number || "?"}  ` +
          `${seg.origin?.code}→${seg.destination?.code}  ` +
          `${clock(seg.departure)}–${clock(seg.arrival)}  ${hm(seg.duration)}` +
          (cabins.length ? `  ${cabins.join("/")}` : "") +
          (rbd.length ? `  RBD ${rbd.join(",")}` : "") +
          (fares.length ? `  fare ${fares.join(",")}` : "") +
          (aircraft.length ? `  ${[...new Set(aircraft)].join(",")}` : "")
      );
    }
    out.push("");
  });
  return out.join("\n");
}
