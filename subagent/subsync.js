const proc = require('child_process');

const subsync = (video_filename, subtitle_filename, method = 'subsync') => {
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
                result.correlated = false
                accept(result);
            }
        });
        const on_data = d => {
            const data = d.toString()
            if(!data.match(/[0-9][0-9]\:[0-9][0-9]\:[0-9][0-9]\.[0-9][0-9][0-9]\:/)){
                process.stdout.write(data)
            }
            if(data.match('ERROR')){
                console.log("Got error", data)
                result.correlated = false
                accept(result);
            }
            if(data.match('speech recognition model is missing')){
                reject('Speech recognition model is missing');
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

module.exports = subsync