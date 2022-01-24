const path = require('path')
const fs = require('fs').promises

const open = async (cache_path, database_name) => {
    let table = {};
    let write_count = 0;

    const database_path = path.join(cache_path || './', database_name || 'database.json')

    const read_database = async () => {
        try {
            const http_cache = await fs.readFile(database_path, 'utf8');
            if (http_cache) {
                table = JSON.parse(http_cache)
            }
            return true;
        } catch {
            return false;
        }
    }
    
    const write_database = async () => {
        if(write_count > 0){
            write_count = 0;
            await fs.writeFile(database_path, JSON.stringify(table));
        }
    }
    await read_database();
    
    const load = async key => {
        if (table[key]) {
            return table[key]
        }
        return null
    }
    const store = async (key, value) => {
        table[key] = value
        write_count++;
        if (write_count > 0){
            await write_database()
        }
    }

    return {
        load,
        store,
    }
}

module.exports.open = open