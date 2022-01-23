
const fs = require('fs').promises;
const path = require('path');
const http_request = require('./http_request');

const make_api = (cache_path, api_keys) => {

    let api_key_index = 0;
    let api_key_resets = Array(api_keys.length)

    const api_key = () => {
        return api_keys[api_key_index]
    }

    const rotate_api_key = (reset_time_utc) => {
        console.log("Changing api key...")
        api_key_resets[api_key_index] = reset_time_utc
        api_key_index = (api_key_index + 1) % api_keys.length;
    }
    
    const blocked = () => {
        const millis_diff = new Date((api_key_resets[api_key_index] || null)) - new Date()
        return millis_diff > 0;
    }

    const save_subtitle = async (file_id, subtitle) => {
        const filepath = path.join(cache_path, ("" + file_id + subtitle.extension))
        await fs.writeFile(filepath, subtitle.contents)
    }

    const load_subtitle = async file_id => {
        // Extract filename by matching file_id against files in cache.
        const filename = (await fs.readdir(cache_path))
            .filter(filename => filename.match("^" + file_id + "\\."))
            .find(() => true)
        if(!filename){
            return {
                contents: "",
                extension: "",
            }
        }
        const filepath = path.join(cache_path, filename)
        const extension = path.extname(filename)
        try {
            const contents = await fs.readFile(filepath, 'utf8');
            if (contents) {
                return {
                    contents,
                    extension
                }
            }
        } catch {
            return {
                contents: "",
                extension: "",
            }
        }
    }

    const request_subtitles = async (imdb_id, language) => {
        if(!imdb_id){
            return { data: []}
        }
        const id = parseInt(imdb_id.replace(/tt0*/, ''))
        const url = `https://api.opensubtitles.com/api/v1/subtitles?imdb_id=${id}&languages=${language}`
        const headers = {
            'Api-Key': api_key(),
            'Content-Type': 'application/json',
        }
        const response = await http_request(url, { headers })
        if(response.statusCode == 200){
            return JSON.parse(response.body)
        } else {
            return { data: []}
        }
    }

    const request_download = async (file_id) => {
        if(!file_id){
            return {}
        }
        const url = 'https://api.opensubtitles.com/api/v1/download'
        const headers = {
            'Api-Key': api_key(),
            'Content-Type': 'application/json',
        }
        const method = 'POST'
        const body = JSON.stringify({ file_id })
        const response = await http_request(url, { headers, body, method })
        // Status 406 is returned when keys are exhausted.
        if(response.statusCode == 200 || response.statusCode == 406){
            return JSON.parse(response.body)
        } else if( response.statusCode == 502) {
            console.log("Server error. Retrying in 5 seconds.")
            await new Promise(r => setTimeout(r, 5000));
            return await request_download(file_id)
        } else {
            console.log("Error requesting", url, "statusCode:", response.statusCode)
            return {}
        }
    }

    const query = async (imdb_id, language) => {
        // Result is a list of files:
        // {
        //     file_id: Number,
        //     file_name: "file.stl",    // Can be null!!
        // }
        return (await request_subtitles(imdb_id, language))
            .data
            .map(entry => entry.attributes.files)
            .filter(files => files && files.length == 1) // Don't use "multi cd subs"
            .flat()
            .filter(file => file.file_id) // If for some reason file_id is null or similar.
    }

    const download = async (file) => {
        const subtitle = await load_subtitle(file.file_id)
        if(subtitle && subtitle.extension && subtitle.contents){
            return subtitle;
        }
        if(blocked()){
            console.log("Api keys are exhaused. Will reset within 24 hours.")
            return subtitle;
        }
        const response1 = await request_download(file.file_id)
        if(response1.remaining < 0 && !response1.link){
            rotate_api_key(response1.reset_time_utc)
            return await download(file)
        }
        if(!response1.link){
            return subtitle;
        }
        const response2 = await http_request(response1.link)
        if(response2.statusCode == 200){
            const filename = response1.file_name || file.file_name
            subtitle.contents = response2.body
            subtitle.extension = path.extname(filename) || '.stl' 
            await save_subtitle(file.file_id, subtitle)
            return subtitle
        } else {
            console.log("Error requesting", url, "statusCode:", response2.statusCode)
            return subtitle
        }
    }

    return {
        blocked,
        query,
        download,
    }
}

module.exports = make_api;