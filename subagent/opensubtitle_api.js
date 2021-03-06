
const fs = require('fs').promises;
const path = require('path');
const http_cache = require('./http_cache');
const http_request = require('./http_request');

const make_api = async (cache_path, api_keys) => {

    const cache_filepath = path.join(cache_path || './', 'opensubtitle_http_cache.json')
    const cached_http_request = await http_cache.open(cache_filepath)

    let api_key_index = 0;
    let api_key_resets = Array(api_keys.length)

    const get_api_key = () => {
        return api_keys[api_key_index]
    }

    const get_headers = () => {
        return {
            'Api-Key': get_api_key(),
            'Content-Type': 'application/json',
            'User-Agent': 'SubAgent/0.0',
        }
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
                file_id,
            }
        }
        const filepath = path.join(cache_path, filename)
        const extension = path.extname(filename)
        try {
            const contents = await fs.readFile(filepath, 'utf8');
            if (contents) {
                return {
                    contents,
                    extension,
                    file_id,
                }
            }
        } catch {}
        return {
            contents: "",
            extension: "",
            file_id,
        }
    }

    const request_subtitles = async (imdb_id, language) => {
        if(!imdb_id){
            return { data: []}
        }
        const id = parseInt(imdb_id.replace(/tt0*/, ''))
        const url = `https://api.opensubtitles.com/api/v1/subtitles?imdb_id=${id}&languages=${language}`
        const headers = get_headers();
        const response = await cached_http_request(url, { headers })
        if(response.statusCode == 200){
            return JSON.parse(response.body)
        } else if (response.statusCode == 502) {
            console.log("Server error. Retrying in 5 seconds.")
            await new Promise(r => setTimeout(r, 5000));
            return await request_subtitles(imdb_id, language)
        } else {
            console.log("Error requesting", url, "statusCode:", response.statusCode)
            return { data: []}
        }
    }

    const request_download = async (file_id) => {
        if(!file_id){
            return {}
        }
        const url = 'https://api.opensubtitles.com/api/v1/download'
        const method = 'POST'
        const headers = get_headers();
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
            console.log("Error requesting", url, "Response:", response)
            return {}
        }
    }

    const query = async (imdb_id, language) => {
        // Result is a list of files:
        // {
        //     file_id: Number,
        //     file_name: "file.stl",           // Can be null!!
        //     release: "file.release.type",    // Can be null!!
        // }

        // TODO: Add support for multi-cd subtitle.
        // We can sync a multi cd release in several passes and then join the subtitle afterwards.
        return ((await request_subtitles(imdb_id, language)).data || [])
            .map(entry => entry.attributes.files.map(f => ({release: entry.attributes.release, ...f})))
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
            console.log("Error requesting", response1.link, "Response:", response2)
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