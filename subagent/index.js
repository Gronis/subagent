const fs = require('fs').promises;
const path = require('path');
const make_opensubtitle_api = require('./opensubtitle_api')
const query_extractor = require('./query_extractor')
const make_imdb_api = require('./imdb_api')
const database = require('./database')
const subsync = require('./subsync')
const srt = require('./srt')

const SUBTITLE_EXTENSION_PATTERN = /\.((?:srt)|(?:ass)|(?:ssa))$/
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
    const db = await database.open(cache_path)

    const download_and_sync_subtitle = async (imdb_entity, language, video_path) => {
        const subtitles = []
        const video_filename = path.basename(video_path)
        const video_parent_path = path.dirname(video_path)
        const subtitle_filename = video_filename + `.subagent-GENERATED.${language}`
        const has_subs = (await fs.readdir(video_parent_path))
            .filter(p => p.includes(subtitle_filename) && p.match(SUBTITLE_EXTENSION_PATTERN)).length > 0
        if(has_subs){
            console.log(`"${imdb_entity.title} (${imdb_entity.year})"`, "already has subtitles for language:", language, "skipping..." )
            return;
        }
        console.log("Fetching subs for", `"${imdb_entity.title} (${imdb_entity.year})"`, "language:", language)
        const subtitle_entities = (await opensubtitle_api.query(imdb_entity.id, language))
            .filter(se => se.file_name.match(SUBTITLE_EXTENSION_PATTERN))
        console.log("Got", subtitle_entities.length, "subtitle_entities")
    
        for(const sub_entity of subtitle_entities.slice(0,5)){
            console.log(`Downloading: "${sub_entity.file_name}"`)
            const contents1 = await opensubtitle_api.download(sub_entity);
            if(!contents1){
                console.log(`Failed to download: "${sub_entity.file_name}"`)
                continue;
            }
            const subtitle_ext = sub_entity.file_name.match(SUBTITLE_EXTENSION_PATTERN)[1]
            const subtitle_path = `${video_parent_path}/${subtitle_filename}.${subtitle_ext}`
            const contents2 = subtitle_ext === 'srt'? srt.fix(contents1) : contents1
            await fs.writeFile(subtitle_path, contents2, 'utf8')
            console.log(`Syncing "${sub_entity.file_name}"`)
            const subtitle = await subsync(video_path, subtitle_path);
            if(subtitle.correlated){
                console.log('Sync OK!\n', 'subtitle:', subtitle)
                subtitle.contents = await fs.readFile(subtitle_path, 'utf8')
                subtitle.score = (subtitle.points || 0)/Math.sqrt(subtitle.maxChange || 10000)
                subtitle.file_id = sub_entity.file_id
                subtitle.imdb_id = imdb_entity.id
                subtitle.title = imdb_entity.title
                subtitle.year = imdb_entity.year
                subtitles.push(subtitle)
                // If maximum change is less than 1 sec, the subtitle was probably a good fit from
                // the start and we should use it.
                if(subtitle.maxChange < 1.0){
                    break;
                } else {
                    console.log("Fit might not be so good, so will try and compare more subtitles...")
                }
            } else {
                // If subtitle is not correlated. Remove file to indicate that there
                // is no good subtitle yet for this video
                await fs.unlink(subtitle_path)
                console.log("Subtitle sync failed. Trying next sub\n", 'subtitle:', subtitle)
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
            const { ['contents']:_, ...subtitle_without_contents } = subtitle
            await db.store(subtitle.path, subtitle_without_contents)
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
        const movies_paths = remove_sample_files(await list_video_files(root_path)) 
        
        console.log("Matching movies:", movies_paths)
        const video_paths_and_query_list = movies_paths.map(video_path => ({ 
            video_path, 
            query: query_extractor.from_path(video_path.replace(root_path, '')) 
            // Leaving root path before extracting query might give odd matches, so remove it.
        }))
        
        //Download subs
        for(const { video_path, query } of video_paths_and_query_list){
            console.log("Searching for:", query)
            imdb_entity = await imdb_api.query(query)
            if(!imdb_entity.id){
                console.log("Cannot match", imdb_entity.l, "skipping...")
                continue;
            }
            console.log(`Found [${imdb_entity.id}] "${imdb_entity.title} ` + (imdb_entity.year? `(${imdb_entity.year})` : '') + '"')
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
        for await (_ of watcher){
            try{
                await run_job(root_path, languages)
            } catch (err){
                console.log("Error during job", err)
            } 
            console.log(`Watching directory: "${root_path}"`)
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
