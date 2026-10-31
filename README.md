# Expressive Library Card

What's on the media server and what's coming, for Home Assistant. Five views of one shared data set, each drawing its own block heading:

- **glance**: two buttons in the style of a `sensor_small` button-card: **Unwatched** (added to Plex in the past 7 days and not watched yet) and **Problems** (queue problems and health warnings; the icon turns amber above 0).
- **attention**: each queue problem (import blocked, download failed…) and health warning, with Sonarr's or Radarr's reason.
- **streaming**: what's playing on Plex now (Tautulli).
- **downloads**: the download queue with progress and time left.
- **agenda**: yesterday onwards by day, each show or film with its poster and a green **On Plex** tick once it has downloaded.

All views share one fetch, which only runs while a card is on screen. Hide the attention, streaming and downloads blocks with dashboard `visibility` conditions when they have nothing to show.

## Data

| What | From |
| --- | --- |
| Episodes, films, posters, downloaded state | `rest_command`s for the Sonarr and Radarr `/api/v3/calendar` APIs |
| Queue, problems and reasons | `rest_command`s for `/api/v3/queue` and `/api/v3/health` |
| Unwatched | `rest_command`s for Plex's recently added episodes and films (watched state of the token's account) |
| Streams | `rest_command` for Tautulli `get_activity` |
| Download speed | `sensor.sabnzbd_speed` |

Air times are US broadcast times; episodes are grouped by the day they air in the Home Assistant time zone. Films use their digital release, or the disc release if there's no digital one; cinema releases are left out.

An example package with the rest commands, problem sensors and an alert automation is in [`media_library.yaml`](media_library.yaml).

## Config

```yaml
type: custom:expressive-library-card
show: glance            # glance, attention, streaming, downloads or agenda
name: Server            # block heading; defaults per view
days: 7                 # agenda look-ahead, 1–30
films: true             # include Radarr releases in the agenda
services:               # defaults shown
  sonarr: rest_command.sonarr_calendar
  radarr: rest_command.radarr_calendar
  sonarr_queue: rest_command.sonarr_queue
  radarr_queue: rest_command.radarr_queue
  sonarr_health: rest_command.sonarr_health
  radarr_health: rest_command.radarr_health
  plex_episodes: rest_command.plex_recent_episodes
  plex_films: rest_command.plex_recent_films
  activity: rest_command.tautulli_activity
entities:               # defaults shown
  watching: sensor.tautulli_watching
  download_speed: sensor.sabnzbd_speed
styles:                 # element: CSS block; bare numbers become px
  row:
    padding: 8
```

Elements: `heading`, `name`, `sub`, `button`, `value`, `label`, `disc`, `row`, `poster`, `title`, `subtitle`, `reason`, `pill`, `day`, `bar`.

## Licence

BSD-3-Clause. Copyright (c) 2026 Paul Owen.
