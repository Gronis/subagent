const fs = require('fs').promises;
const path = require('path');
const make_opensubtitle_api = require('./opensubtitle_api')
const query_extractor = require('./query_extractor')
const make_imdb_api = require('./imdb_api')
const database = require('./database')
const subsync = require('./subsync')
const srt = require('./srt')
const watch = require('./watch')

const GENERATED_SUB_NAME = "subagent-GENERATED"
const VIDEO_EXTENSION_PATTERN = /\.((mkv)|(avi)|(mp4))$/;
const GENERATED_SUBTITLE_EXTENSION_PATTERN = /subagent-GENERATED\.[a-z][a-z][a-z]?\.((srt)|(ass)|(ssa))$/;

const remove_sample_files = file_list => {
    return file_list.filter(p => !p.toLowerCase().match('sample'))
}

const list_files = async (pathname, pattern) => {
    const directory_lookups = (await fs.readdir(pathname).catch(() => []))
        .map(filename => path.join(pathname, filename))
        .map(async filepath => ( await fs.stat(filepath)).isDirectory()
            ? await list_files(filepath, pattern)
            // ? filepath // Don't do recursive search for now.
            : filepath )
    return (await Promise.all(directory_lookups))
        .flat()
        .filter(filename => filename.match(pattern))
}

const list_video_files = async pathname => list_files(pathname, VIDEO_EXTENSION_PATTERN)
const list_generated_sub_files = async pathname => list_files(pathname, GENERATED_SUBTITLE_EXTENSION_PATTERN)

const print_help = () => {
    console.log("Usage: subagent [options...] <path> <language> [<language>...]")
    console.log()
    console.log("Watches a directory of movies and attempts to download and sync subtitles.")
    console.log(" - Uses imdb to match movies.")
    console.log(" - Uses opensubtitles.org to fetch subtitles.")
    console.log(" - Utilizes subsync to sync subtitles.")
    console.log()
    console.log("Optional arguments:")
    console.log("  --cache <path>         Use this path as cache (Recommended).")
    console.log("  --clean                Removes subs if ref-video has been removed.")
    console.log("  --help                 Print this help and exit.")
    console.log()
    console.log("Positional arguments:")
    console.log("  path                   Directory to scan")
    console.log("  language               2-letter language code for subtitle")
    console.log()
}

const parse_args = (args) => {
    let cache_path = './'
    let clean = false
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
        if(args[0] === '--clean'){
            clean = true
            args = args.slice(1)
        }
    } 
    const root_scan_path = args[0]
    args = args.slice(1)
    const languages = args
    return {
        cache_path,
        root_scan_path,
        languages,
        clean,
    }
}

