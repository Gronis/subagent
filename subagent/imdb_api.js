
const fs = require('fs').promises;
const path = require('path');
const http_request = require('./http_request');
const utils = require('./utils');
const query_extractor = require('./query_extractor');

const make_api = async (cache_path) => {
    let request_cache = {};
    let request_count = 0;
    let write_task = null;

    const read_http_cache = async () => {
        const filepath = path.join(cache_path || './', 'imdb_http_cache.json')
        try {
            const http_cache = await fs.readFile(filepath, 'utf8');
            if (http_cache) {
                request_cache = JSON.parse(http_cache)
            }
            return true;
        } catch {
            return false;
        }
    }
    
    const write_http_cache = async () => {
        request_count = 0;
        const filepath = path.join(cache_path || './', 'imdb_http_cache.json')
        await fs.writeFile(filepath, JSON.stringify(request_cache));
    }
    // This is just a http request cache to not make imdb ban me while developing
    const cache_loaded = await read_http_cache();
    console.log('Loaded imdb cache: ', cache_loaded)
    
    const cached_http_request = async url => {
        if (request_cache[url]) {
            return request_cache[url]
        }
        const response = await http_request(url)
        if(response.statusCode == 200){
            request_cache[url] = response
            request_count++;
            if(!write_task){
                write_task = setTimeout(write_http_cache, 1000 * 30)
            }
        }
        if (request_count > 1){
            await write_http_cache()
        }
        return response
    }

    const score = (imdb_entity) => {
        return (// Add score for title similarity
            query_extractor.compare(imdb_entity.source.query, imdb_entity.query) +
            // Add points for matching year
            (imdb_entity.source_year ? !!imdb_entity.source.year.match(imdb_entity.year) * 10 : 0) +
            // Add score if it is a movie
            (imdb_entity.type === 'feature') * 20 +
            // Add score if it is a video (a few movies are videos in imdb)
            (imdb_entity.type === 'video') * 10
        )
    }
    
    const request = async (query, year) => {
        const url = `https://v2.sg.media-imdb.com/suggestion/${query[0]}/${query}.json`
        const response = await cached_http_request(url)
        if (response.statusCode == 200) {
            return (JSON.parse(response.body).d || [])
                .map(r => {
                    const q = query_extractor.from_text(r.l) + ((year && r.y) ? '_' + r.y : '')
                    return {
                        id: r.id,
                        title: r.l,
                        type: r.q,
                        year: r.y,
                        query: q,
                        source: {
                            year,
                            query,
                        }
                    }
                })
        }
        return []
    }
    
    const query = async query_raw => {
        let imdb_entities = []
        for (const query of query_raw.split(',')) {
            const year = query_extractor.year(query)
            imdb_entities = imdb_entities.concat(await request(query, year))
            const query_stripped = query_extractor.trim_year(query)
            imdb_entities = imdb_entities.concat(await request(query_stripped, year))
    
            // Query with maximum 20 characters (imdb web ui maximum)
            // if no movies were found
            if (imdb_entities.filter(r => r.q === 'feature').length == 0) {
                const query_stripped = query.slice(0, 20)
                imdb_entities = imdb_entities.concat(await request(query_stripped, year))
            }
        }
        // If we have imdb_entities at this point, score and pick the best one.
        if (imdb_entities.length > 0) {
            const imdb_entity = imdb_entities
                .sort((r1, r2) => score(r2) - score(r1))
                .find(() => true)
            return imdb_entity
        }
    
        // If we exhaust all queries without finding anything,
        // return this stump (useful for debuging)
        return {
            id: undefined,
            title: undefined,
            type: undefined,
            year: undefined,
            query: undefined,
            source: {
                year: query_extractor.year(query_raw),
                query: query_raw
            }
        }
    }

    return {
        query
    }
}

module.exports = make_api;