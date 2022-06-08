# SubAgent

## What is SubAgent?
A self-contained <b>Subtitle Agent</b> that looks at your disk, figures out what movies are there by matching with [imdb](https://imdb.com). Then, subtitles are downloaded from [opensubtitles](https://opensubtitles.com). The subtitles are then synced with [subsync](https://github.com/sc0ty/subsync) software. Supports multiple languages. See [subsync](https://github.com/sc0ty/subsync) for more information about language support and how it sync subtitles.

## Why use SubAgent?
Fetching good and in-sync subtitles for your movie library is hard. SubAgent is attempting to automate that for you.

## What if the subtitles are bad and sync fails?
In order to ensure the best subtitle is fetched for you, up to 5 subtitles per movie per language can be downloaded and synced. The best one is the one stored for you. Usually, only 1 or 2 are downloaded because the fit for the most popular subtitles are usually very good. If all subtitle sync results are bad for a certain language, no subtitle is stored for that video file in that language. It can be benificial to use more languages if you have problems with achiving synced subtitle with a certain language. In this case, specify a language with a good language model (like english) first, and your other subtitle language afterwards.

## I don't want to bloat my movie library with subtitle files
The subtitle files are stored next to the movie file with the name:
`${movie_filename}.subagent-GENERATED.${language}.${extension}`, so if you want to remove the downloaded subtitles, it is easy to search them up and delete them. Just be aware that SubAgent will re-download subtitles that you manually removed the next time it scans your library.

Subtitle filename example: 
- `Big.Buck.Bunny.mkv` will have synced english subtitles called:
- `Big.Buck.Bunny.mkv.subagent-GENERATED.en.srt`

In this example, if `Big.Buck.Bunny.mkv` is removed, `Big.Buck.Bunny.mkv.subagent-GENERATED.en.srt` will be considered a dangling subtitle. Dangling subtitles are removed after each scan if `subagent` is started with the `--clean` flag. Without the `--clean` flag, subagent will not delete anything from your drive.

## A word of advice
* The sync part can take a long time (30 > minutes) so if your library is large, this can easily go on for days for an initial sync. It is recommended to watch the log for the first run to ensure that everything is running smoothly.

* Leeching from [opensubtitles](https://opensubtitles.com) or [imdb](https://imdb.com) is not what's intended with SubAgent. A caching layer attempts to minimize the number of requests to any third parties. Make sure to map and specify a cache volume to fully utilize this. Don't blame me if your ip is banned by third parties because you sacked your cache files.

* The number of subtitle downloads per day is restriced for [opensubtitles](https://opensubtitles.com). If the maximum limit for 1 day is reached, subagent will wait until the restriction has been lifted.

## Caveats:
- Movie matching can sometimes be wrong. There is no way of manually fixing those matches except by renaming the file. 
- The whole process is pretty slow, but subtitle match is very promising. This is mainly thanks to subsync.
- Only supports movies for now (not TV series/anime)
- Only published as a docker image. Don't ask for a supported native version or other platforms like Windows. This is just too much work and not worth the effort. Just use docker lol.
- Only supports [imdb](https://imdb.com) and [opensubtitles](https://opensubtitles.com) for matching and subtitle lookup.

## How to use
You can run `subagent` using docker. 

BEFORE YOU START:
- You can add as many languages as you like at the end as long as they are supported by `subsync`. <b>USE 2-LETTER LANGUAGE CODES</b>. Find yours [here](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes).
- It is recommended to start with only one language, just to make sure everything works properly.
- For best sync result, is recommended to use `english` (or another language with a good language model) for the first language and less common languages afterwards.

### Use with `english` subtitles only:
```sh
docker run --name subagent -v /path/to/movies:/movies -v /path/to/cache:/cache gronis/subagent --cache /cache /movies en
```
### Use `english`, `deutsch` and `spanish` subtitles. Also clean up dangling subtitles:
```sh
docker run --name subagent -v /path/to/movies:/movies -v /path/to/cache:/cache gronis/subagent --clean --cache /cache /movies en de es
```

### Docker Compose Example
Put in a file called `docker-compose.yaml`. This example fetches subtitles for `english`, `deutsch` and `spanish`. Replace `/path/to/movies` with your movie library path.

```yaml
version: "3.6"

services:
  subagent:
    image: gronis/subagent
    restart: unless-stopped
    command: ["--cache", "/cache", "--clean", "/movies", "en", "de", "es"]
    volumes:
      - /path/to/movies:/movies
      - cache:/cache
volumes:
  cache
```
Start by typing `docker-compose up -d` in a terminal.

## Useful commands
List all synced subtitles with score less than 25:
```bash
docker exec subagent node -e "console.log(Object.entries(JSON.parse(require('fs').readFileSync('./cache/subtitle_metadata_database.json').toString())).sort(([p1, i1], [p2, i2]) => i1.sync_result.score - i2.sync_result.score).map(([p,i]) => ({ p, s: i.sync_result.score})).filter(i => i.s < 25))"
```
Print specific result for a certain video
```bash
docker exec subagent node -e "console.log(Object.entries(JSON.parse(require('fs').readFileSync('./cache/subtitle_metadata_database.json').toString())).find(([p, i]) => p.includes('/path/to/subtitle.srt')))"
```

## Development
Development assumes the following folders exists in project root:
- `mov`: Video files to fetch subs and use for sync
- `cache`: Cache http-requests, original subs, and sync results.

All commands assumes project root is current working directory.

### Run on host machine
Make sure `subsync` and `nodejs` is installed and works from a shell window. Then, the project can run locally using:
```bash
node subagent --cache cache mov en
```

### Build Docker Image
```bash
docker build . -t gronis/subagent
```

### Run Docker Image
```bash
docker run --rm -it -v "$(pwd)/mov:/mov" -v "$(pwd)/cache:/cache" --name subagent gronis/subagent --cache /cache --clean mov en
```
run `docker stop subagent` to stop.

## Attention!
Use SubAgent at your own risk. There is no 100% guarantee that your library won't be ruined when running SubAgent. Make sure to keep all data you care about backed-up. Be sure to follow the 3-2-1 rule for backups.
