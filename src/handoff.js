/*
 * The link builders below are translations of code from ita-matrix-powertools
 * (https://github.com/adamhwang/ita-matrix-powertools), written by paul21,
 * Steppo and Adam Hwang, and licensed GPL-2.0-only. This file is therefore a
 * derivative work and is subject to that licence, which differs from the MIT
 * licence declared in package.json for the rest of the project.
 */

/**
 * Hand-over helpers for a priced itinerary: fare basis per segment, airline
 * deep links, a Great Circle Mapper link and a Where to Credit link.
 *
 * Ported from adamhwang/ita-matrix-powertools (the Chrome/userscript add-on),
 * which does the same in the browser by scraping Matrix's "Copy as JSON".
 * This server receives the same `bookingDetails` payload, so the link builders
 * carry over; only the data source changed.
 *
 * Fare basis lives in `tickets[].pricings[].fares[]`, not on each segment's
 * `bookingInfos`. Each fare lists the segments it covers (origin, destination
 * and booking code), so segments are matched back to their fare by that key.
 */

const CABIN_RANK = { COACH: 0, "PREMIUM-COACH": 1, "PREMIUM-ECONOMY": 1, BUSINESS: 2, FIRST: 3 };
const cabinRank = (c) => CABIN_RANK[String(c || "").toUpperCase()] ?? 0;

const pad2 = (n) => String(n).padStart(2, "0");

/** "2027-06-11T14:20" -> parts. Matrix returns local times with no offset. */
function parts(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return { y: m[1], mo: m[2], d: m[3], hh: m[4], mm: m[5], iso: iso.slice(0, 16) };
}

/** Map "ORIGDESTRBD" -> { code, carrier } from every fare on every ticket. */
export function fareMap(booking) {
  const map = new Map();
  for (const t of booking?.tickets || []) {
    for (const p of t.pricings || []) {
      for (const f of p.fares || []) {
        for (const bi of f.bookingInfos || []) {
          const o = bi.segment?.origin;
          const d = bi.segment?.destination;
          if (o && d && bi.bookingCode) {
            map.set(`${o}${d}${bi.bookingCode}`, { code: f.code, carrier: f.carrier });
          }
        }
      }
    }
  }
  return map;
}

/**
 * Flatten bookingDetails into slices of flights, one entry per flight number
 * (a flight with an intermediate stop stays a single entry, which is what the
 * airline booking links want).
 */
export function flatten(booking) {
  const fares = fareMap(booking);
  return (booking?.itinerary?.slices || []).map((sl) => {
    const segs = (sl.segments || []).map((seg) => {
      const info = seg.bookingInfos?.[0] || {};
      const orig = seg.origin?.code;
      const dest = seg.destination?.code;
      const fare = fares.get(`${orig}${dest}${info.bookingCode}`);
      return {
        carrier: seg.carrier?.code,
        fnr: String(seg.flight?.number ?? ""),
        orig,
        dest,
        dep: parts(seg.departure),
        arr: parts(seg.arrival),
        rbd: info.bookingCode,
        cabin: cabinRank(info.cabin),
        cabinName: info.cabin,
        fare: fare?.code || info.fareBasisCode,
        fareCarrier: fare?.carrier,
      };
    });
    return {
      orig: sl.origin?.code,
      dest: sl.destination?.code,
      dep: parts(sl.departure),
      arr: parts(sl.arrival),
      segs,
    };
  });
}

/** "GBP9737.00" -> { currency: "GBP", value: 9737 } from bookingDetails.displayTotal. */
export function displayPrice(booking) {
  const m = String(booking?.displayTotal || "").match(/^([A-Z]{3})\s*([\d,]+(?:\.\d+)?)/);
  return m ? { currency: m[1], value: Number.parseFloat(m[2].replace(/,/g, "")) } : null;
}

/** Passenger counts for link builders. `pax` is the shape the search used. */
function paxCounts(pax = {}) {
  const adults = (pax.adults ?? 1) + (pax.seniors ?? 0) + (pax.youths ?? 0);
  return {
    adults,
    children: pax.children ?? 0,
    infants: pax.infantsInLap ?? 0,
  };
}

const allSegs = (slices) => slices.flatMap((s) => s.segs);
const carriers = (slices) => new Set(allSegs(slices).map((s) => s.carrier));
const anyOf = (slices, ...codes) => codes.some((c) => carriers(slices).has(c));
const minCabin = (slices) => Math.min(...allSegs(slices).map((s) => s.cabin));
const maxCabin = (slices) => Math.max(...allSegs(slices).map((s) => s.cabin));

/**
 * British Airways "fare quote" deep link. Carries every flight number, date
 * and cabin so the BA site prices that exact itinerary.
 *
 * Upstream writes the departure time from a 12-hour string; 24-hour HHMM is
 * used here because the field is HHMM. Untested against the live BA site.
 */
