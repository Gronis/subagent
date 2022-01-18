const fs = require('fs').promises;
const http_request = require('./http_request');
const zip = require('./zip');
const proc = require('child_process');
const path = require('path');

const unescape_leetspeak = word => {
    const is_leet = word.match(/[0-9]/) && word.match(/[a-zA-Z]/)
    return is_leet ? word
        .replaceAll('0', 'o')
        .replaceAll('1', 'l')
        .replaceAll('2', 'z')
        .replaceAll('3', 'e')
        .replaceAll('4', 'a')
        .replaceAll('5', 's')
        .replaceAll('6', 'g')
        .replaceAll('7', 't')
        .replaceAll('8', 'b')
        .replaceAll('9', 'p')
        : word;
}

const unescape_roman_numbers = word => {
    return {
        // 'I': '1',
        'II': '2',
        'III': '3',
        'IV': '4',
        // 'V': '5',
        'VI': '6',
        'VII': '7',
        'VIII': '8',
        'IX': '9',
        // 'X': '10',
        'XI': '11',
    }[word] || word
}

const is_movie_pack = (path) => {
    return path
        .toLowerCase()
        .match(/([^r][^e]pack)|(complete)|(collection)/)
}

const match_year = (name) => {
    name = ' ' + name.split('_').reverse().join(' ')
    const regex_year = /[ \.\-\_,][0-9][0-9][0-9][0-9]/;
    const match = name.match(regex_year)
    if (match) {
        return match[0].trim()
    }
    return false;
}

