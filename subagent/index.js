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
const SUBTITLE_EXTENSION_PATTERN = /\.((srt)|(ass)|(ssa))$/;
const GENERATED_SUBTITLE_EXTENSION_PATTERN = /subagent-GENERATED\.[a-z][a-z][a-z]?\.((srt)|(ass)|(ssa))$/;
const HIDDEN_FILE_PATTERN = /^\..+$/

const remove_sample_files = file_list => file_list.filter(p => !p.toLowerCase().match('sample'));

const is_dir = pathname => fs.stat(pathname).then(f => f.isDirectory()).catch(() => false);

const fs_read_dir_or_empty = pathname => fs.readdir(pathname).catch(() => [])

const fs_stat_or_empty = pathname => fs.stat(pathname).catch(() => ({}))

const list_files = async pathname => {
    const directory_lookups = (await fs_read_dir_or_empty(pathname))
        .map(filename => path.join(pathname, filename))
        .map(async filepath => (await is_dir(filepath))? await list_files(filepath) : filepath)
    return (await Promise.all(directory_lookups)).flat()
}

const list_video_files = async pathname => (await list_files(pathname))
    .filter(p => p.match(VIDEO_EXTENSION_PATTERN));

const list_generated_sub_files = async pathname => (await list_files(pathname))
    .filter(p => p.match(GENERATED_SUBTITLE_EXTENSION_PATTERN));

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