export function baLink(slices, pax, { edition = "GB", language = "en" } = {}) {
  const cabins = ["M", "W", "C", "F"];
  const n = paxCounts(pax);
  let url =
    `https://www.britishairways.com/travel/fx/public/${language}_${edition}` +
    `?eId=111054&data=F${n.adults}0${n.children}${n.infants}LF`;
  slices.forEach((sl, i) => {
    for (const s of sl.segs) {
      url +=
        `${s.dep.d}${s.dep.mo}${s.dep.y}${s.dep.hh}${s.dep.mm}` +
        `${s.carrier}${s.fnr.padStart(4, "0")}${cabins[s.cabin]}` +
        `${s.orig}${s.dest}${slices.length === 2 && i === 1 ? "F" : "T"}`;
    }
  });
  return url + `&p=EUR6666.66&e=SL&c=${cabins[minCabin(slices)]}&source=FareQuoteEmail&isEmailHBOFareQuote=false`;
}

/** Qantas "partner deep link": flight numbers plus booking class per segment. */
export function qfLink(slices, pax, { edition = "EN_US", currency = "USD" } = {}) {
  const classes = ["ECO", "PRM", "BUS", "FIR"];
  const n = paxCounts(pax);
  let flights = "";
  slices.forEach((sl, i) => {
    sl.segs.forEach((s, j) => {
      flights += `&sdcFlightNumber${i + 1}${j + 1}=${s.carrier}${s.fnr}`;
      flights += `&sdcSegmentRbd${i + 1}${j + 1}=${s.rbd}`;
    });
  });
  const dates = slices.map((sl) => `${sl.dep.y}${sl.dep.mo}${sl.dep.d}0000`).join("%2C");
  return (
    `https://book.qantas.com/qf-booking/dyn/air/tripflow.redirect?APPLICATION_NAME=SDC` +
    `&USER_LANG=EN&USER_LOCALE=${edition}&travelClass=${classes[minCabin(slices)]}` +
    `&numberOfAdults=${n.adults}&numberOfChildren=${n.children}&numberOfInfants=${n.infants}` +
    `&sdcPriceCurrency=${currency}${flights}` +
    `&depAirports=${slices.map((s) => s.orig).join("%2C")}` +
    `&destAirports=${slices.map((s) => s.dest).join("%2C")}` +
    `&travelDates=${dates}&sdcTripPriceAmount=0.00&QFdeviceType=desktop`
  );
}

/**
 * Emirates search link. Unlike BA and QF this does not pin flights or fare, it
 * only pre-fills origin, destination, dates and cabin. Round trips and one-ways
 * only; Emirates' multi-city form is mobile-only and is skipped here.
 */
export function ekLink(slices, pax, { edition = "/global/english" } = {}) {
  if (slices.length > 2) return null;
  if (slices.length === 2 && (slices[0].orig !== slices[1].dest || slices[0].dest !== slices[1].orig)) {
    return null;
  }
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const date = (p) => `${p.d}-${months[Number(p.mo) - 1]}-${p.y.slice(-2)}`;
  const cls = ["0", "0", "1", "2"];
  const n = paxCounts(pax);
  const cab = (sl) => cls[maxCabin([sl])];
  const out = slices[0];
  let url =
    `https://www.emirates.com/sessionhandler.aspx?pageurl=/IBE.aspx&pub=${edition}&j=f&section=IBE&j=t` +
    `&seldcity1=${out.orig}&selacity1=${out.dest}&selddate1=${date(out.dep)}` +
    `&seladults=${n.adults}&selofw=0&selteenager=0&selchildren=${n.children}&selinfants=${n.infants}` +
    `&selcabinclass=${cls[maxCabin(slices)]}&selcabinclass1=${cab(out)}` +
    `&showsearch=false&showTeenager=false&showOFW=false&chkFlexibleDates=false&resultby=0&multiCity=`;
  url += slices.length === 2 ? `&seladate1=${date(slices[1].dep)}&TID=SB` : `&seladate1=&TID=OW`;
  return url;
}

/**
 * American Airlines partner link for the Europe/Asia/Pacific site (aa.com
 * i11l gateway). Pins flights, booking classes and times. Edition is
 * "<language>_<country>", for example "en_IE". Upstream sends every time with a
 * +00:00 offset because Matrix gives local times only; kept as is.
 */
export function aaLink(slices, pax, { edition = "en_IE" } = {}) {
  const [lang, country] = edition.split("_");
  if (!lang || !country) return null;
  const n = paxCounts(pax);
  const stamp = (p) => `${p.y}-${p.mo}-${p.d}T${p.hh}:${p.mm}+00:00`;
  let search = `1,,USD0.00,${slices.length},`;
  const legs = [];
  for (const sl of slices) {
    const segs = sl.segs.map(
      (s) => `${stamp(s.arr)},${s.rbd},${stamp(s.dep)},${s.dest},${s.carrier}${s.fnr},${s.orig}`
    );
    search += `${segs.length},${segs.join(",")},`;
    legs.push(`${sl.dep.y}-${sl.dep.mo}-${sl.dep.d},${sl.dest},,${sl.orig},`);
  }
  search += `DIRECT,${lang.toUpperCase()},3,${n.adults},${n.children},${n.infants},0,${country.toUpperCase()},`;
  search += `${slices.length},${legs.join(",")}`;
  return `http://i11l-services.aa.com/xaa/mseGateway/entryPoint.php?PARAM=${encodeURIComponent(search)}`;
}

