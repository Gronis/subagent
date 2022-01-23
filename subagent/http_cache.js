const fs = require('fs').promises;
const path = require('path');
const http_request = require('./http_request');

const open = async (filepath) => {
    let request_cache = {};
    let request_count = 0;
    let write_task = null;

    const cache_filepath = filepath
    const read_http_cache = async () => {
        try {
            const http_cache = await fs.readFile(cache_filepath, 'utf8');
            if (http_cache) {
                request_cache = JSON.parse(http_cache)
            }
            return true;
        } catch {
            return false;
        }
    }
    
    const write_http_cache = async () => {
        if(request_count > 0){
            request_count = 0;
            await fs.writeFile(cache_filepath, JSON.stringify(request_cache));
        }
    }
    await read_http_cache();
    
    const cached_http_request = async (url, options) => {
        if (request_cache[url]) {
            return request_cache[url]
        }
        const response = await http_request(url, options)
        if(response.statusCode == 200){
            request_cache[url] = response
            request_count++;
            if(!write_task){
                write_task = setTimeout(write_http_cache, 1000 * 30)
            }
        }
        if (request_count > 10){
            await write_http_cache()
        }
        return response
    }
    return cached_http_request
}

module.exports.open = open;