// Strange encoding can sometimes mess up srt files.
// Try to fix them again. 
// Also make an attempt to detect and remove ads.
const fix = subtitle => {
    const pattern = /[0-9][0-9]\:[0-9][0-9]\:[0-9][0-9]\,[0-9][0-9][0-9] -->/g
    const fix_textbox = textbox => {
        const contains_url = textbox.match(/((https?\:\/\/)|(www\.))[a-zA-Z0-9]+/g)
        // Remove lines with ads.
        if(contains_url) return '\n\n';
        let m = pattern.exec(textbox)
        while((m = pattern.exec(textbox))){
            const i = m.index
            textbox = textbox.slice(0, i) + '\n' + textbox.slice(i)
        }
        return textbox
    }
    return subtitle
        .replace(/\r/g, '') // We dont want windows style newline (\r\n)
        .split('\n\n') // Separate to textboxes
        .map(fix_textbox)
        .join('\n\n') // Join textboxes.
        .replace(/^1\n/, '') // Remove first textbox numbers
        .replace(/\n\n([0-9][0-9]?[0-9]?[0-9]?)\n/g, '\n\n\n') // Remove in-between textbox numbers
        .replace(/\n\n/g, '\n')
        .split('\n\n')
        .filter(t => t.includes('\n'))
        .map((t, i) => `${i+1}\n${t}`)
        .join('\n\n')
}

module.exports.fix = fix
