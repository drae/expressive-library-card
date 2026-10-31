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
const t = (iso) => String(Date.parse(iso) / 1000);
const RECENT = [
  { media_type: "season", parent_title: "Kite Runners", title: "Season 1", added_at: t("2026-10-30T01:33:00Z") },
  { media_type: "episode", grandparent_title: "Moss", title: "Ten", added_at: t("2026-10-30T08:00:00Z") },
  { media_type: "episode", grandparent_title: "Moss", title: "Nine", added_at: t("2026-10-29T08:00:00Z") },
  { media_type: "movie", title: "Sky Film", added_at: t("2026-10-28T21:56:00Z") },
  { media_type: "album", title: "Some Album", added_at: t("2026-10-30T00:00:00Z") },
  { media_type: "movie", title: "Old Film", added_at: t("2026-10-13T07:15:00Z") },
];
const PLAYS = { categories: ["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"],
  series: [{ name: "TV", data: [0, 2, 2, 0, 3, 16, 2, 0] }, { name: "Movies", data: [0, 2, 0, 3, 1, 0, 0, 0] }, { name: "Live TV", data: [2, 4, 5, 5, 12, 8, 4, 0] }] };
const LIBS = [{ section_type: "movie", count: "236" }, { section_type: "show", count: "75" }, { section_type: "artist", count: "781" }];
const SESSIONS = [{ media_type: "episode", grandparent_title: "Moss", parent_media_index: "2", media_index: "11", title: "Eleven",
  player: "LG TV", transcode_decision: "direct play", duration: "3000000", view_offset: "1620000", progress_percent: "54", user: "someone" }];
const DISKS = { disks: { "/": { path: "/", free_space: 5e10, total_space: 1e11 }, "/mnt/media": { path: "/mnt/media", free_space: 5301613232128, total_space: 15765243691008 } } };
const QUEUE = { shows: { "Pine.Ridge.S20E05": { title: "Pine Ridge (2007) (CA)", season_number: 20, episode_number: 5, size: 2.1e9, size_left: 0.7e9, download_client: "SABnzbd" } } };

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

// glance model
ok(M.newThisWeek(RECENT, NOW) === 3, "new this week: one per show or film, no music, last 7 days");
const pd = M.playsByDay(PLAYS);
ok(pd.length === 7 && pd.reduce((a, x) => a + x.n, 0) === 31 && pd.at(-1).n === 0, "plays: last 7 days, TV + films only");
ok(JSON.stringify(M.libraryCounts(LIBS)) === '{"films":236,"shows":75}', "library counts");
const sr = M.streamRows(SESSIONS)[0];
ok(sr.title === "Moss · S2 E11" && sr.sub === "LG TV · direct play · 23 min left" && sr.pct === 54 && !sr.sub.includes("someone"), "stream row: show, player, how, time left, no user name");
const qr = M.queueRows(QUEUE.shows, {}, "38")[0];
ok(qr.title === "Pine Ridge · S20 E5" && qr.sub === "SABnzbd · 1.4 of 2.1 GB · 38 MB/s" && Math.round(qr.pct) === 67, "download row from the Sonarr queue");

// rendering with a fake hass
const calls = [];
let states = {
  "sensor.tautulli_watching": { state: "0" }, "sensor.sonarr_queue": { state: "0" },
  "sensor.radarr_queue": { state: "0" }, "sensor.sabnzbd_speed": { state: "0.0" },
};
const reply = (content) => ({ response: { status: 200, content } });
const hass = () => ({
  states: { ...states },
  config: { time_zone: TZ },
  callWS: async (m) => {
    calls.push(m);
    if (m.type === "config_entries/get") return [{ entry_id: `e-${m.domain}`, state: "loaded" }];
    const s = `${m.domain}.${m.service}`;
    if (s === "rest_command.sonarr_calendar") return reply(SONARR);
    if (s === "rest_command.radarr_calendar") return reply(RADARR);
    if (s === "rest_command.tautulli_recently_added") return reply({ response: { data: { recently_added: RECENT } } });
    if (s === "rest_command.tautulli_plays") return reply({ response: { data: PLAYS } });
    if (s === "rest_command.tautulli_libraries") return reply({ response: { data: LIBS } });
    if (s === "rest_command.tautulli_activity") return reply({ response: { data: { sessions: SESSIONS } } });
    if (s === "sonarr.get_diskspace") return { response: DISKS };
    if (s === "sonarr.get_queue") return { response: QUEUE };
    if (s === "radarr.get_queue") return { response: { movies: {} } };
    throw new Error(`unexpected ${s}`);
  },
});
const mk = (c) => { const el = w.document.createElement("expressive-library-card"); el.setConfig(c); el.hass = hass(); w.document.body.append(el); return el; };
const $ = (el, s) => el.shadowRoot.querySelector(s);
const $$ = (el, s) => [...el.shadowRoot.querySelectorAll(s)];

