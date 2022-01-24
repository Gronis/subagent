const fs = require('fs').promises;
const path = require('path');
const make_opensubtitle_api = require('./opensubtitle_api')
const query_extractor = require('./query_extractor')
const make_imdb_api = require('./imdb_api')
const database = require('./database')
const subsync = require('./subsync')
const srt = require('./srt')

const VIDEO_EXTENSION_PATTERN = /\.((mkv)|(avi)|(mp4))$/;

const remove_sample_files = file_list => {
    return file_list.filter(p => !p.toLowerCase().match('sample'))
}

const list_video_files = async pathname => {
    // TODO: Add file structure search recursion
    return (await fs.readdir(pathname))
        .filter(filename => filename.match(VIDEO_EXTENSION_PATTERN))
        .map(filename => path.join(pathname, filename))
}

const print_help = () => {
    console.log("Usage: subagent [Options...] path/to/movies language [language...]")
    console.log()
    console.log("Watches a directory of movies and attempts to download and sync subtitles.")
    console.log(" - Uses imdb to match movies.")
    console.log(" - Uses opensubtitles.org to fetch subtitles.")
    console.log(" - Utilizes subsync to sync subtitles.")
    console.log()
    console.log("Optional arguments:")
    console.log("  --cache path/to/cache Use this path as cache")
    console.log("  --help                print this help and exit")
    console.log()
    console.log("Positional arguments:")
    console.log("  path/to/movies        Directory to scan")
    console.log("  language              3-letter language code for subtitle")
    console.log()
}

const parse_args = (args) => {
    let cache_path = './'
    while((args[0] || '').startsWith('--')){
        // Print help
        if(args[0] === '--help'){
            print_help();
            process.exit(0);
        }
        if(args[0] === '--cache'){
            cache_path = args[1]
            if(!cache_path){
                console.log("No cache path provided")
                return;
            }
            args = args.slice(2)
        }
    } 
    const root_path = args[0]
    args = args.slice(1)
    const languages = args
    return {
        cache_path,
        root_path,
        languages,
    }
}

