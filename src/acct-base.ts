import { getAll, checkTable, upsert } from "./acct-db.js"
import { Dict } from "./utils.js"

let config: Record<string, string> = {}

export async function init() {
    let r = await checkTable("verification", ["id","description","number"]);
    if( Array.isArray(r) ){
        console.log( "init - checkTable, failed: ", r )
        return false
    }
    await readConfig()
    return true
}

async function readConfig() {
    let r = await getAll("config");
    config = {}
    r.forEach((c: any) => {
        config[c.key] = c.value
    });    
}    

export function getConfig(key: string, default_val: string): string {
    let v = config[key]
    if (v != undefined) return v
    return default_val
}

export async function setConfig(key: string, value: string, comment?:string ) {
    // Optimistic approach
    config[key] = value
    let vals:Dict<string> = { key, value }
    if( comment ) vals.comment = comment
    return upsert("config", vals, "key")
}
