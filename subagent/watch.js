const fs = require('fs')

// Probably a bad implementation of turning a callback watcher
// into an async generator (for older versions of nodejs)
async function* watch (path) {
    let onevent = null
    let event_queue = []
    const listener = (eventType, filename) => {
        event_queue.push({eventType, filename})
        if(onevent){
            onevent()
            onevent = null;
        }
    }
    fs.watch(path, null, listener)
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