const main = async () => {
    let args = process.argv.slice(1 + process.argv.findIndex(a => a.match('subagent')))
    if(args.length < 2){
        print_help();
        process.exit(0);
    }
    const {cache_path, root_path, languages} = parse_args(args);
    const api_keys = [

    ]
    const imdb_api = await make_imdb_api(cache_path)
    const opensubtitle_api = await make_opensubtitle_api(cache_path, api_keys)
    const subtitle_metadata_database = await database.open(cache_path, 'subtitle_metadata_database.json')
    const imdb_metadata_database = await database.open(cache_path, 'imdb_metadata_database.json')

    const download_and_sync_subtitle = async (imdb_entity, language, video_path) => {
        const subtitles = []
        const video_filename = path.basename(video_path)
        const parent_path = path.dirname(video_path)
        const subtitle_filename = video_filename + `.subagent-GENERATED.${language}`
        const has_subs = (await fs.readdir(parent_path))
            .filter(p => p.includes(subtitle_filename)).length > 0
        if(has_subs){
            console.log(
                `"${imdb_entity.title} (${imdb_entity.year})"`, 
                "already has subtitles for language:", language, "skipping..."
            )
            return;
        }
        const size = (await fs.stat(video_path) || {}).size || 0
        if(size < 128 * 1024){
            console.log(`"${video_filename}" is smaller than 128kb`, "skipping..." )
            return;
        }
        console.log(
            "Fetching subs for:\n",
            `  title: "${imdb_entity.title}" (${imdb_entity.year})\n`,
            `   file: "${video_filename}"\n`,
            `   lang: "${language}"`,
        )
        const subtitle_entities = await opensubtitle_api.query(imdb_entity.id, language)
        console.log("Got", subtitle_entities.length, "subtitle(s)")
    
        for(const sub_entity of subtitle_entities.slice(0,5)){
            console.log(`Downloading: [id:${sub_entity.file_id}]`)
            const subtitle_metadata = await opensubtitle_api.download(sub_entity);
            if(!subtitle_metadata || !subtitle_metadata.contents || !subtitle_metadata.extension){
                console.log(`Failed to download: "${sub_entity.file_id}"`)
                continue;
            }
            const sub_in_path = path.join(cache_path, `subtitle${subtitle_metadata.extension}`)
            const sub_out_path = path.join(cache_path, `synced_subtitle${subtitle_metadata.extension}`)
            console.log(`Downloaded "${sub_in_path}" successfully`)
            const subtitle_contents = subtitle_metadata.extension === '.srt'
                ? srt.fix(subtitle_metadata.contents) 
                : subtitle_metadata.contents
            await fs.writeFile(sub_in_path, subtitle_contents, 'utf8')
            console.log(`Syncing "${sub_in_path}"`)
            const sync_result = await subsync(video_path, sub_in_path, sub_out_path).catch(err => {
                console.log('Media cannot be synced with subtitles.', err)
            })
            if(!sync_result){
                // If no sub metadata were returned, this means error with media
                // not just this subtitle file. Skip this media file entirely.
                console.log(
                    "Subtitle sync failed. Skipping", 
                    `"${imdb_entity.title}" (${imdb_entity.year})`
                )
                return;
            }
            if(!sync_result.correlated){
                console.log("Subtitle sync failed. Trying next sub")
                console.log(sync_result)
                continue;
            }
            console.log('Sync OK!')
            console.log(sync_result)
            subtitles.push({
                contents: await fs.readFile(sub_out_path, 'utf8'),
                path: path.join(parent_path, `${subtitle_filename}${subtitle_metadata.extension}`),
                metadata: {
                    file_id: sub_entity.file_id,
                    imdb_entity,
                    sync_result,
                }
            })
            // If maximum change is less than 1 sec, the subtitle was probably a good fit from
            // the start and we should use it.
            if(sync_result.maxChange < 1.0){
                break;
            } else {
                console.log("Fit might not be so good, so will try and compare more subtitles...")
            }
        }
        // Take the best subtitle 
        // (The one with the most number of synced points, scaled by max change)
        const subtitle = subtitles
            .sort((s1, s2) => s2.score - s1.score)
            .find(() => true)
        if(subtitle){
            console.log(`Done, writing subtitle to "${subtitle.path}"`)
            await fs.writeFile(subtitle.path, subtitle.contents, 'utf8')
            await subtitle_metadata_database.store(subtitle.path, subtitle.metadata)
        }
    }

    const run_imdb_matching_only = async root_path => {
        const movies_paths_raw = (await fs.readFile('movies.txt', 'utf8')).split('\n')
        // Only works for movies for now
        const movies_paths_filtered = remove_sample_files(movies_paths_raw)
            .map(p => p.replace(root_path, '')) // Unprepend root path 
            .slice(0,800)
        
        const imdb_entities = (await Promise.all(movies_paths_filtered
            .map(m => query_extractor.from_path(m)) //))
            .map(q => imdb_api.query(q))))
            // .sort((i1, i2) => i1.title > i2.title? 1 : i1.title < i2.title? -1 : 0)
            .sort((i1, i2) => -imdb_api.score(i1) + imdb_api.score(i2))
            .map(i => i.id + ": " + i.title + " " + i.year + " q:" + i.source.query )
        console.log(imdb_entities.join('\n'))
    }
    
    const run_job = async (root_path, languages) => {
        console.log("Running subagent job...")
        // Only works for movies for now
        const video_paths = remove_sample_files(await list_video_files(root_path))         
        console.log("Matching movies:", video_paths)
        
        //Download subs
        for(const video_path of video_paths){
            let imdb_entity = await imdb_metadata_database.load(video_path)
            if(!imdb_entity){
                const query = query_extractor.from_path(video_path.replace(root_path, ''))
                console.log("Searching for:", query)
                imdb_entity = await imdb_api.query(query)
                if(!imdb_entity.id){
                    console.log("Cannot match", imdb_entity.l, "skipping...")
                    continue;
                }
                console.log(
                    `Found [${imdb_entity.id}] "${imdb_entity.title}"`,
                    (imdb_entity.year? `(${imdb_entity.year})` : '')
                )
                await imdb_metadata_database.store(video_path, imdb_entity)
            }
            for (let language of languages){
                await download_and_sync_subtitle(imdb_entity, language, video_path);
                if(opensubtitle_api.blocked()){
                    console.log("Too many download requests.")
                    console.log("Api keys will reset within 24 hours.")
                    console.log("Stopping job early...")
                    return;
                }
            }
        }
        console.log("Finished subagent job...")
    }

    // await run_imdb_matching_only(root_path)
    await run_job(root_path, languages)
    
    if(fs.watch){
        const watcher = fs.watch(root_path)
        console.log(`Watching directory: "${root_path}"`)
        for await (filechange of watcher){
            if(filechange.filename && filechange.filename.match(VIDEO_EXTENSION_PATTERN)){
                try{
                    await run_job(root_path, languages)
                } catch (err){
                    console.log("Error during job", err)
                } 
                console.log(`Watching directory: "${root_path}"`)
            }
        }
    } else {
        const hourInterval = 3;
        console.log(`Scheduled for scanning every ${hourInterval} hours.`)
        setInterval(async () => {
            console.log("Starting scheduled scan...")
            try{
                await run_job(root_path, languages)
            } catch (err){
                console.log("Error during job", err)
            } 
            console.log(`Sleeping for ${hourInterval} hours.`)
        }, 1000* 3600 * hourInterval)
    }

}

main();
