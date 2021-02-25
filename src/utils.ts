export function toCamelCase(s: string) {
    let parts = s.split("_");
    parts[0] = parts[0][0].toLowerCase() + parts[0].slice(1);
    let r = parts[0];
    for (let ix = 1; ix < parts.length; ix++) {
        r += parts[ix][0].toUpperCase() + parts[ix].slice(1);
    }
    return r;
}

export function toPascalCase(s: string) {
    let parts = s.split("_");
    let r = "";
    for (let ix = 0; ix < parts.length; ix++) {
        r += parts[ix][0].toUpperCase() + parts[ix].slice(1);
    }
    return r;
}

let proto_re = new RegExp("^(\\w+)://");
export function protoFromUrl(url: string) {
    let r = proto_re.exec(url);
    return r && r.length > 0 ? r[1] : "";
}

// A fully permissive object
export type AnyObject = { [k: string]: any };

export function isString(s: any): s is string {
    return typeof s == "string";
}

export function isNumber(n: any): n is number {
    return typeof n == "number";
}

let re_space = new RegExp("^s*$");
export function isNumeric(v: any): v is string | number {
    let t = typeof v;
    if (t == "number") return !isNaN(v);
    if (t == "string") {
        if (re_space.test(v)) return false;
        v = Number(v);
        return !isNaN(v);
    }
    return false;
}

export function isArray(a: any): a is any[] {
    return Array.isArray(a);
}

export function isObject(o: any, strict?: boolean): o is AnyObject {
    return typeof o == "object" && (!strict || !isArray(o)) && o !== null;
}

export function firstKey(o: Object): string {
    for (let p in o) {
        if (o.hasOwnProperty(p)) return p;
    }
    return undefined;
}

export function safeGet(o: AnyObject, key: string | string[]): any {
    if (!o) return undefined;
    if (isArray(key)) {
        for (let ix in key) {
            if (typeof o != "object") return undefined;
            let k = key[ix];
            if (k != "*") {
                if (!(k in o)) return undefined;
                o = o[k];
            } else {
                let r: any[] = [];
                let sub_key = key.slice(Number(ix) + 1);
                for (let k in o) {
                    let _r = safeGet(o[k], sub_key);
                    if (_r) r.push(_r);
                }
                return r;
            }
        }
        return o;
    } else {
        let keys = key.split(".");
        if (keys.length == 1) {
            if (key != "*") return o[key];
            else {
                let r: any[] = [];
                for (let k in o) r.push(o[k]);
                return r;
            }
        } else return safeGet(o, keys);
    }
}

export function pick(o: AnyObject, keys: string[]) {
    let new_obj: AnyObject = {};
    for (let k of keys) new_obj[k] = o[k];
    return new_obj;
}

export function isEqual(o1: AnyObject, o2: AnyObject) {
    if (isEmpty(o1) != isEmpty(o2)) return false;
    if (!isObject(o1)) {
        if (isObject(o2)) return false;
        return o1 == o2;
    } else if (!isObject(o2)) return false;

    let o1_l = 0;
    for (let k in o1) {
        let v1 = o1[k],
            v2 = o2[k];
        if (isObject(v1)) {
            if (!isObject(v2)) return false;
            if (!isEqual(v1, v2)) return false;
        } else {
            if (o1[k] != o2[k]) return false;
        }
        o1_l++;
    }
    return Object.keys(o2).length == o1_l;
}

// A function that quickly returns if object is empty or not
export function isEmptyObject(o: Object): boolean {
    return isObject(o, true) && !firstKey(o);
}

export function isEmptyArray(a: any[]): boolean {
    return a.length === 0;
}

export function isEmpty(a: any): boolean {
    if (typeof a == "object") return firstKey(a) == undefined;
    else return !a;
}

export function aSum(v: Array<Object>, prop?: string): number {
    if (prop) {
        return v.reduce<number>((a: number, o: any): number => {
            return a + (o[prop] ? Number(o[prop]) : 0);
        }, 0);
    } else {
        return v.reduce<number>((a: number, n: any): number => a + Number(n), 0);
    }
}

export function pluck(list: any[], field: string) {
    let r = [];
    for (let o of list) {
        if (field in o) r.push(o[field]);
    }
    return r;
}

export function aTop<T>(v: Array<Object>): T {
    return (v.length ? v[v.length - 1] : undefined) as T;
}

export interface iDate {
    day_of_month: 0;
    month: 0;
    year: 0;
}

export function dateToNumbers(d: Date) {
    let year = d.getFullYear();
    let month = d.getMonth();
    let day = d.getDate();
    return { day_of_month: day, month, year };
}

// Compressed 8 digit form, no separators
let re_date_compressed = new RegExp("^([0-9]{4})([0-9]{2})([0-9]{2})$");

// Generic format w two separators
let re_date_10_chars = new RegExp("^([0-9]{4})(.)([0-9]{1,2})(.)([0-9]{1,2})$");

export function dateTo10CharString(d: Date | string, sep = "-") {
    // If no proper date input, return an empty string
    if (!d) return "";
    let a: (string | number)[] = [];
    if (typeof d !== "string") {
        let dn = dateToNumbers(d);
        a = [dn.year, ("0" + (dn.month + 1)).slice(-2), ("0" + dn.day_of_month).slice(-2)];
    } else {
        let r = re_date_compressed.exec(d);
        if (r) {
            a = r.slice(1, 4);
        } else {
            r = re_date_10_chars.exec(d);
            if (r) {
                // Mismatch of separators?
                if (r[2] != r[4]) return "";
                // Sketchy check of date
                if (Number(r[3]) < 1 || Number(r[3]) > 12) return "";
                if (Number(r[5]) < 1 || Number(r[5]) > 31) return "";
                a = [r[1], r[3], r[5]];
            }
        }
    }
    return a.join(sep);
}

export function hrTimeToSeconds(time: number[], mult = 1) {
    return (time[0] + time[1] / 1000000000) * mult;
}
