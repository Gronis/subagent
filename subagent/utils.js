
const unescape_weird_characters = word => {
    return word
        .replace(/á|à|â|ǎ|ă|ã|ả|ȧ|ạ|ä|å|ḁ|ā|ą|ᶏ|ⱥ|ȁ|ấ|ầ|ẫ|ẩ|ậ|ắ|ằ|ẵ|ẳ|ặ|ǻ|ǡ|ǟ|ȁ|ȃ|ɑ|ᴀ|ɐ|ɒ|ａ|æ|ᴁ|ᴭ|ᵆ|ǽ|ǣ|ᴂ/g, 'a')
        .replace(/ḃ|ḅ|ḇ|ƀ|ɓ|ƃ|ᵬ|ᶀ|ʙ|ｂ|ȸ/g, 'b')
        .replace(/ć|ĉ|č|ċ|Cc̄|ç|ḉ|ȼ|ƈ|ɕ|ᴄ|ｃ/g, 'c')
        .replace(/ď|ḋ|ḑ|ḍ|ḓ|ḏ|đ|ð|Dd̦|ɖ|ɗ|ƌ|ᵭ|ᶁ|ᶑ|ȡ|ᴅ|ｄ|þ|ȸ|ǳ|ǆ/g, 'd')
        .replace(/é|è|ê|ḙ|ě|ĕ|ẽ|ḛ|ẻ|ė|ë|ē|ȩ|ę|ᶒ|ɇ|ȅ|ế|ề|ễ|ể|ḝ|ḗ|ḕ|ȇ|ẹ|ệ|ⱸ|ᴇ|ə|ǝ|ɛ|ｅ|ᴂ|ᴔ|æ|ᴁ|ᴭ|ᵆ|ǽ|ǣ|œ|ᵫ/g, 'e')
        // .replace(//g, '') // <--- Template
        // TODO Add more from here: https://en.wiktionary.org/wiki/Appendix:Latin_script
        .replace(/ú|ù|ŭ|û|ǔ|ů|ü|ǘ|ǜ|ǚ|ǖ|ű|ũ|ṹ|ų|ū|ṻ|ủ|ȕ|ȗ|ư|ứ|ừ|ữ|ử|ự|ụ|ṳ|ṷ|ṵ|ʉ|ʊ|ȣ|ᵾ|ᶙ|ᴜ|ｕ|ᵫ/g, 'u')
        .replace(/ö/g, 'o')
}

const unescape_leetspeak = word => {
    const is_leet = word.match(/[0-9]/) && word.match(/[a-zA-Z]/)
    return is_leet ? word
        .replace(/0/g, 'o')
        .replace(/1/g, 'l')
        .replace(/2/g, 'z')
        .replace(/3/g, 'e')
        .replace(/4/g, 'a')
        .replace(/5/g, 's')
        .replace(/6/g, 'g')
        .replace(/7/g, 't')
        .replace(/8/g, 'b')
        .replace(/9/g, 'p')
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

const is_movie_pack = unstructed_text => {
    return unstructed_text
        .toLowerCase()
        .match(/([^r][^e]pack)|(complete)|(collection)/)
}

const escape_regex = pattern => {
    // $& means the whole matched string
    return pattern? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern; 
}

const detect_text_encoding = buffer => {
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

module.exports = {
    unescape_weird_characters,
    unescape_leetspeak,
    unescape_roman_numbers,
    is_movie_pack,
    escape_regex,
    detect_text_encoding,
}