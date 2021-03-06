
const path = require('path');
const utils = require('./utils');

const REGEX_WHITESPACE = /[ \.\-\_,:?`'·]/

const REGEX_HARD_END_WORDS = [
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
const REGEX_SOFT_END_WORDS = [
    /^hevc$/,
    /^avc$/,
    /^hdr$/,
    /^sdr$/,
    /^hc$/,
    /^ee$/,
]
const REGEX_REMOVE_WORDS = [
    /^\+$/,
    /^\[.*\]/,
    /^\([^0-9]*\)$/,
    /^$/,
]
const REGEX_REMOVE_SENCENCES = [
    /_directors_cut/g,
]

const REGEX_YEAR = /^[0-9][0-9][0-9][0-9]$/;

const year = (query) => {
    query = ' ' + query.split('_').reverse().join(' ')
    const REGEX_YEAR = /[ \.\-\_,]?([0-9][0-9][0-9][0-9])/;
    const match = query.match(REGEX_YEAR)
    if (match) {
        return match[1]
    }
    return 0;
}

const ensure_year = (query, year) => {
    if(!year || !query){
        return query
    }
    return trim_year(query) + '_' + year
}

const trim_year = query => {
    return query.replace(/_[0-9][0-9][0-9][0-9]$/, '')
}

const break_into_words = text => {
    return (text || '')
        .replace(/\[[^\[]*\]/g, ' ')
        .replace(/\([^0-9]*\)/g, ' ')
        .replace(/[']/g, '')
        .split(REGEX_WHITESPACE)
        .filter(w => !REGEX_REMOVE_WORDS.some(p => w.match(p)))
        .map(w => w.trim().replace(/[\(|\)|\[|\]]/g, ''))
        .map(w => w.replace(/^0+/, ''));
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
    results = results.filter(r => r) // Remove empty strings

    // If we still have no year at this point, try upper parent and see
    // if that title contains a year. If not, use old result.
    if (!results.some(s => year(s)) && !utils.is_movie_pack(parentparentpath)) {
        const tmp_result = from_text(parentparentpath)
        if (year(tmp_result)) {
            results.push(tmp_result)
        }
    }

    const y = results.map(s => year(s))[0]
    if(y){
        results = results.map(s => ensure_year(s, year(s) || y))
    }

    // Sort so that we prioritize titles with years,
    // Otherwise sort for the longest title.
    const result_sorted = [...new Set(results)]
        .sort((s1, s2) => s2.length - s1.length)
    return result_sorted.join(',')
}

const from_text = (name) => {
    const words = break_into_words(name)
    const softEndIndex = words
        .findIndex(w => REGEX_SOFT_END_WORDS.some(p => w.toLowerCase().match(p)))
    const hardEndIndex = words
        .findIndex(w => REGEX_HARD_END_WORDS.some(p => w.toLowerCase().match(p)))
    const yearIndex = words.length - [...words].reverse()
        .findIndex(w => w.match(REGEX_YEAR))
    const endIndices = [words.length, hardEndIndex, yearIndex || softEndIndex]
        .filter(y => y > 0)
    const finalEndIndex = Math.min(...endIndices)
    const result = words
        .map(w => utils.unescape_weird_characters(w))
        .map(w => utils.unescape_leetspeak(w))
        .map(w => utils.unescape_roman_numbers(w))
        .slice(0, finalEndIndex)
        .join('_').toLowerCase()
        .replace(/__/g, '_') // Sometimes, dubble underscores can occur
    return REGEX_REMOVE_SENCENCES.reduce((r, p) => r.replace(p, ''), result)
}

// Scores similar queries. Higher score is "more similar"
const compare = (q1, q2) => {
    q1 = utils.escape_regex(q1)
    q2 = utils.escape_regex(q2)
    q1words = [...new Set(q1.split('_').filter(w => w))]
        .filter(w => w != 'the' || w.length == 1)
    q2words = [...new Set(q2.split('_').filter(w => w))]
        .filter(w => w != 'the' || w.length == 1)
    const count_matching_words = (
        q1words.map(w => w && !!q2.match(w)).reduce((c1, c2) => c1 + c2, 0) +
        q2words.map(w => w && !!q1.match(w)).reduce((c1, c2) => c1 + c2, 0)
    )
    const count_missing_words = (
        q1words.map(w => w && !q2.match(w)).reduce((c1, c2) => c1 + c2, 0) +
        q2words.map(w => w && !q1.match(w)).reduce((c1, c2) => c1 + c2, 0)
    )
    const is_substring = 0 + !!(q1.match(q2) || q2.match(q1))
    const title_perfect_match = 0 + (trim_year(q1) === trim_year(q2))
    const no_matching_words = (count_matching_words <= 0)

    return (is_substring * 5)
        + (title_perfect_match * 10) +
        + (count_matching_words ** 2)
        - count_missing_words
        - (no_matching_words * 10)
        - (Math.abs(q1words.length - q2words.length) * 2)
}

const get_special_release_type = name_or_path => {
    const lower_case = (name_or_path || '').toLowerCase()
    const lower_words = break_into_words(lower_case)
    const is_unrated = !!lower_words.find(w => w === 'unrated') 
    const is_directors_cut = !!lower_case.match(/director.?s.?cut/g) || !!lower_case.match(/dir.?cut/g) 
    const is_ultimate_cut = !!lower_case.match(/ultimate.?cut/g) || !!lower_case.match(/ult.?cut/g) 
    const is_rogue_cut = !!lower_case.match(/rogue.?cut/g)
    const is_uncut = !!lower_words.find(w => w === 'uncut') 
    const is_remastered = !!lower_words.find(w => w === 'remastered') 
    const is_extended = !!lower_words.find(w => w === 'extended')  || !!lower_words.find(w => w === 'ext') 
    if(is_unrated) return 'Unrated'
    if(is_directors_cut) return 'DirectorsCut'
    if(is_ultimate_cut) return 'UltimateCut'
    if(is_rogue_cut) return 'RogueCut'
    if(is_uncut) return 'Uncut'
    if(is_remastered) return 'Remastered'
    if(is_extended) return 'Extended'
    return null;
}

const is_lang = (name_or_path, language_code) => !!(name_or_path || "")
    .split(REGEX_WHITESPACE)
    .find(w => w === language_code);

module.exports = {
    from_path,
    from_text,
    compare,
    year,
    trim_year,
    get_special_release_type,
    is_lang,
}