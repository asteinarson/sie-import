
export type Dict<T> = Record<string,T>

// A fully permissive object
export type AnyObject = Dict<any>;

export function isArray(a: any): a is any[] {
    return Array.isArray(a);
}

export function isObject(o: any, strict?: boolean): o is AnyObject {
    return typeof o == "object" && (!strict || !isArray(o)) && o !== null;
}

export function firstKey(o: Object): string|undefined {
    for (let p in o) {
        if (o.hasOwnProperty(p)) return p;
    }
    return undefined
}

// A function that returns if object is empty or not
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

