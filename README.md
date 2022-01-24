# SubAgent

## What is SubAgent?
A self-contained <b>Subtitle Agent</b> that looks at your disk, figures out what movies are there by matching with [imdb](https://imdb.com). Then, subtitles are downloaded from [opensubtitles](https://opensubtitles.com). The subtitles are then synced with [subsync](https://github.com/sc0ty/subsync) software. Supports multiple languages. See [subsync](https://github.com/sc0ty/subsync) for more information about language support and how it sync subtitles.

## Why use SubAgent?
Fetching good and in-sync subtitles for your movie library is hard. SubAgent is attempting to automate that for you.

## What if the subtitles are bad and sync fails?
In order to ensure the best subtitle is fetched for you, up to 5 subtitles per movie per language can be downloaded and synced. The best one is the one stored for you. Usually, only 1 or 2 are downloaded because the fit for the most popular subtitles are usually very good.

## I don't want to bloat my movie library with subtitle files
The subtitle files are stored next to the movie file with added suffix:
`${movie_filename}.subagent-GENERATED.${language}.${extension}`, so if you want to remove the downloaded subtitles, it is easy to search them up and delete them. Just be aware that SubAgent will re-download subtitles that you manually removed the next time it scans your library.

## A word of advice
* The sync part can take a long time (30 > minutes) so if your library is large, this can easily go on for days for an initial sync. It is recommended to watch the log for the first run to ensure that everything is running smoothly.

* Leeching from [opensubtitles](https://opensubtitles.com) or [imdb](https://imdb.com) is not what's intended with SubAgent. A caching layer attempts to minimize the number of requests to any third parties. Make sure to map and specify a cache volume to fully utilize this. Don't blame me if your ip is banned by third parties because you sacked your cache files.

* The number of subtitle downloads per day is restriced for [opensubtitles](https://opensubtitles.com). If the maximum limit for 1 day is reached, subagent will wait until the restriction has been lifted.

## Current caveats:
- Movie matching can sometimes we wrong. There is no way of manually fixing those matches except by renaming the file. 
- The whole process is pretty slow, but subtitle match is promising.
- Only supports movies for now (not TV series/anime)
- Only published as a docker image. Don't ask for a supported native version or other platforms like Windows. This is just too much work and not worth the effort. Just use docker lol.

## How to use
Just run this docker command to start a subagent daemon. You can add as many languages as you like at the end as long as they are supported by `subsync`. <b>USE 2-LETTER LANGUAGE CODES</b>. Find yours [here](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes). It is recommended to start with only one language, just to make sure everything works properly.

### Use with english subtitles only
```sh
docker run --name subagent -v /path/to/movies:/movies -v /path/to/cache:/cache gronis/subagent --cache /cache /movies en
```
### Use english, deutsch and spanish subtitles
```sh
docker run --name subagent -v /path/to/movies:/movies -v /path/to/cache:/cache gronis/subagent --cache /cache /movies en de es
```

### Docker Compose Example
Put in a file called `docker-compose.yaml`
```yaml
version: "3.6"

services:
  subagent:
    image: gronis/subagent
    restart: unless-stopped
    command: ["--cache", "/cache", "/movies", "en", "sv"]
    volumes:
      - /path/to/movies:/movies
      - cache:/cache
volumes:
  cache
```
Start by typing `docker-compose up -d` in a terminal.

## Attention!
Use SubAgent at your own risk. There is no 100% guarantee that your library won't be ruined when running SubAgent. Make sure to keep all data you care about backed-up. Be sure to follow the 3-2-1 rule for backups.