const has_sub_in_language = (video_filename, subtitle_paths, language_code) => {
    const video_filename_query = query_extractor.from_text(video_filename)
    const subtitle_matches = subtitle_paths
        .filter(sfn => sfn.match(SUBTITLE_EXTENSION_PATTERN) && query_extractor.is_lang(sfn, language_code))
        .map(sfn => query_extractor.from_text(sfn))
        .filter(q => q === video_filename_query)
    return subtitle_matches.length > 0
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
    // If sub is not a sunagent-GENERATED file, we assume score is 100.
    const get_reference_subtitle_path = async (video_path) => {
        const video_filename = path.basename(video_path)
        const parent_path = path.dirname(video_path)
        const video_file_query = query_extractor.from_text(video_filename)
        const subtitle_name = [video_filename, GENERATED_SUB_NAME].join('.')
        const all_sub_filenames = (await fs_read_dir_or_empty(parent_path))
            .filter(p => p.match(SUBTITLE_EXTENSION_PATTERN) 
                && !p.match(HIDDEN_FILE_PATTERN)
                && query_extractor.from_text(p) === video_file_query)
        const synced_sub_filenames = all_sub_filenames
            .filter(p => p.includes(subtitle_name))
        // Subs not synced by subagent assumes this sync_result for comparison:
        const default_metadata = {
            sync_result: {
                points: 100,
                maxChange: 1.0,
                correlated: true,
                score: 100.0,
            }
        }
        return all_sub_filenames
            .map(s_file => path.join(parent_path, s_file))
            .map(s_path => ({ 
                path: s_path, 
                metadata: synced_sub_filenames.find(f => f === s_path)
                    ? subtitle_metadata_database.load(s_path) 
                    : default_metadata,
            }))
            .filter(s => s && s.metadata && s.metadata.sync_result)
            .sort((s1, s2) => s2.metadata.sync_result.score - s1.metadata.sync_result.score)
            .map(s => s.path)
            .find(() => true)
    }

    const get_reference_subtitle_scaling_factor = reference_subtitle_path => {
        const sync_result = (subtitle_metadata_database.load(reference_subtitle_path) || {}).sync_result
        // Scale score on the result from the reference score.
        // If reference has fewer than 200 points, scale score down
        if(sync_result) return Math.max(0, Math.min(1, Math.log10(sync_result.points/20)))
        return 1.0;
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

    const sync_subtitle = async (sub_data, ref_path) => {
        const reference_size = (await fs_stat_or_empty(ref_path)).size || 0
        const subsync_failure_key = (
            `REF(${ref_path}):SIZE(${reference_size}):SUB(${sub_data.file_id})`
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
        const sub_in_path = path.join(cache_path, `subtitle${sub_data.extension}`)
        const sub_out_path = path.join(cache_path, `synced_subtitle${sub_data.extension}`)
        const subtitle_contents = sub_data.extension === '.srt'
            ? srt.fix(sub_data.contents) 
            : sub_data.contents
        await fs.writeFile(sub_in_path, subtitle_contents, 'utf8')
        
        let sync_result = null;
        // Try to sync both with audio and subtitle as reference.
        const extra_args_to_try = [
            ['--effort=0.8', '--ref-stream-by-type=sub'],
            ['--effort=0.8', '--ref-stream-by-type=audio'],
        ]
        const on_error = err => console.log('Media cannot be synced with subtitles.', err);
        for(let extra_args of extra_args_to_try){
            console.log(`Syncing [id:${sub_data.file_id}] using reference "${ref_path}"`)
            console.log(`    Using extra arguments: ${extra_args}`)
            sync_result = (
                await subsync(ref_path, sub_in_path, sub_out_path, extra_args).catch(on_error)
            ) || sync_result;
            if(sync_result && sync_result.correlated) return {
                sync_result,
                synced_subtitle_data: {
                    ...sub_data,
                    contents: await fs.readFile(sub_out_path, 'utf8'),
                }
            }
        }
        if(sync_result && !sync_result.correlated){
            subsync_failure_database.store(subsync_failure_key, sync_result)
            console.log("Subtitle sync failed. Result:")
            console.log(sync_result)
            console.log("Trying next subtitle...")
            return {
                sync_result,
                synced_subtitle_data: null,
            }
        }
        console.log(`Subtitle sync failed. Skipping "${ref_path}"`)
        return {
            sync_result: null,
            synced_subtitle_data: null,
        }
    }

    const download_and_sync_subtitle = async (imdb_entity, language_code, video_path) => {
        const subtitles = []
        const video_filename = path.basename(video_path)
        const parent_path = path.dirname(video_path)
        const subtitle_name = [video_filename, GENERATED_SUB_NAME, language_code].join('.')
        const has_subs = has_sub_in_language(video_filename, await fs_read_dir_or_empty(parent_path), language_code)

        if(has_subs){
            // console.log(`"${video_filename}" has subtitles for language "${language}", skipping...`)
            return true;
        }
        const size = (await fs_stat_or_empty(video_path)).size || 0
        if(size < 128 * 1024){
            // console.log(`"${video_filename}" is smaller than 128kb, skipping...`)
            return true;
        }
        const release_type = query_extractor.get_special_release_type(video_filename)
        console.log(
            "Fetching subs for:\n",
            `imdb_id: ${imdb_entity.id}\n`,
            `  title: "${imdb_entity.title}" (${imdb_entity.year}) ${release_type || ''}\n`,
            `   file: "${video_filename}"\n`,
            `   lang: "${language_code}"`,
        )
        // Sort subtitle files according to 
        // 1: Same special release type (if any).
        // 2: Any special release type (if any).
        // 3: Same order as returned from server (typically sorted by popularity by server).
        const subtitle_files = (await opensubtitle_api.query(imdb_entity.id, language_code))
            .sort((s1, s2) => {
                if(!release_type) return 0;
                {
                    const s1r = query_extractor.get_special_release_type(s1.file_name || s1.release) == release_type
                    const s2r = query_extractor.get_special_release_type(s2.file_name || s2.release) == release_type
                    const order = s2r - s1r
                    if(order != 0) return order;
                }
                {
                    const s1r = (query_extractor.get_special_release_type(s1.file_name || s1.release) || '').length != 0
                    const s2r = (query_extractor.get_special_release_type(s2.file_name || s2.release) || '').length != 0
                    const order = s2r - s1r
                    return order;
                }
            })
        console.log("Got", subtitle_files.length, "subtitle(s)")
        for(const subtitle_file of subtitle_files.slice(0,5)){
            const subtitle_data = await download_subtitle(subtitle_file)
            if(!subtitle_data) continue;
            const { synced_subtitle_data, sync_result } = await sync_subtitle(subtitle_data, video_path)
            if(!sync_result) break;
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
        const reference_subtitle_path = await get_reference_subtitle_path(video_path)
        if(reference_subtitle_path){
            console.log(`Resyncing subs using "${reference_subtitle_path}" as reference.`)
            const resync_subtitle_files = [
                ...(subtitles.length? subtitles : subtitle_files.slice(0,5))
            ]
            for(const subtitle_file of resync_subtitle_files){
                const subtitle_data = await download_subtitle(subtitle_file)
                if(!subtitle_data) continue;
                const { synced_subtitle_data, sync_result } = await sync_subtitle(subtitle_data, reference_subtitle_path)
                if(!sync_result) return;
                if(!sync_result.correlated || !synced_subtitle_data) continue;
                sync_result.score *= get_reference_subtitle_scaling_factor(reference_subtitle_path)
                console.log('Sync OK!', sync_result)
                subtitles.push({
                    ...synced_subtitle_data,
                    metadata: {
                        imdb_entity,
                        file_id: subtitle_file.file_id,
                        sync_reference: reference_subtitle_path,
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
            console.log(`No suitable subtitle found for "${video_path}" for language "${language_code}"`)
            return false;
        }
        const subtitle_path = path.join(parent_path, subtitle_name + subtitle.extension)
        console.log(`Saving subtitle to "${subtitle_path}"`)
        try{
            await fs.writeFile(subtitle_path, subtitle.contents, 'utf8')
        } catch {
            console.log(`Failed to write subtitle to "${subtitle_path}"`)
            return false;
        }
        subtitle_metadata_database.store(subtitle_path, subtitle.metadata)
        return true;
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
        console.log(`Matching ${video_paths.length} file(s).`)

        const files_without_synced_subtitles = [];
        
        //Download subs
        for(const video_path of video_paths){
            let imdb_entity = imdb_metadata_database.load(video_path)
            const query = query_extractor.from_path(video_path.replace(root_scan_path, ''))
            // If imdb entity is missing or the query used to find that entity has changed, look up new imdb entity
            if(!imdb_entity || !imdb_entity.source || query.split(',').every(q => q != imdb_entity.source.query)){
                console.log(`Searching for: "${query}"`)
                imdb_entity = await imdb_api.query(query)
                if(!imdb_entity.id){
                    console.log("Cannot match", video_path, "skipping...")
                    continue;
                }
                console.log(
                    `Found [${imdb_entity.id}] "${imdb_entity.title}"`,
                    (imdb_entity.year? `(${imdb_entity.year})` : '')
                )
                imdb_metadata_database.store(video_path, imdb_entity)
            }
            for (let language of languages){
                const success = await download_and_sync_subtitle(imdb_entity, language, video_path);
                if(!success){
                    files_without_synced_subtitles.push({
                        file: video_path,
                        lang: language,
                    })
                }
                if(opensubtitle_api.blocked()){
                    console.log("Too many download requests.")
                    console.log("Api keys will reset within 24 hours.")
                    console.log("Stopping job early...")
                    return;
                }
            }
        }
        console.log("Finished subagent scan job...")
        console.log("Files missing synced subtitles:", files_without_synced_subtitles)
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
                await fs.unlink(sub_filename).catch(() => {})
            }
        }
        console.log("Finished subagent clean job...")
    }

    // await run_imdb_matching_only(root_scan_path)
    await run_scan(root_scan_path, languages)
    
    let timestamp_last_job = new Date(0)
    let active_job = false;
    // Only one singleton scan can run at a time, and not too soon (< 5s) after one another.
    const run_singleton_scan = async () => {
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
        setInterval(run_singleton_scan, 1000 * 3600 * hourInterval)
    }
    // If watcher is supported, scan when video-files changes on filesystem.
    if(watch){
        const watcher = watch(root_scan_path, { recursive: true })
        console.log(`Watching directory: "${root_scan_path}"`)
        for await (filechange of watcher){
            if(filechange.filename && filechange.filename.match(VIDEO_EXTENSION_PATTERN)){
                // run async since we don't want to queue old file-watcher events.
                run_singleton_scan() 
            }
        }
    } 
}

main();