/**
 * Iberia partner link (the Travix "googleflights" query format). Pins every
 * flight with its booking class, fare basis and date. Edition is
 * "<language>-<country>", for example "en-GB".
 */
export function ibLink(slices, pax, { edition = "en-GB", price } = {}) {
  const [lang, pos] = edition.split("-");
  if (!lang || !pos) return null;
  const cabins = ["Economy", "Economy", "Business", "First"];
  const n = paxCounts(pax);
  const cur = price?.currency || "USD";
  const trip =
    slices.length === 1
      ? "OneWay"
      : slices.length === 2 && slices[0].orig === slices[1].dest && slices[0].dest === slices[1].orig
        ? "RoundTrip"
        : "MultiCity";
  let q =
    `PointOfSaleCountry=${pos}&UserCurrency=${cur}&DisplayedPrice=${price?.value ?? ""}` +
    `&DisplayedPriceCurrency=${cur}&UserLanguage=${lang}&TripType=${trip}` +
    `&Adult=${n.adults}&Child=${n.children}&InfantLap=${n.infants}`;
  let j = 0;
  slices.forEach((sl, i) => {
    const idx = [];
    for (const s of sl.segs) {
      j++;
      idx.push(j);
      q +=
        `&Cabin${j}=${cabins[s.cabin]}&Carrier${j}=${s.carrier}&Origin${j}=${s.orig}` +
        `&Destination${j}=${s.dest}&BookingCode${j}=${s.rbd}&FlightNumber${j}=${s.fnr}` +
        `&DepartureDate${j}=${s.dep.y}-${s.dep.mo}-${s.dep.d}&FareBasis${j}=${s.fare ?? ""}`;
    }
    q += `&Slice${i + 1}=${idx.join(",")}`;
  });
  return `http://www.iberia.com/web/partnerLink.do?${q}`;
}

/** Great Circle Mapper route map, keeping continuous paths joined. */
export function gcmLink(slices) {
  let p = "";
  for (const sl of slices) {
    sl.segs.forEach((s, j) => {
      p += `${s.orig}-`;
      const next = sl.segs[j + 1];
      if (!next || next.orig !== s.dest) p += `${s.dest};`;
    });
  }
  return `http://www.gcmap.com/mapui?P=${p}`;
}

/** Where to Credit earning calculator, one entry per flight. */
export function wheretocreditLink(slices) {
  return (
    "https://www.wheretocredit.com/calculator#" +
    allSegs(slices)
      .map((s) => [s.orig, s.dest, s.carrier, s.rbd].join("-"))
      .join("/")
  );
}

/**
 * Links that make sense for this itinerary. Airline links appear only when
 * that airline (or a partner it sells) is on the ticket.
 */
export function buildLinks(slices, pax, opts = {}) {
  if (!slices.length || slices.some((s) => !s.segs.length || !s.dep || s.segs.some((g) => !g.dep))) {
    return [];
  }
  const links = [];
  if (anyOf(slices, "BA", "IB", "EI")) {
    links.push(["British Airways", baLink(slices, pax, { edition: opts.baEdition, language: opts.baLanguage })]);
  }
  if (anyOf(slices, "QF", "JQ", "NZ")) {
    links.push(["Qantas", qfLink(slices, pax, { edition: opts.qfEdition, currency: opts.qfCurrency })]);
  }
  if (anyOf(slices, "AA")) {
    const aa = aaLink(slices, pax, { edition: opts.aaEdition });
    if (aa) links.push(["American", aa]);
  }
  if (anyOf(slices, "IB", "BA")) {
    const ib = ibLink(slices, pax, { edition: opts.ibEdition, price: opts.price });
    if (ib) links.push(["Iberia", ib]);
  }
  if (anyOf(slices, "EK")) {
    const ek = ekLink(slices, pax, { edition: opts.ekEdition });
    if (ek) links.push(["Emirates (search only)", ek]);
  }
  links.push(["Route map", gcmLink(slices)], ["Where to Credit", wheretocreditLink(slices)]);
  return links.map(([name, url]) => ({ name, url }));
}

/**
 * Compact brief for a ticketing agent: one line per flight in GDS style, then
 * the distinct fare bases. `DDMMM` dates, booking class, origin and destination.
 */
export function agentBrief(slices) {
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const lines = [];
  for (const sl of slices) {
    for (const s of sl.segs) {
      lines.push(
        `${s.carrier} ${s.fnr} ${s.rbd || "?"} ${s.dep.d}${months[Number(s.dep.mo) - 1]} ` +
          `${s.orig}${s.dest} ${s.dep.hh}${s.dep.mm} ${s.arr?.hh ?? "??"}${s.arr?.mm ?? "??"}` +
          (s.fare ? `  ${s.fare}` : "")
      );
    }
  }
  return lines;
}
