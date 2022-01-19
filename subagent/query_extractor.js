
const path = require('path');
const utils = require('./utils');

const year = (query) => {
    query = ' ' + query.split('_').reverse().join(' ')
    const regex_year = /[ \.\-\_,][0-9][0-9][0-9][0-9]/;
    const match = query.match(regex_year)
    if (match) {
        return match[0].trim()
    }
    return false;
}

const trim_year = query => {
    return query.replace(/_[0-9][0-9][0-9][0-9]$/, '')
}

const from_path = (filepath) => {
    // Uses filename or dirname to find a good seach term.
    const filename = path.basename(filepath)
    const parentpath = path.basename(path.dirname(filepath))
    const parentparentpath = path.basename(path.dirname(path.dirname(filepath)))
    let results = []
    // If parent name looks like a movie pack, dont use it.
    if (!utils.is_movie_pack(parentpath)) {
        results = [
            from_text(parentpath),
            from_text(filename)
        ]
    } else {
        results = [from_text(filename)]
    }
    results = results.filter(n => n) // Remove empty strings

    // If we still have no year at this point, try upper parent and see
    // if that title contains a year. If not, use old result.
    if (!results.some(s => year(s)) && !utils.is_movie_pack(parentparentpath)) {
        const tmp_result = from_text(parentparentpath)
        if (year(tmp_result)) {
            results.push(tmp_result)
        }
    }
    // Sort so that we prioritize titles with years,
    // Otherwise sort for the longest title.
    return results.sort((s1, s2) => {
        const year_prio = !!year(s2) - !!year(s1)
        return year_prio || s2.length - s1.length
    }).join(',')
    // return {
    //     path: path.join(parentpath, filepath),
    //     query: results.sort((s1, s2) => {
    //         const year_prio = !!year(s2) - !!year(s1)
    //         return year_prio || s2.length - s1.length
    //     })
    // }
}

const from_text = (name) => {
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
        .replace(/\[[^\[]*\]/g, ' ')
        .replace(/\([^0-9]*\)/g, ' ')
        .replace(/[']/g, '')
        .split(whitespace)
        .filter(w => !regex_remove_words.some(p => w.match(p)))
        .map(w => w.trim().replace(/[\(|\)|\[|\]]/g, ''))
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
        .map(w => utils.unescape_leetspeak(w))
        .map(w => utils.unescape_roman_numbers(w))
        .slice(0, finalEndIndex)
        .join('_').toLowerCase()
        .replace(/__/g, '_') // Sometimes, dubble underscores can occur
    return result
}

// Scores similar queries. Higher score is "more similar"
const compare = (t1, t2) => {
    t1 = utils.escape_regex(t1)
    t2 = utils.escape_regex(t2)
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

module.exports = {
    from_path,
    from_text,
    compare,
    year,
    trim_year,
}