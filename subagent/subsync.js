const proc = require('child_process');

const subsync = async (video_filename, subtitle_in_filename, subtitle_out_filename, extra_args) => {
    const result = await new Promise((accept, reject) => {
        extra_args = extra_args || []
        const args = [
            // Need loglevel INFO to read status of sync
            '-c', '--overwrite', '--loglevel=INFO', 
            // Use maximum effort to sacrifice compute time for better subtitle sync.
            '--effort=1.0',
            'sync' ,
            '--ref', video_filename, 
            '--sub', subtitle_in_filename, 
            '--out', subtitle_out_filename,
            ...extra_args,
        ]
        const sync_subtitle = proc.spawn('subsync', args);
        let result = {}
        sync_subtitle.on('error', (err) => {
            let msg = JSON.stringify(err, undefined, 2)
            reject(`Sync process exited with error: ${msg}`);
        })
        sync_subtitle.on('exit', (code) => {
            if(code == 0){
                accept(result);
            } else if (result.points >= 0) {
                result.correlated = false;
                accept(result);
            } else {
                reject('Sync failed, subsync process stopped with no data-points.');
            }
        });
        const on_data = d => {
            const data = d.toString()
            if(!data.match(/[0-9][0-9]\:[0-9][0-9]\:[0-9][0-9]\.[0-9][0-9][0-9]\:/)){
                process.stdout.write(data)
            }
            if(data.match('ERROR')){
                console.log("ERROR in sybsync process:", data)
                const stop_early_errors = [
                    'File ended prematurely',
                ]
                // Stop sync prematurly if necessary
                if(sync_subtitle.exitCode === null && stop_early_errors.some(e => data.includes(e))){
                    sync_subtitle.kill();
                    reject(data);
                }
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
    result.score = (result.points || 0)/Math.sqrt(result.maxChange || 10000)
    // From testing, scores under 2.5 seam to be out of sync.
    if(result.score < 2.5){
        result.correlated = false
    }
    return result
}

module.exports = subsync
