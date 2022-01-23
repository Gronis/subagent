
const fs = require('fs').promises;
const path = require('path');
const http_request = require('./http_request');
const utils = require('./utils');
const query_extractor = require('./query_extractor');

const make_api = async (cache_path) => {
    let request_cache = {};
    let request_count = 0;
    let write_task = null;

    const cache_filepath = path.join(cache_path || './', 'imdb_http_cache.json')
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
        if (request_count > 10){
            await write_http_cache()
        }
        return response
    }

    const count_underscores = (text) => {
        return (text.match(/_/g) || []).length
    }

    const score = (imdb_entity) => {
        const year_score = (imdb_entity.source.year == imdb_entity.year) * 5 
            -(Math.abs(imdb_entity.source.year - imdb_entity.year) ** 2)
        const score = (// Add score for title similarity
            query_extractor.compare(imdb_entity.source.query, imdb_entity.query) +
            // Add points for matching year
            ((imdb_entity.source.year && imdb_entity.year)? year_score : 0) +
            // Add score if it is a movie
            (imdb_entity.type === 'feature') * 20 +
            // Add score if it is a video (a few movies are videos in imdb)
            (imdb_entity.type === 'video') * 10
            ) / Math.sqrt(Math.log(imdb_entity.rank))
        return score
    }
    
    const request = async (query, year, original_query) => {
        const url = `https://v2.sg.media-imdb.com/suggestion/${query[0]}/${query}.json`
        const response = await cached_http_request(url)
        // const year = query_extractor.year(original_query)
        if (response.statusCode == 200) {
            return (JSON.parse(response.body).d || [])
                .map(r => {
                    const q = query_extractor.from_text(r.l) + ((year && r.y) ? '_' + r.y : '')
                    return {
                        id: r.id,
                        title: r.l,
                        type: r.q,
                        rank: parseInt(r.rank || '10000000'),
                        year: parseInt(r.y || '0'),
                        query: q,
                        source: {
                            year: parseInt(year || '0'),
                            query: original_query || query,
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
            imdb_entities = imdb_entities.concat(await request(query_stripped, year, query))
    
            // Query with maximum 20 characters (imdb web ui maximum)
            // if no movies were found
            if (imdb_entities.filter(r => r.type === 'feature').length == 0) {
                const query_stripped = query.slice(0, 20)
                imdb_entities = imdb_entities.concat(await request(query_stripped, year, query))
            }

            // Longer files can sometimes be prepended with non-title stuff
            // If we think there are no good candidates at this point and more than 4 words are used,
            // make a query with the first 2 words removed.
            if(year && imdb_entities.filter(r => r.year == year).length == 0){
                if(count_underscores(query) > 3){
                    const query_2_words_stripped = query.replace(/^[a-z]*_[a-z]*_/, '')
                    imdb_entities = imdb_entities.concat(await request(query_2_words_stripped, year, query))
                }
            }
        }

        // Good for debugging why a score is strange. Leave here for now.
        // if(query_raw.includes('movie_name_2000')){
        //     console.log(query_raw)
        //     console.log(imdb_entities.map(i => i.title + ' (' + i.year + ')' + " score: " + score(i)))
        // }

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
            id: '',
            title: '',
            type: '',
            rank: 10000000,
            year: 0,
            query: '',
            source: {
                year: query_extractor.year(query_raw),
                query: query_raw,
            }
        }
    }

    return {
        score,
        query,
    }
}

module.exports = make_api;