
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

    const save_subtitle = async (file_id, contents) => {
        const filepath = path.join(cache_path, ("" + file_id))
        await fs.writeFile(filepath, contents)
    }

    const load_subtitle = async file_id => {
        const filepath = path.join(cache_path, ("" + file_id))
        try {
            const contents = await fs.readFile(filepath, 'utf8');
            if (contents) {
                return contents;
            }
        } catch {
            return '';
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
        return (await request_subtitles(imdb_id, language))
            .data
            .map(entry => entry.attributes.files)
            .filter(files => files && files.length == 1) // Don't use "multi cd subs"
            .map(files => files[0])
            .flat()
    }

    const download = async (file) => {
        const subtitle = await load_subtitle(file.file_id)
        if(subtitle){
            return subtitle;
        }
        if(blocked()){
            console.log("Api keys are exhaused. Will reset within 24 hours.")
            return '';
        }
        const response1 = await request_download(file.file_id)
        if(response1.remaining < 0 && !response1.link){
            rotate_api_key(response1.reset_time_utc)
            return await download(file)
        }
        if(!response1.link){
            return '';
        }
        const response2 = await http_request(response1.link)
        if(response2.statusCode == 200){
            const subtitle = response2.body
            await save_subtitle(file.file_id, subtitle)
            return subtitle
        } else {
            console.log("Error requesting", url, "statusCode:", response2.statusCode)
            return '';
        }
    }

    return {
        blocked,
        query,
        download,
    }
}

module.exports = make_api;