# Expressive Library Card

What's on the media server and what's coming, for Home Assistant. Two views of one shared data set:

- **glance** — new on Plex this week, episodes and films due, streams in progress, downloads, media disk space and plays per day.
- **agenda** — yesterday onwards by day: each show or film with its poster, a green **On Plex** tick once it has downloaded, or the time of day / *Premiere* / *Digital* / *Blu-ray* while you wait.

Both cards draw their own block heading and share one fetch, which only runs while a card is on screen.

## Data

| What | From |
| --- | --- |
| Episodes, films, posters, downloaded state | `rest_command`s for the Sonarr and Radarr `/api/v3/calendar` APIs |
| New on Plex, plays per day, library counts, stream details | `rest_command`s for the Tautulli API |
| Streaming count | Tautulli integration (`sensor.tautulli_watching`) |
| Downloads | Sonarr / Radarr integrations (`get_queue`, queue sensors) and SABnzbd speed |
| Disk space | Sonarr integration (`sonarr.get_diskspace`) |

Air times are US broadcast times; episodes are grouped by the day they air in the Home Assistant time zone. Films use their digital release, or the disc release if there's no digital one; cinema releases are left out.

An example package with the rest commands is in [`media_library.yaml`](media_library.yaml). Keys stay in `secrets.yaml`.

## Config

```yaml
type: custom:expressive-library-card
show: glance            # or agenda
name: Server            # block heading; default Server / Coming up
days: 7                 # agenda look-ahead, 1–30
films: true             # include Radarr releases
disk_path: /mnt/media   # Sonarr disk path for the disk bar
services:               # defaults shown
  sonarr: rest_command.sonarr_calendar
  radarr: rest_command.radarr_calendar
  recently_added: rest_command.tautulli_recently_added
  plays: rest_command.tautulli_plays
  libraries: rest_command.tautulli_libraries
  activity: rest_command.tautulli_activity
entities:               # defaults shown
  watching: sensor.tautulli_watching
  sonarr_queue: sensor.sonarr_queue
  radarr_queue: sensor.radarr_queue
  download_speed: sensor.sabnzbd_speed
styles:                 # element: CSS block; bare numbers become px
  row:
    padding: 8
```

Elements: `heading`, `name`, `sub`, `card`, `stats`, `stat`, `row`, `poster`, `title`, `subtitle`, `pill`, `day`, `bar`, `spark`.

## Licence

BSD-3-Clause. Copyright (c) 2026 Paul Owen.