const main = async () => {
    let args = process.argv.slice(1 + process.argv.findIndex(a => a.match('subagent')))
    if(args.length < 2){
        print_help();
        process.exit(0);
    }
    const {cache_path, root_scan_path, languages, clean} = parse_args(args);
    const api_keys = [

    ]
    const imdb_api = await make_imdb_api(cache_path)
    const opensubtitle_api = await make_opensubtitle_api(cache_path, api_keys)
    const subtitle_metadata_database = await database.open(cache_path, 'subtitle_metadata_database.json')
    const imdb_metadata_database = await database.open(cache_path, 'imdb_metadata_database.json')
    const subsync_failure_database = await database.open(cache_path, 'subsync_failure_database.json')

    // Get previously synced subtitle in any other language. Sorted by score, min points: 20
    const get_synced_subtitle_path = async (video_path) => {
        const parent_path = path.dirname(video_path)
        const subtitle_name = [path.basename(video_path), GENERATED_SUB_NAME].join('.')
        const synced_sub_filenames = (await fs.readdir(parent_path))
            .filter(p => p.includes(subtitle_name))
        return synced_sub_filenames
            .map(s_file => path.join(parent_path, s_file))
            .map(s_path => ({ 
                path: s_path, 
                metadata: subtitle_metadata_database.load(s_path),
            }))
            .filter(s => s && s.metadata && s.metadata.sync_result)
            .sort((s1, s2) => s2.metadata.sync_result.score - s1.metadata.sync_result.score)
            .map(s => s.path)
            .find(() => true)
    }

    const download_subtitle = async subtitle_file => {
        const sub = subtitle_file;
        console.log(`Downloading: [id:${sub.file_id}], "${sub.file_name || sub.release}"`)
        const subtitle_data = await opensubtitle_api.download(sub);
        if(!subtitle_data || !subtitle_data.contents || !subtitle_data.extension){
            console.log(`Failed to download: "${sub.file_id}"`)
            return null;
        }
        console.log(`Downloaded [id:${sub.file_id}] successfully`)
        return subtitle_data
    }

    const sync_subtitle = async (subtitle_data, reference_path) => {
        const reference_size = (await fs.stat(reference_path).catch(() => ({ size: 0 }))).size
        const subsync_failure_key = (
            `REF(${reference_path}):SIZE(${reference_size}):SUB(${subtitle_data.file_id})`
        )
        {   // Use cached result so we dont sync failed subtitles over and over.
            const sync_result = subsync_failure_database.load(subsync_failure_key)
            if(sync_result){
                console.log("Subtitle sync has failed before. Won't sync again. Previous result:")
                console.log(sync_result)
                return {
                    sync_result,
                    synced_subtitle_data: null,
                }
            }
        }
        const sub_in_path = path.join(cache_path, `subtitle${subtitle_data.extension}`)
        const sub_out_path = path.join(cache_path, `synced_subtitle${subtitle_data.extension}`)
        const subtitle_contents = subtitle_data.extension === '.srt'
            ? srt.fix(subtitle_data.contents) 
            : subtitle_data.contents
        await fs.writeFile(sub_in_path, subtitle_contents, 'utf8')
        console.log(`Syncing [id:${subtitle_data.file_id}] using reference "${reference_path}"`)
        const sync_result = await subsync(reference_path, sub_in_path, sub_out_path).catch(err => {
            console.log('Media cannot be synced with subtitles.', err)
        })
        if(!sync_result){
            console.log(`Subtitle sync failed. Skipping "${reference_path}"`)
            return {
                sync_result: null,
                synced_subtitle_data: null,
            }
        }
        if(!sync_result.correlated){
            subsync_failure_database.store(subsync_failure_key, sync_result)
            console.log("Subtitle sync failed. Result:")
            console.log(sync_result)
            console.log("Trying next subtitle...")
            return {
                sync_result,
                synced_subtitle_data: null,
            }
        }
        return {
            sync_result,
            synced_subtitle_data: {
                ...subtitle_data,
                contents: await fs.readFile(sub_out_path, 'utf8'),
            }
        }
    }

    const download_and_sync_subtitle = async (imdb_entity, language, video_path) => {
        const subtitles = []
        const video_filename = path.basename(video_path)
        const parent_path = path.dirname(video_path)
        const subtitle_name = [video_filename, GENERATED_SUB_NAME, language].join('.')
        const has_subs = (await fs.readdir(parent_path))
            .filter(p => p.includes(subtitle_name)).length > 0

        if(has_subs){
            console.log(`"${video_filename}" has subtitles for language "${language}", skipping...`)
            return;
        }
        const size = (await fs.stat(video_path) || {}).size || 0
        if(size < 128 * 1024){
            console.log(`"${video_filename}" is smaller than 128kb, skipping...`)
            return;
        }
        const release_type = query_extractor.get_special_release_type(video_filename)
        console.log(
            "Fetching subs for:\n",
            `imdb_id: ${imdb_entity.id}\n`,
            `  title: "${imdb_entity.title}" (${imdb_entity.year}) ${release_type || ''}\n`,
            `   file: "${video_filename}"\n`,
            `   lang: "${language}"`,
        )
        const subtitle_files = (await opensubtitle_api.query(imdb_entity.id, language))
            .sort((s1, s2) => {
                if(!release_type) return 0;
                const s1r = query_extractor.get_special_release_type(s1.file_name || s1.release) == release_type
                const s2r = query_extractor.get_special_release_type(s2.file_name || s2.release) == release_type
                return s2r - s1r
            })
        console.log("Got", subtitle_files.length, "subtitle(s)")
        for(const subtitle_file of subtitle_files.slice(0,5)){
            const subtitle_data = await download_subtitle(subtitle_file)
            if(!subtitle_data) continue;
            const { synced_subtitle_data, sync_result } = await sync_subtitle(subtitle_data, video_path)
            if(!sync_result) return;
            if(!sync_result.correlated || !synced_subtitle_data) continue;
            console.log('Sync OK!', sync_result)
            subtitles.push({
                ...synced_subtitle_data,
                metadata: {
                    imdb_entity,
                    file_id: subtitle_file.file_id,
                    sync_reference: video_path,
                    sync_result,
                },
            })
            // If maximum change is less than 1 sec, the subtitle was probably a good fit from
            // the start and we should use it.
            if(sync_result.maxChange < 1.0){
                break;
            } else {
                console.log("Fit might not be so good, so will try and compare more subtitles...")
            }
        }
        // Before we choose, see if we can match with other subtitles in other languages
        const synced_subtitle_path = await get_synced_subtitle_path(video_path)
        if(synced_subtitle_path){
            console.log(`Resyncing subs using "${synced_subtitle_path}" as reference.`)
            const resync_subtitle_files = [
                ...(subtitles.length? subtitles : subtitle_files.slice(0,5))
            ]
            for(const subtitle_file of resync_subtitle_files){
                const subtitle_data = await download_subtitle(subtitle_file)
                if(!subtitle_data) continue;
                const { synced_subtitle_data, sync_result } = await sync_subtitle(subtitle_data, synced_subtitle_path)
                if(!sync_result) return;
                if(!sync_result.correlated || !synced_subtitle_data) continue;
                const ref_sync_result = subtitle_metadata_database.load(synced_subtitle_path).sync_result
                // Scale score on the result from the reference score.
                // If reference has fewer than 200 points, scale score down
                const scale_factor = Math.max(0, Math.min(1, Math.log10(ref_sync_result.points/20)))
                sync_result.score *= scale_factor
                console.log('Sync OK!', sync_result)
                subtitles.push({
                    ...synced_subtitle_data,
                    metadata: {
                        imdb_entity,
                        file_id: subtitle_file.file_id,
                        sync_reference: synced_subtitle_path,
                        sync_result,
                    },
                })
            }
        }

        // Take the subtitle with the best score.
        // (The one with the most number of synced points, scaled by max change)
        const subtitle = subtitles
            .sort((s1, s2) => s2.metadata.sync_result.score - s1.metadata.sync_result.score)
            .find(() => true)
        if(!subtitle){
            console.log(`No suitable subtitle found for "${video_path}" for language "${language}"`)
            return;
        }
        const subtitle_path = path.join(parent_path, subtitle_name + subtitle.extension)
        console.log(`Saving subtitle to "${subtitle_path}"`)
        await fs.writeFile(subtitle_path, subtitle.contents, 'utf8')
        subtitle_metadata_database.store(subtitle_path, subtitle.metadata)
    }

    const run_imdb_matching_only = async root_scan_path => {
        const movies_paths_raw = (await fs.readFile('movies.txt', 'utf8')).split('\n')
        // Only works for movies for now
        const movies_paths_filtered = remove_sample_files(movies_paths_raw)
            .map(p => p.replace(root_scan_path, '')) // Unprepend root path 
            .slice(0,800)
        
        const imdb_entities = (await Promise.all(movies_paths_filtered
            .map(m => query_extractor.from_path(m)) //))
            .map(q => imdb_api.query(q))))
            // .sort((i1, i2) => i1.title > i2.title? 1 : i1.title < i2.title? -1 : 0)
            .sort((i1, i2) => -imdb_api.score(i1) + imdb_api.score(i2))
            .map(i => i.id + ": " + i.title + " " + i.year + " q:" + i.source.query )
        console.log(imdb_entities.join('\n'))
    }

    const run_scan = async (root_scan_path, languages) => {
        console.log("Running subagent scan job...")
        // Only works for movies for now
        const video_paths = remove_sample_files(await list_video_files(root_scan_path))         
        console.log("Matching movies:", video_paths)
        
        //Download subs
        for(const video_path of video_paths){
            let imdb_entity = imdb_metadata_database.load(video_path)
            if(!imdb_entity){
                const query = query_extractor.from_path(video_path.replace(root_scan_path, ''))
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
                imdb_metadata_database.store(video_path, imdb_entity)
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
        console.log("Finished subagent scan job...")
        if(!clean) return;
        console.log("Running subagent clean job...")
        const video_files = await list_video_files(root_scan_path)
        const sub_files = await list_generated_sub_files(root_scan_path)
        for(let sub_filename of sub_files){
            const video_filename = sub_filename
                .replace(GENERATED_SUBTITLE_EXTENSION_PATTERN, '')
                .replace(/\.$/, '') // Remove dot on the end
            if(video_files.indexOf(video_filename) == -1){
                console.log("    Removing", sub_filename)
                await fs.unlink(sub_filename)
            }
        }
        console.log("Finished subagent clean job...")
    }

    // await run_imdb_matching_only(root_scan_path)
    await run_scan(root_scan_path, languages)
    
    let timestamp_last_job = new Date(0)
    let active_job = false;
    // Only one scheduled scan can run at a time, and not too soon (< 5s) after one another.
    const run_scheduled_scan = async () => {
        const timestamp_now = new Date()
        const millis_since_last_job = timestamp_now - timestamp_last_job
        if(active_job || millis_since_last_job < 5000) return;
        timestamp_last_job = timestamp_now;
        active_job = true;
        try{
            await run_scan(root_scan_path, languages)
        } catch (err){
            console.log("Error during job", err)
        } finally{
            active_job = false
        }
    }
    { // Start scheduled runner. Scan more often if watch is unsupported.
        const hourInterval = watch? 12 : 3;
        console.log(`Scheduled for scanning every ${hourInterval} hours.`)
        setInterval(run_scheduled_scan, 1000 * 3600 * hourInterval)
    }
    // If watcher is supported, scan when video-files changes on filesystem.
    if(watch){
        const watcher = watch(root_scan_path, { recursive: true })
        console.log(`Watching directory: "${root_scan_path}"`)
        for await (filechange of watcher){
            if(filechange.filename && filechange.filename.match(VIDEO_EXTENSION_PATTERN)){
                // run async since we don't want to queue old file-watcher events.
                run_scheduled_scan() 
            }
        }
    } 
}

main();