const extract_movie_query_from_path = (path) => {
    // Uses filename or dirname to find a good seach term.
    const filename = path.split('/').splice(-1)[0] || ''
    const parentname = path.split('/').splice(-2)[0] || ''
    const parentparentname = path.split('/').splice(-3)[0] || ''
    let results = []
    // If parent name looks like a movie pack, dont use it.
    if (!is_movie_pack(parentname)) {
        results = [
            extract_movie_query_from_text(parentname),
            extract_movie_query_from_text(filename)
        ]
    } else {
        results = [extract_movie_query_from_text(filename)]
    }
    results = results.filter(n => n) // Remove empty strings

    // If we still have no year at this point, try upper parent and see
    // if that title contains a year. If not, use old result.
    if (!results.some(s => match_year(s)) && !is_movie_pack(parentparentname)) {
        const tmp_result = extract_movie_query_from_text(parentparentname)
        if (match_year(tmp_result)) {
            results.push(tmp_result)
        }
    }
    // Sort so that we prioritize titles with years,
    // Otherwise sort for the longest title.
    return {
        'parent': parentname,
        'file': filename,
        'query': results.sort((s1, s2) => {
            const year_prio = !!match_year(s2) - !!match_year(s1)
            return year_prio || s2.length - s1.length
        })
    }
}
const extract_movie_query_from_text = (name) => {
    const whitespace = /[ \.\-\_,:?]/
    const regex_hard_end_words = [
        /^720p$/,
        /^1080p$/,
        /^2160p$/,
        /^mkv$/,
        /^mp4$/,
        /^avi$/,
        /^x264$/,
        /^x265$/,
        /^x266$/,
        /^h264$/,
        /^h265$/,
        /^h266$/,
        /^10bit$/,
        /^hdrip$/,
        /^bdrip$/,
        /^br$/,
        /^dts$/,
        /^bluray$/,
        /^remux$/,
        /^unrated$/,
        /^remastered$/,
        /^theatrical$/,
        /^extended$/,
        /^korsub$/,
        /^swedish$/,
        /^english$/,
        /^nordic$/,
        /^extras$/,
        /^extra$/,
    ]
    // Only end word if they happen after a word with 4 numbers (a year)
    const regex_soft_end_words = [
        /^hevc$/,
        /^avc$/,
        /^hdr$/,
        /^sdr$/,
        /^hc$/,
        /^ee$/,
    ]
    const regex_remove_words = [
        /^\+$/,
        /^\[.*\]/,
        /^\([^0-9]*\)$/,
        /^$/,
    ]
    const regex_year = /^[0-9][0-9][0-9][0-9]$/;
    const words = (name || '')
        .replaceAll(/\[[^\[]*\]/g, ' ')
        .replaceAll(/\([^0-9]*\)/g, ' ')
        .replaceAll(/[']/g, '')
        .split(whitespace)
        .filter(w => !regex_remove_words.some(p => w.match(p)))
        .map(w => w.trim().replaceAll(/[\(|\)|\[|\]]/g, ''))
        .map(w => w.replace(/^0+/, ''))
    const softEndIndex = words
        .findIndex(w => regex_soft_end_words.some(p => w.toLowerCase().match(p)))
    const hardEndIndex = words
        .findIndex(w => regex_hard_end_words.some(p => w.toLowerCase().match(p)))
    const yearIndex = words.length - [...words].reverse()
        .findIndex(w => w.match(regex_year))
    const endIndices = [words.length, hardEndIndex, yearIndex || softEndIndex]
        .filter(y => y > 0)
    const finalEndIndex = Math.min(...endIndices)
    const result = words
        .map(w => unescape_leetspeak(w))
        .map(w => unescape_roman_numbers(w))
        .slice(0, finalEndIndex)
        .join('_').toLowerCase()
        .replaceAll(/__/g, '_') // Sometimes, dubble underscores can occur
    return result
}

const remove_samples = (movies) => {
    return movies.filter(p => !p.toLowerCase().match('sample'))
}

// This is just a http request cache to not make imdb ban me while developing
let REQUEST_CACHE = {};
let VIDEO_FILE_EXTENSION_PATTERN = /\.((mkv)|(avi)|(mp4))$/;
(async () => {
    try {
        const http_cache = await fs.readFile('http_cache.json', 'utf8');
        if (http_cache) {
            REQUEST_CACHE = JSON.parse(http_cache)
        }
    } catch {
        // No cache file exists. Just skip for now
    }
})();

const request = async url => {
    if (REQUEST_CACHE[url]) {
        return REQUEST_CACHE[url]
    }
    const response = await http_request(url)
    REQUEST_CACHE[url] = response
    return response
}

const write_http_cache = async () => {
    await fs.writeFile('http_cache.json', JSON.stringify(REQUEST_CACHE));
}

const list_video_files = async path => {
    // No recursion for now
    return (await fs.readdir(path))
        .filter(p => p.match(VIDEO_FILE_EXTENSION_PATTERN))
}

const strip_year = query => {
    return query.replace(/_[0-9][0-9][0-9][0-9]$/, '')
}

const query_imdb = async (query, year) => {
    const url = `https://v2.sg.media-imdb.com/suggestion/${query[0]}/${query}.json`
    const response = await request(url)
    if (response.statusCode == 200) {
        return (JSON.parse(response.body).d || [])
            .map(r => {
                r.source_year = year
                r.source_query = query
                return r
            })
    }
    return []
}

const escape_regex = pattern => {
    // $& means the whole matched string
    return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
}

// Scores similar titles. Higher score is "more similar"
const title_diff_score = (t1, t2) => {
    t1 = escape_regex(t1)
    t2 = escape_regex(t2)
    t1words = t1.split('_').filter(w => w)
    t2words = t2.split('_').filter(w => w)
    const count_matching_words = (
        t1words.map(w => w && !!t2.match(w)).reduce((c1, c2) => c1 + c2) +
        t2words.map(w => w && !!t1.match(w)).reduce((c1, c2) => c1 + c2)
    )
    const count_missing_words = (
        t1words.map(w => w && !t2.match(w)).reduce((c1, c2) => c1 + c2) +
        t2words.map(w => w && !t1.match(w)).reduce((c1, c2) => c1 + c2)
    )
    const is_substring = 0 + !!(t1.match(t2) || t2.match(t1))
    const no_matching_words = (count_matching_words <= 0)

    return is_substring * 10
        + count_matching_words
        - count_missing_words
        - no_matching_words * 10
        - Math.abs(t1words.length - t2words.length) * 2
}

const score_imdb_entity = (imdb_entity) => {
    imdb_entity.query = extract_movie_query_from_text(imdb_entity.l) + ((imdb_entity.source_year && imdb_entity.y) ? '_' + imdb_entity.y : '');
    imdb_entity.score =
        // Add score for title similarity
        title_diff_score(imdb_entity.source_query, imdb_entity.query) +
        // Add points for matching year
        (imdb_entity.source_year ? !!imdb_entity.source_year.match(imdb_entity.y) * 10 : 0) +
        // Add score if it is a movie
        (imdb_entity.q === 'feature') * 20 +
        // Add score if it is a video (a few movies are videos in imdb)
        (imdb_entity.q === 'video') * 10
    return imdb_entity
}

const imdb_lookup_entry = async entry => {
    let results = []
    for (const query of entry.query) {
        const year = match_year(query)
        results = results.concat(await query_imdb(query, year))
        const query_stripped = strip_year(query)
        results = results.concat(await query_imdb(query_stripped, year))

        // Query with maximum 20 characters (imdb web ui maximum)
        // if no movies were found
        if (results.filter(r => r.q === 'feature').length == 0) {
            const query_stripped = query.slice(0, 20)
            results = results.concat(await query_imdb(query_stripped, year))
        }
    }
    // If we have results at this point, score and pick the best one.
    if (results.length > 0) {
        const result = results
            .map(r => score_imdb_entity(r))
            .sort((r1, r2) => r2.score - r1.score)[0]
        result.source = entry.file;
        return result
    }

    // If we exhaust all queries without finding anything,
    // return this stump (useful for debuging)
    return {
        l: entry.query.join(' | '),
        source: entry.file,
        score: -100,
    }
}

const fetch_sub_urls = async (imdb_id, language) => {
    const id = imdb_id.replace('tt','imdbid-');
    const url = `https://www.opensubtitles.org/en/search/sublanguageid-${language}/${id}`
    const request = await http_request(url)
    // Just use regex to find out which links point to a subtitle file.
    const subUrl = /href="(\/[a-z][a-z]\/subtitleserve\/sub\/[0-9]*)"/g
    return [...request.body.matchAll(subUrl)].map(m => `https://www.opensubtitles.org${m[1]}`)
}

const detect_encoding = buffer => {
    // Checks "magic bytes" in the beginning to detect utf8 encoding.
    if(buffer.length > 2 && buffer[0] == 0xEF && buffer[1] == 0xBB && buffer[2] == 0xBF){
        return 'utf8'
    }
    // If no magic bytes exists, check if text follows utf8 standard.
    // e.g, first non-ascii character is in [0xC0,0xF8]
    // following blocks
    for(let i = 0; i < buffer.length; i++){
        const char = buffer[i]
        if (0xC0 <= char && char < 0xF8){
            const j = i;
            let first_char = true;
            i++;
            for(; i < buffer.length && (i-j) < 64; i++){
                const char = buffer[i]
                if (0x80 <= char && char < 0xC0){
                    first_char = false;
                } else if(char < 0x80 && !first_char) {
                    break;
                } else if(first_char){
                    return 'binary';
                }
            }
        } else if(0x80 <= char && char < 0xC0) {
            return 'binary'
        }
    }
    return 'utf8'
}

const unzip_archive = buffer => {
    const entries = Object.entries(zip.Reader(buffer).toObject())
        .map(([filename, buffer]) => [filename, buffer.toString(detect_encoding(buffer))])
    return Object.fromEntries(entries)
}

const fetch_sub_archive = async url => {
    const request = await http_request(url)
    if(request.statusCode == 200){
        return Buffer.from(request.body, "binary")
    }
    return Buffer.from([])
}

// Strange encoding can sometimes mess up srt files.
// Try to fix them again. Also detect and remove ads.
const fix_srt = subtitle => {
    const pattern = /[0-9][0-9]\:[0-9][0-9]\:[0-9][0-9]\,[0-9][0-9][0-9] -->/g
    let fix_textbox = textbox => {
        let m = pattern.exec(textbox)
        while((m = pattern.exec(textbox))){
            const i = m.index
            textbox = textbox.slice(0, i) + '\n' + textbox.slice(i)
        }
        return textbox
    }
    return subtitle
        .replaceAll(/\r/g, '') // We dont want windows style newline (\r\n)
        .split('\n\n') // Separate to textboxes
        .map(fix_textbox)
        .join('\n\n') // Join textboxes.
        .replaceAll(/\n\n([0-9][0-9]?[0-9]?[0-9]?\n)?/g, '\n\n') // Remove textbox numbers
        .split('\n\n')
        .slice(1) // Remove first textbox. This one if often broken and full of ads.
        .map((t, i) => `${i+1}\n${t}`)
        .join('\n\n')
}

const sync_subtitle = (video_filename, subtitle_filename, method = 'subsync') => {
    return new Promise((accept, reject) => {
        const methods = {
            'subsync': [
                // Need loglevel INFO to read status of sync
                '-c', '--overwrite', '--loglevel=INFO', 
                'sync' ,
                '--ref', video_filename, 
                '--sub', subtitle_filename, 
                '--out', subtitle_filename
            ],
            // These will probably not be used (Gives bad results)
            'ffsubsync': [video_filename, '-i', subtitle_filename, '-o', subtitle_filename],
            'alass': [video_filename, subtitle_filename, subtitle_filename, '--no-split'],
            'autosubsync': [video_filename, subtitle_filename, subtitle_filename],
        }
        const sync_subtitle = proc.spawn(method, methods[method]);
        let result = {
            path: subtitle_filename,
        }
        sync_subtitle.on('exit', (code) => {
            if(code == 0){
                accept(result);
            } else {
                reject("Exit code is not 0");
            }
        });
        const on_data = d => {
            const data = d.toString()
            if(!data.match(/[0-9][0-9]\:[0-9][0-9]\:[0-9][0-9]\.[0-9][0-9][0-9]\:/)){
                process.stdout.write(data)
            }
            if(data.match('ERROR')){
                reject(data);
            }
            const score = data.match(/score: ([0-9\.]+)/)
            if(score){
                result.score = parseFloat(score[1])
            }
            const points = data.match(/points=([0-9]+)/)
            if(points){
                result.points = parseFloat(points[1])
            }
            const maxChange = data.match(/maxChange=([0-9]+\.[0-9]+)/)
            if(maxChange){
                const m = parseFloat(maxChange[1])
                result.maxChange = m;
            }
            const correlated = data.match(/correlated=((?:False)|(?:True))/)
            if(correlated){
                result.correlated = correlated[1] === 'True'
            }
        }
        sync_subtitle.stderr.on('data', on_data)
        sync_subtitle.stdout.on('data', on_data)
    })
}


const main = async () => {
    const rootDir = 'mov'
    const languages = ['eng', 'swe']
    // const movies_paths_raw = (await fs.readFile('movies.txt', 'utf8')).split('\n')
    const movies_paths_raw = await list_video_files(rootDir)
    const movies_paths_filtered = remove_samples(movies_paths_raw)
        .map(p => p.replace(rootDir, '')) // Remove prepending root dir 
        // .slice(3, 5)

    console.log("Matching files:", movies_paths_filtered)
    const movie_entries = movies_paths_filtered.map(m => extract_movie_query_from_path(m))
    
    //Fetch subs
    const sub_ext_pattern = /\.((?:srt)|(?:ass)|(?:ssa)|())$/
    for(let movie_entry of movie_entries){
        console.log("Searching for:", movie_entry.file)
        imdb_entry = await imdb_lookup_entry(movie_entry)
        console.log(`Found [${imdb_entry.id}] "${imdb_entry.l} ` + (imdb_entry.y? `(${imdb_entry.y})` : '') + '"')
        for (let language of languages){
            const subtitles = []
            const video_filename = imdb_entry.source;
            const subtitle_filename = video_filename + `.subagent-GENERATED.${language}`
            const video_path = `${rootDir}/${video_filename}`
            const video_parent_path = path.dirname(video_path)
            const has_subs = (await fs.readdir(video_parent_path))
                .filter(p => p.match(subtitle_filename) && p.match(sub_ext_pattern)).length > 0
            if(has_subs){
                console.log(`"${imdb_entry.l} (${imdb_entry.y})"`, "already has subtitles for language:", language, "skipping..." )
                continue;
            }
            console.log("Fetching subs for", `"${imdb_entry.l} (${imdb_entry.y})"`, "language:", language)
            sub_urls = await fetch_sub_urls(imdb_entry.id, language)
            console.log("Got", sub_urls.length, "subtitle candidates")
            for(let sub_url of sub_urls.slice(0,5)){
                compressed_archive = await fetch_sub_archive(sub_url)
                const got_archive = compressed_archive.length > 0;
                if(!got_archive) {
                    console.log("Download failed")
                    continue;
                }
                console.log("Download successful")
                archive = unzip_archive(compressed_archive)
                const subtitle_name = Object.keys(archive).find(filename => filename.match(sub_ext_pattern))
                if(!subtitle_name){
                    continue;
                }
                const subtitle = archive[subtitle_name]
                console.log(`Got subtitle file: "${subtitle_name}", size: ${subtitle.length}`)
                const subtitle_ext = subtitle_name.match(sub_ext_pattern)[1]
                const subtitle_path = `${rootDir}/${subtitle_filename}.${subtitle_ext}`
                const fixed_subtitle = subtitle_ext === 'srt'? fix_srt(subtitle) : subtitle
                await fs.writeFile(subtitle_path, fixed_subtitle, 'utf8')
                console.log(`Syncing "${subtitle_name}"`)
                let result;
                try {
                    result = await sync_subtitle(video_path, subtitle_path, 'subsync');
                } catch (err) {
                    console.log("Error for ", video_filename, err)
                }
                if(result && result.correlated){
                    console.log('Sync OK!\n', 'result:', result)
                    result.contents = await fs.readFile(subtitle_path, 'utf8')
                    result.score = (result.points || 0)/Math.sqrt(result.maxChange || 10000)
                    subtitles.push(result)
                    // If maximum change is less than 1 sec, the subtitle was probably a good fit from
                    // the start and we should use it.
                    if(result.maxChange < 1.0){
                        break;
                    } else {
                        console.log("Fit might not be so good, so will try and compare more subtitles...")
                    }
                } else {
                    // If subtitle is not correlated. Remove file to indicate that there
                    // is no good subtitle yet for this video
                    await fs.rm(subtitle_path)
                    console.log("Subtitle sync failed. Trying next sub\n", 'result:', result)
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
            }
        }
    }

    // Save request cache
    await write_http_cache();
}

main();
