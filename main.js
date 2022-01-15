const fs = require('fs').promises
const http_request = require('./http_request');

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
        'V': '5',
        'VI': '6',
        'VII': '7',
        'VIII': '8',
        'IX': '9',
        'X': '10',
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

const extract_movie_name_from_path = (path) => {
    // Uses filename or dirname to find a good seach term.
    const filename = path.split('/').splice(-1)[0] || ''
    const parentname = path.split('/').splice(-2)[0] || ''
    const parentparentname = path.split('/').splice(-3)[0] || ''
    // Assume parent name is a good starting point.
    let result = [extract_movie_name_from_name(parentname) || '']
    // If we find "pack" or "complete" in the parent name,
    // assume this is a move pack and prefer name from file name.
    if (is_movie_pack(parentname)) {
        result = [extract_movie_name_from_name(filename) || '']
        // If parent name doesnt have a year in it, but filename has a year,
        // prefer using filename over parent name
    } else if (!result.some(s => match_year(s))) {
        result.push(extract_movie_name_from_name(filename))
    }
    // If we still have no year at this point, try upper parent and see
    // if that title contains a year. If not, use old result.
    if (!result.some(s => match_year(s))) {
        const tmp_result = extract_movie_name_from_name(parentparentname)
        if (match_year(tmp_result)) {
            result.push(tmp_result)
        }
    }
    // Sort so that we prioritize titles with years,
    // Otherwise sort for the longest title.
    return {
        'parent': parentname,
        'file': filename,
        'query': result.sort((s1, s2) => {
            const year_prio = !!match_year(s2) - !!match_year(s1)
            return year_prio || s2.length - s1.length
        })
    }
}
const extract_movie_name_from_name = (name) => {
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
        .slice(0, finalEndIndex).join('_').toLowerCase()
    return result
}

const remove_samples = (movies) => {
    return movies.filter(p => !p.toLowerCase().match('sample'))
}

// This is just a http request cache to not make imdb ban me while developing
let REQUEST_CACHE = {};
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

const strip_year = query => {
    return query.replace(/_[0-9][0-9][0-9][0-9]$/, '')
}

const query_imdb = async (query) => {
    const url = `https://v2.sg.media-imdb.com/suggestion/${query[0]}/${query}.json`
    const response = await request(url)
    if (response.statusCode == 200) {
        return (JSON.parse(response.body).d || [])
    }
    return []
}

// Scores similar titles. Higher score is "more similar"
const title_diff_score = (t1, t2) => {
    const count_matching_words = (
        t1.split('_').map(w => w && !!t2.match(w)).reduce((c1, c2) => c1 + c2) +
        t2.split('_').map(w => w && !!t1.match(w)).reduce((c1, c2) => c1 + c2)
    )
    const is_substring = (!!t1.match(t2) || !!t2.match(t1))

    return (count_matching_words < 1 ? -10 : count_matching_words)
        - Math.abs(t1.split('_').length - t2.split('_').length)
        + is_substring * 10
}

const score_imdb_entity = (imdb_entity, query, year) => {
    imdb_entity.query = extract_movie_name_from_name(imdb_entity.l) + ((year && imdb_entity.y) ? '_' + imdb_entity.y : '');
    imdb_entity.source_query = query
    imdb_entity.source_year = year
    imdb_entity.score =
        // Add score for title similarity
        title_diff_score(query, imdb_entity.query) +
        // Add points for matching year
        (year ? !!year.match(imdb_entity.y) * 5 : 0) +
        // Add score if it is a movie
        (imdb_entity.q === 'feature') * 20 +
        // Add score if it is a video (a few movies are videos in imdb)
        (imdb_entity.q === 'video') * 10
    return imdb_entity
}

const lookup_entry = async entry => {
    const query = entry.query[0]
    const year = match_year(query)
    let results = await query_imdb(query)

    // Query without the year if no movies where found
    if (results.filter(r => r.q === 'feature').length == 0) {
        const query_stripped = strip_year(query)
        results = results.concat(await query_imdb(query_stripped))
    }

    // Query with maximum 20 characters (imdb web ui maximum)
    // if no movies were found
    if (results.filter(r => r.q === 'feature').length == 0) {
        const query_stripped = query.slice(0, 20)
        results = results.concat(await query_imdb(query_stripped))
    }

    // If we have results at this point, score and pick the best one.
    if (results.length > 0) {
        const result = results
            .map(r => score_imdb_entity(r, query, year))
            .sort((r1, r2) => r2.score - r1.score)[0]
        result.source = entry.file;
        return result
    }
    // If no nothing is still found, try next query instead
    else if (entry.query.length > 1) {
        entry.query = entry.query.slice(1)
        return await lookup_entry(entry)
    }

    // If we exhaust all queries without finding anything,
    // return this stump (useful for debuging)
    return {
        l: query,           // title (use for debuging)
        source: entry.file,
        score: -100,
    }
}

const main = async () => {
    const movies_filenames_raw = (await fs.readFile('movies.txt', 'utf8')).split('\n')
    const movies_filenames_filtered = remove_samples(movies_filenames_raw)
    
    // const movie_entries = ['/tank/storage/movies/Fast and Furious Collection (2001-2019) (1080p BDRip x265 10bit EAC3 5.1 - xtrem3x) [TAoE]/Fast and Furious 6 (2013) (1080p BDRip x265 10bit EAC3 5.1 - xtrem3x) [TAoE].mkv'].map(m => extract_movie_name_from_path(m))
    const movie_entries = movies_filenames_filtered.slice(0, 600).map(m => extract_movie_name_from_path(m))
    const imdb_entries = (await Promise.all(movie_entries.map(m => lookup_entry(m))))
    console.log(imdb_entries.map(e => `${e.id}: ${e.l} (${e.y || e.source_year}) \n     File: ${e.source.slice(0,100)}\n    Score: ${e.score}`).join("\n"))
    await write_http_cache();
}

main();