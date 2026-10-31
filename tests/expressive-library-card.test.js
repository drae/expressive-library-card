const { JSDOM } = require("jsdom");
const fs = require("fs");
const dom = new JSDOM(`<!doctype html><body></body>`, { url: "http://localhost/", runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
const NOW = Date.parse("2026-10-31T00:15:00Z"); // Saturday
w.eval(`Date.now = () => ${NOW};`);
w.eval(fs.readFileSync(process.argv[2] ?? `${__dirname}/../expressive-library-card.js`, "utf8"));

const ok = (c, m) => { if (!c) { console.log("FAIL", m); process.exitCode = 1; } else console.log("ok  ", m); };
const later = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const TZ = "Europe/London";
const M = w.customElements.get("expressive-library-card")._model;

// Fixtures in the shapes of the Sonarr/Radarr v3 calendar, Tautulli v2 and the HA integration replies.
const series = (id, title, net, poster) => ({ id, title, network: net, images: [
  { coverType: "poster", remoteUrl: poster }, { coverType: "fanart", remoteUrl: "https://artworks.thetvdb.com/banners/fanart/original/1-1.jpg" }] });
const PINE = series(1, "Pine Ridge (2007) (CA)", "CBC Television", "https://artworks.thetvdb.com/banners/v4/series/1/posters/abc.jpg");
const KITE = series(2, "Kite Runners", "Apple TV", "https://artworks.thetvdb.com/banners/v4/series/2/posters/def.jpg");
const MOSS = series(3, "Moss", "ABC (US)", null);
const ep = (s, se, e, title, at, hasFile = false) => ({ seriesId: s.id, seasonNumber: se, episodeNumber: e, title, airDateUtc: at, hasFile, series: s });
const SONARR = [
  ep(KITE, 1, 1, "Opening", "2026-10-30T04:00:00Z", true),
  ep(KITE, 1, 2, "Second", "2026-10-30T04:54:00Z", true),
  ep(MOSS, 2, 10, "Ten", "2026-10-30T07:00:00Z", true),
  ep(MOSS, 2, 11, "Eleven", "2026-10-30T07:00:00Z", false),
  ep(PINE, 20, 5, "Once Bitten", "2026-11-02T00:00:00Z"),
  ep(KITE, 2, 1, "New season", "2026-11-04T05:00:00Z"),
  ep(PINE, 20, 6, "Extra Mile", "2026-11-09T00:00:00Z"),
];
const film = (title, o) => ({ title, monitored: true, hasFile: false, certification: "15", runtime: 95,
  images: [{ coverType: "poster", remoteUrl: "https://image.tmdb.org/t/p/original/x.jpg" }], ...o });
const RADARR = [
  film("Night Courier", { digitalRelease: "2026-11-03T00:00:00Z", physicalRelease: "2027-02-28T00:00:00Z", inCinemas: "2026-09-16T00:00:00Z" }),
  film("Owned Already", { hasFile: true, digitalRelease: "2026-06-01T00:00:00Z", physicalRelease: "2026-11-04T00:00:00Z" }),
  film("Landed Yesterday", { hasFile: true, digitalRelease: "2026-10-30T00:00:00Z" }),
  film("Cinema Only", { inCinemas: "2026-11-02T00:00:00Z" }),
  film("Disc Only", { physicalRelease: "2026-11-05T00:00:00Z", certification: null, runtime: 0 }),
  film("Not Monitored", { monitored: false, digitalRelease: "2026-11-03T00:00:00Z" }),
  film("Far Off", { digitalRelease: "2026-12-20T00:00:00Z" }),
];
const t = (iso) => Date.parse(iso) / 1000;
const items = M.agendaItems({ sonarr: SONARR, radarr: RADARR }, { days: 7, films: true }, TZ, NOW);
const find = (title) => items.find((i) => i.title === title);
const titles = items.map((i) => i.title);

// agenda model
ok(find("Pine Ridge") && !titles.some((x) => x.includes("(")), "show names lose Sonarr's (2007) (CA)");
ok(find("Pine Ridge").network === "CBC" && items.find((i) => i.title === "Moss").network === "ABC", "networks shortened");
const kite1 = items.find((i) => i.title === "Kite Runners" && i.ep === "S1 E1–2");
ok(kite1 && kite1.have && kite1.premiere && kite1.name === "New series", "two premiere episodes on one day fold into S1 E1–2, New series, on Plex");
const moss = find("Moss");
ok(moss.ep === "S2 E10–11" && moss.name === "2 episodes" && !moss.have, "a day with one episode still missing is not on Plex");
ok(items.find((i) => i.title === "Kite Runners" && i.ep === "S2 E1").name === "Season 2 starts", "a season premiere says so");
ok(!titles.includes("Pine Ridge") || items.filter((i) => i.title === "Pine Ridge").length === 1, "Pine Ridge E6 (9 Nov) is outside 7 days");
const night = find("Night Courier");
ok(night && night.release === "Digital" && night.meta === "15 · 1h 35m" && !night.have, "unreleased film: digital date, certificate and runtime");
ok(!titles.includes("Owned Already"), "a film already on disk with a later disc release is left out");
ok(find("Landed Yesterday")?.have === true, "a film released yesterday and downloaded shows On Plex");
ok(!titles.includes("Cinema Only"), "cinema releases are left out");
ok(find("Disc Only")?.release === "Blu-ray" && find("Disc Only").meta === "", "physical-only release is Blu-ray, no empty meta");
ok(!titles.includes("Not Monitored") && !titles.includes("Far Off"), "unmonitored and out-of-window films are left out");
ok(items.every((x, i) => i === 0 || items[i - 1].at <= x.at), "sorted by time");
const tvOnly = M.agendaItems({ sonarr: SONARR, radarr: RADARR }, { days: 14, films: false }, TZ, NOW);
ok(tvOnly.every((i) => i.kind === "tv") && tvOnly.filter((i) => i.title === "Pine Ridge").length === 2, "films: false and 14 days");

// artwork
ok(M.thumb("https://artworks.thetvdb.com/banners/v4/series/1/posters/abc.jpg").endsWith("abc_t.jpg"), "TVDB poster uses the _t thumbnail");
ok(M.thumb("https://image.tmdb.org/t/p/original/x.jpg") === "https://image.tmdb.org/t/p/w154/x.jpg", "TMDB poster uses w154");

// unwatched: Plex episodes (TV library, type 4) and films, viewCount for the token's account
const PLEX_EPS = [
  { grandparentTitle: "Moss", addedAt: t("2026-10-30T07:31:00Z") },
  { grandparentTitle: "Moss", addedAt: t("2026-10-30T07:29:00Z") },
  { grandparentTitle: "Kite Runners", addedAt: t("2026-10-30T01:33:00Z"), viewCount: 2 },
  { grandparentTitle: "Pine Ridge", addedAt: t("2026-10-25T14:13:00Z") },
  { grandparentTitle: "Old Show", addedAt: t("2026-10-12T14:13:00Z") },
];
const PLEX_FILMS = [
  { title: "Sky Film", addedAt: t("2026-10-28T21:56:00Z") },
  { title: "Seen Film", addedAt: t("2026-10-27T06:14:00Z"), viewCount: 1 },
  { title: "Old Film", addedAt: t("2026-10-13T07:15:00Z") },
];
ok(M.unwatched(PLEX_EPS, PLEX_FILMS, NOW) === 3, "unwatched: Moss, Pine Ridge, Sky Film (one per show, past 7 days, not watched)");

// queues and health in the Sonarr/Radarr v3 shapes
const SQ = { records: [
  { status: "completed", trackedDownloadStatus: "warning", trackedDownloadState: "importBlocked", series: PINE, episode: { seasonNumber: 20, episodeNumber: 5 },
    statusMessages: [{ title: "x", messages: ["Not an upgrade for existing episode file(s)"] }] },
  { status: "downloading", trackedDownloadStatus: "ok", trackedDownloadState: "downloading", series: KITE, episode: { seasonNumber: 2, episodeNumber: 1 },
    size: 2.1e9, sizeleft: 0.7e9, timeleft: "00:04:12" },
  { status: "queued", trackedDownloadStatus: "ok", trackedDownloadState: "downloading", series: MOSS, episode: { seasonNumber: 2, episodeNumber: 12 }, size: 1e9, sizeleft: 1e9 },
] };
const RQ = { records: [
  { status: "failed", trackedDownloadStatus: "error", trackedDownloadState: "failedPending", movie: { title: "Night Courier", images: [] }, errorMessage: "Download failed" },
] };
const RH = [{ source: "IndexerStatusCheck", type: "warning", message: "Indexers unavailable due to failures" }];
const probs = M.problemRows({ sonarr_queue: SQ, radarr_queue: RQ, sonarr_health: [], radarr_health: RH });
ok(probs.length === 3 && probs[0].level === "error" && probs[0].title === "Night Courier" && probs[0].sub === "Radarr · download failed", "problems: errors first, Radarr download failed");
ok(probs.some((p) => p.title === "Pine Ridge · S20 E5" && p.sub === "Sonarr · import blocked" && p.why.startsWith("Not an upgrade")), "import blocked with Sonarr's reason");
ok(probs.some((p) => p.title === "Radarr health" && p.icon && p.why === "Indexers unavailable due to failures"), "health warning row");
const dl = M.downloadRows({ sonarr_queue: SQ, radarr_queue: RQ });
ok(dl.length === 2 && dl[0].title === "Kite Runners · S2 E1" && dl[0].sub === "1.4 of 2.1 GB · 4 min left" && Math.round(dl[0].pct) === 67 && dl[0].active, "download row: progress and time left");
ok(dl[1].sub === "Queued" && !dl[1].active, "queued download");
ok(M.timeLeft("1.02:30:00") === "26 h 30 min left" && M.timeLeft("") === "", "time left parsing");
const SESSIONS = [{ media_type: "episode", grandparent_title: "Moss", parent_media_index: "2", media_index: "11", title: "Eleven",
  player: "LG TV", transcode_decision: "direct play", duration: "3000000", view_offset: "1620000", progress_percent: "54", user: "someone" }];
const sr = M.streamRows(SESSIONS)[0];
ok(sr.title === "Moss · S2 E11" && sr.sub === "LG TV · direct play · 23 min left" && sr.pct === 54 && !sr.sub.includes("someone"), "stream row: show, player, how, time left, no user name");

// rendering with a fake hass
const calls = [];
let busy = false;
let states = { "sensor.tautulli_watching": { state: "0" }, "sensor.sabnzbd_speed": { state: "0.0" } };
const reply = (content) => ({ response: { status: 200, content } });
const hass = () => ({
  states: { ...states },
  config: { time_zone: TZ },
  callWS: async (m) => {
    calls.push(m);
    const s = `${m.domain}.${m.service}`;
    switch (s) {
      case "rest_command.sonarr_calendar": return reply(SONARR);
      case "rest_command.radarr_calendar": return reply(RADARR);
      case "rest_command.plex_recent_episodes": return reply({ MediaContainer: { Metadata: PLEX_EPS } });
      case "rest_command.plex_recent_films": return reply({ MediaContainer: { Metadata: PLEX_FILMS } });
      case "rest_command.sonarr_queue": return reply(busy ? SQ : { records: [] });
      case "rest_command.radarr_queue": return reply(busy ? RQ : { records: [] });
      case "rest_command.sonarr_health": return reply([]);
      case "rest_command.radarr_health": return reply(busy ? RH : []);
      case "rest_command.tautulli_activity": return reply({ response: { data: { sessions: SESSIONS } } });
    }
    throw new Error(`unexpected ${s}`);
  },
});
const mk = (c) => { const el = w.document.createElement("expressive-library-card"); el.setConfig(c); el.hass = hass(); w.document.body.append(el); return el; };
const $ = (el, s) => el.shadowRoot.querySelector(s);
const $$ = (el, s) => [...el.shadowRoot.querySelectorAll(s)];

(async () => {
  try { w.document.createElement("expressive-library-card").setConfig({ show: "posters" }); ok(false, "should throw"); }
  catch (e) { ok(/show must be one of/.test(e.message), "rejects an unknown show"); }

  const cards = Object.fromEntries(["glance", "attention", "streaming", "downloads", "agenda"].map((k) => [k, mk({ show: k })]));
  await later(20);
  const rest = calls.filter((c) => c.domain === "rest_command");
  ok(rest.filter((c) => c.service === "sonarr_calendar").length === 1 && rest.filter((c) => c.service === "sonarr_queue").length === 1, "five cards share one fetch");
  ok(rest.every((c) => c.return_response === true) && rest.find((c) => c.service === "sonarr_calendar").service_data.days === 7, "rest commands asked for responses, days passed");
  ok(!rest.some((c) => c.service === "tautulli_activity"), "no activity call while nobody is watching");

  const g = cards.glance;
  ok($(g, ".name").textContent === "Server" && $(g, ".hsub").textContent === "Plex · Sonarr · Radarr", "glance heading");
  const btn = $$(g, ".ssm").map((b) => [b.querySelector(".l").textContent, b.querySelector(".n").textContent]);
  ok(JSON.stringify(btn) === '[["3","Unwatched"],["0","Problems"]]', `glance buttons ${JSON.stringify(btn)}`);
  ok(!$(g, ".ssm.alert"), "Problems button not amber at 0");
  ok($(cards.attention, ".msg").textContent === "Nothing needs attention" && $(cards.downloads, ".msg").textContent === "Queue empty"
     && $(cards.streaming, ".msg").textContent === "Nobody watching", "quiet messages");
  ok($(cards.agenda, ".name").textContent === "Coming up" && /due · next 7 days$/.test($(cards.agenda, ".hsub").textContent), "agenda heading");
  const days = $$(cards.agenda, ".day span:first-child").map((x) => x.textContent);
  ok(days[0] === "Yesterday" && days.includes("Monday"), `day groups (${days.join(", ")})`);
  ok($$(cards.agenda, ".pill.have").length === items.filter((i) => i.have).length, "On Plex ticks");

  // something's up: problems, a stream, downloads
  busy = true;
  states = { "sensor.tautulli_watching": { state: "1" }, "sensor.sabnzbd_speed": { state: "38.2" } };
  Object.values(cards).forEach((c) => { c.hass = hass(); });
  await later(20);
  ok(calls.some((c) => c.service === "tautulli_activity"), "activity fetched once someone is watching");
  ok($$(g, ".ssm .l")[1].textContent === "3" && $(g, ".ssm.alert .n").textContent === "Problems", "Problems button counts and turns amber");
  const a = cards.attention;
  ok($(a, ".hsub").textContent === "3 problems" && $(a, ".hsub").classList.contains("live"), "attention heading");
  ok($$(a, ".ar").length === 3 && $(a, ".pill.err").textContent === "Error" && $(a, ".why").textContent.length > 0, "attention rows with pills and reasons");
  ok($(cards.streaming, ".hsub").textContent === "1 now" && $(cards.streaming, ".ti").textContent === "Moss · S2 E11", "streaming block");
  ok($(cards.downloads, ".hsub").textContent === "2 in queue · 38 MB/s" && $$(cards.downloads, ".ar").length === 2, "downloads block, problems left out");

  // errors
  Object.values(cards).forEach((c) => c.remove());
  const bad = w.document.createElement("expressive-library-card");
  bad.setConfig({ show: "agenda", services: { sonarr: "rest_command.missing", radarr: "rest_command.missing" } });
  M.store.data = {}; M.store.slowAt = 0;
  bad.hass = hass(); w.document.body.append(bad);
  await later(20);
  ok($(bad, ".msg")?.textContent === "Couldn’t reach Sonarr", "a message instead of rows when Sonarr can't be reached");
})().finally(() => w.close());