(async () => {
  try { w.document.createElement("expressive-library-card").setConfig({ show: "posters" }); ok(false, "should throw"); }
  catch (e) { ok(/glance or agenda/.test(e.message), "rejects an unknown show"); }

  const glance = mk({ show: "glance" });
  const agenda = mk({ show: "agenda" });
  await later(20);
  const rest = calls.filter((c) => c.type === "call_service" && c.domain === "rest_command");
  ok(rest.filter((c) => c.service === "sonarr_calendar").length === 1, "two cards share one fetch");
  ok(rest.every((c) => c.return_response === true) && rest.find((c) => c.service === "sonarr_calendar").service_data.days === 7, "rest commands asked for responses, days passed");
  ok(!rest.some((c) => c.service === "tautulli_activity") && !calls.some((c) => c.service === "get_queue"), "no activity or queue calls while idle");

  ok($(glance, ".name").textContent === "Server" && $(glance, ".hsub").textContent === "Plex · Sonarr · Radarr", "glance heading");
  const stats = $$(glance, ".stat b").map((b) => b.textContent);
  ok(JSON.stringify(stats) === JSON.stringify(["3", String(items.filter((i) => !i.have).length), "0"]), "glance stats: new, due, streaming");
  ok($(glance, ".quiet")?.textContent.includes("Nothing streaming or downloading"), "idle line");
  ok($(glance, ".lr .tm").textContent === "Media disk · 5.3 TB free of 15.8", "disk from the Sonarr disk path");
  ok($$(glance, ".spark i").length === 7 && $(glance, ".card").textContent.includes("31 plays this week") && $(glance, ".card").textContent.includes("236 films · 75 shows"), "plays sparkline and library counts");

  ok($(agenda, ".name").textContent === "Coming up" && /due · next 7 days$/.test($(agenda, ".hsub").textContent), "agenda heading");
  const days = $$(agenda, ".day span:first-child").map((s) => s.textContent);
  ok(days[0] === "Yesterday" && days.includes("Monday") && !days.includes("Today"), `day groups (${days.join(", ")})`);
  const rows = $$(agenda, ".ar");
  ok(rows.length === items.length, "one row per item");
  ok($$(agenda, ".pill.have").length === items.filter((i) => i.have).length, "On Plex ticks");
  const pine = rows.find((r) => r.textContent.includes("Pine Ridge"));
  ok(pine.querySelector(".pill.due").textContent === "morning" && pine.querySelector(".tm").textContent === "CBC", "due episode: day part and network");
  ok(rows.find((r) => r.textContent.includes("Moss")).querySelector(".noimg"), "a show without a poster gets a blank tile");

  // a stream starts and a download appears
  states = { ...states, "sensor.tautulli_watching": { state: "1" }, "sensor.sonarr_queue": { state: "1" }, "sensor.sabnzbd_speed": { state: "38.2" } };
  glance.hass = hass(); agenda.hass = hass();
  await later(20);
  ok(calls.some((c) => c.service === "tautulli_activity") && calls.some((c) => c.domain === "sonarr" && c.service === "get_queue" && c.service_data.entry_id === "e-sonarr"), "activity and queue fetched once things happen");
  const acts = $$(glance, ".ac .ti").map((x) => x.textContent);
  ok(acts[0] === "Moss · S2 E11" && acts[1] === "Pine Ridge · S20 E5", "stream and download rows");
  ok($$(glance, ".stat b")[2].textContent === "1" && !$(glance, ".quiet"), "streaming count, no idle line");

  // errors
  glance.remove(); agenda.remove();
  const bad = w.document.createElement("expressive-library-card");
  bad.setConfig({ show: "agenda", services: { sonarr: "rest_command.missing", radarr: "rest_command.missing" } });
  M.store.data = {}; M.store.at = 0;
  bad.hass = hass(); w.document.body.append(bad);
  await later(20);
  ok($(bad, ".msg")?.textContent === "Couldn’t reach Sonarr", "a message instead of rows when Sonarr can't be reached");
})().finally(() => w.close());
