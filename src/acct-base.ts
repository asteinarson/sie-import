import { getAll, checkTable, upsert } from "./entity-db.js"
import { Dict } from "./utils.js"

let config: Record<string, string> = {}

export async function init() {
    let db_cols: Dict<string[]> = {
        verification: ["id", "description", "number", "date"],
        verification_row: ["credit", "debet", "verification_id", "account_id"],
        account: ["number", "description", "type", "year"],
        config: ["key", "value"],
    }
    let es:string[]= [];
    for (let k of Object.keys(db_cols)) {
        let e = await checkTable(k, db_cols[k]);
        if (e)  es = es.concat(e);
    }
    if( es.length>0 ){
        console.log("init - checkTable - failed on: \n" + es.toString());
        return false;
    }
    await readConfig()
    return true
}

async function readConfig() {
    let r = await getAll("config");
    config = {}
    r.forEach((c: any) => {
        config[c.key] = c.value;
    });
}

export function getConfig(key: string, default_val: string): string {
    let v = config[key]
    if (v != undefined) return v
    return default_val
}

export async function setConfig(key: string, value: string, comment?: string) {
    // Optimistic approach
    config[key] = value
    let vals: Dict<string> = { key, value }
    if (comment) vals.comment = comment
    return upsert("config", vals, "key")
}
