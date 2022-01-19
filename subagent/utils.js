

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
    return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
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
    unescape_leetspeak,
    unescape_roman_numbers,
    is_movie_pack,
    escape_regex,
    detect_text_encoding,
}