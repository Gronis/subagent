# subagent
A self-contained subtitle agent that looks at your disk, figures out what movies are there by matching with imdb. Then, subtitle is downloaded from opensubtitles.org. The subtitle is then synced with subsync software. Supports multiple languages.

The subtitle files are stored next to the movie file with added suffix:
`${movie_filename}.subagent-GENERATED.${language}.${extension}`, so if you don't want to remove the downloaded subtitles, it is easy to search them up and delete them.

Warning: The sync part can take a long time (5-30 minutes) so if your library is large, this can easily go on for days for an initial sync. It is recommended to watch the log for the first run to ensure that everyting is running smoothly.

In order to ensure the best subtitle is fetched for you, up to 5 subtitle files are downloaded and synced. The best one is stored on disk.

Current caveats:

- Movie matching can sometimes we wrong. 
    - TODO: Enable some way to edit matching manually
- No way of knowing what match we got afterwards (only stored in logs). 
    - TODO: Save matching to json file and add some way to easly query those matchings.
- The whole process is pretty slow, but subtitle match is promising.
- opensubtitles.org implements captcha, so multiple requests can trigger captcha which will cause subtitle download to fail.
    - TODO: Use opensubtitles api and user credentials instead
- imdb might also implement captcha. Caching is used for now to avoid triggering this so might not be a problem.
- Only supports movies for now (not TV series/anime)
- Only published as a docker image. Don't ask for a supported native version or other platforms like Windows. This is just too much work and not worth the effort. Just use docker lol.

## How to use
Just run this docker command to start a subagent watch daemon. You can add as many languages as you like at the end as long as they are supported by `subsync`. It is recommended to start with only one language though just to make sure everything works properly.
```bash
docker run --rm -it --name subagent -v /path/to/movies:/movies -v /path/to/cache:/cache gronis/subagent --cache /cache /movies eng ger
```

