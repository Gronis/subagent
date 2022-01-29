const fs = require('fs')
const path = require('path')

const list_directories = async (pathname, depth) => {
    if (depth == 0 || !(await fs.promises.stat(pathname)).isDirectory()){
        return null
    }
    const directory_lookups = (await fs.promises.readdir(pathname))
        .map(filename => path.join(pathname, filename))
        .map(async filepath => await list_directories(filepath, depth - 1))
    return (await Promise.all(directory_lookups))
        .flat()
        .filter(filename => filename)
        .concat([pathname])
}

// Probably a bad implementation of turning a callback watcher
// into an async generator (for older versions of nodejs)
async function* watch (path, options) {
    const { recursive, ...opts } = options || {}
    let onevent = null
    let event_queue = []
    const listener = (eventType, filename) => {
        event_queue.push({eventType, filename})
        if(onevent){
            onevent()
            onevent = null;
        }
    }
    // Attempt to do some recursive file-watch. 
    // Not perfect, cannot watch directories created after initial setup.
    // Max 3 recursion depth.
    if(recursive){
        (await list_directories(path, 3))
            .forEach(dirpath => fs.watch(dirpath, opts, listener))
    } else {
        fs.watch(path, opts, listener)
    }
    while(true){
        while(event_queue.length){
            yield (event_queue.shift())
        } 
        await new Promise(callback => {
            if(event_queue.length){
                callback()
            } else {
                onevent = callback
            }
        })
    }
}
if(fs.promises.watch){
    module.exports = fs.promises.watch
} else if(fs.watch){
    module.exports = watch
} else {
    module.exports = null
}
