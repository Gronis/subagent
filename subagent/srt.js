// Strange encoding can sometimes mess up srt files.
// Try to fix them again. 
// Also detect and remove ads. <-- Not done yet
const fix = subtitle => {
    const pattern = /[0-9][0-9]\:[0-9][0-9]\:[0-9][0-9]\,[0-9][0-9][0-9] -->/g
    const fix_textbox = textbox => {
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
        .replace(/\n\n([0-9][0-9]?[0-9]?[0-9]?\n)?/g, '\n\n') // Remove textbox numbers
        .split('\n\n')
        .slice(1) // Remove first textbox. This one if often broken and full of ads.
        .map((t, i) => `${i+1}\n${t}`)
        .join('\n\n')
}

module.exports.fix = fix