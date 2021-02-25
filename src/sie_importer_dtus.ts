import "./gql_utils";
import { exists, getClient, getValue } from "../gql_utils";
import { Serie, getSeries, createSerie, setSerieNext } from "../serie";
import { setUser, setUserOrgImportValues, UserInfo } from "../user_org";
import {
    setAccountBalance,
    setAccountingImportValues,
    enableAccounts,
    verificationExists,
} from "../accounting";
//import { createImport, setImportValues } from "../import_export";
import { waitAll } from "../promise_sync";

import { INSERT_VERIFICATION, DELETE_VERIFICATION } from "../gql/Verifications";
import { DELETE_VERIFICATION_ROWS, INSERT_VERIFICATION_ROWS } from "../gql/VerificationRows";
import { ACCOUNTS, INSERT_ACCOUNT, MODIFY_ACCOUNT, ADD_ORG_ACCOUNT } from "../gql/Accounts";
import { VER_SEQ_MAX2 } from "../gql/Series";

let aclient = getClient();

function giveUp(msg: string, ec: number = -1) {
    console.log(msg);
    process.exit(ec);
}

function mergeSieComment(cols: string[]) {
    let comment = cols.join(" ");
    if (comment[0] == '"') comment = comment.slice(1, -1);
    return comment;
}

interface RowParser {
    word: string;
    words?: string[];
    info?: Dict<string>;
    parent: RowParser;
    count: number;
    errors: number;
    changed: number;
    is_done: boolean;
    openRow(cols: string[]): void;
    closeRow(): void;
    prepare(): void;
    done(): void;
}

class BaseParser implements RowParser {
    word = "";
    count = 0;
    errors = 0;
    changed = 0;
    is_done = false;

    constructor(public parent: RowParser, public options: Dict<any>) {}

    openRow(cols: string[]): void {}
    closeRow(): void {}
    prepare(): void {}
    done(): void {
        this.is_done = true;
    }
}

class VerParser extends BaseParser {
    word = "#VER";
    rows: Dict<any>[] = [];
    v: Dict<any>;
    series: Dict<number>;
    series_used: Dict<boolean> = {};
    dec_adjust: number = 0.0;
    new_vers: number[] = [];

    constructor(public parent: RowParser, public options: Dict<any>) {
        super(parent, options);
    }

    async prepare() {
        this.series = {};
        let series = getSeries();
        for (let k in series) {
            let s = series[k];
            this.series[s.name] = -1;
        }
    }

    openRow(cols: string[]) {
        this.v = { serie: cols[1], n: cols[2], date: cols[3], comment: mergeSieComment(cols.slice(4)) };
        this.rows = [];
        this.dec_adjust = 0.0;
        this.series_used[this.v.serie] = true;
        this.count++;
    }

    async closeRow() {
        try {
            // Commit verification to DB
            if (!this.series[this.v.serie]) {
                let r = await createSerie(this.v.serie);
                if (!r) {
                    this.errors++;
                    console.log("Failed creating series: " + this.v.serie);
                }
            }

            // Check that the accounts of the ver rows exists
            for (let row of this.rows) {
                let r = await AccountParser.checkAddAccount(Number(row.account), "<generated>");
                if (!r.id) this.errors++;
            }

            // Check if verification exists
            let ver_nr = this.v.serie + this.v.n;
            if (await verificationExists(ver_nr)) {
                // Delete if overwrite flag
                if (!this.options.exists_overwrite) {
                    console.log("Skipping (exists): " + ver_nr);
                    return;
                }
                await aclient.mutate({
                    mutation: DELETE_VERIFICATION,
                    variables: { ver_nr, u_id: this.options.user_id },
                });
            }
            // If w e get here, we either create or recreate the verification. Both count as a change.
            this.changed++;

            // Create the new verification
            let rr = await aclient.mutate({
                mutation: INSERT_VERIFICATION,
                variables: {
                    c_at: this.v.date,
                    d: this.v.comment,
                    v_nr: ver_nr,
                    u_id: this.options.user_id,
                },
            });
            let new_v_id = rr.data.insert_verification.returning[0].id;
            if (!new_v_id) {
                console.log("Failed creating new verification: " + ver_nr);
                this.errors++;
                return;
            }
            this.new_vers.push(new_v_id);

            // Do the rows

            // Create new ones
            let variables = { objects: [] as any[] };
            for (let ix in this.rows) {
                let row = this.rows[ix];
                let v_row = {
                    line: ix,
                    credit: row.credit,
                    debit: row.debit,
                    verification_id: new_v_id,
                    account_id: AccountParser.accounts[row.account],
                };
                variables.objects.push(v_row);
            }
            rr = await aclient.mutate({
                mutation: INSERT_VERIFICATION_ROWS,
                variables,
            });
            let cnt = rr.data.insert_verification_row.affected_rows;
            if (cnt != variables.objects.length) {
                this.errors++;
                console.log("Row insertion count mismatch: " + cnt);
            }
        } catch (e) {
            console.log("VerParser:closeRow - " + e);
        }
    }
    async done() {
        // For new verifications, update the series, concerning next number
        for (let prefix of Object.keys(this.series_used)) {
            try {
                let variables = { org_id: this.options.org_id, prefix };
                let r = await aclient.query({ query: VER_SEQ_MAX2, variables });
                if (!r.data.ver_seq_max2.length) continue;
                let rr = r.data.ver_seq_max2[0];
                // v1 is the highest number used in the table
                // v2 is the current highest value in the series
                if (rr.v1 > rr.v2) {
                    await setSerieNext(prefix, rr.v1);
                }
            } catch (e) {
                console.log("VerParser:done - " + e);
            }
        }
        super.done();
    }
}

class VerRowParser extends BaseParser {
    word = "#TRANS";
    rows: any[] = [];
    used_accounts: Dict<boolean> = {};

    constructor(public parent: VerParser, public options: Dict<any>) {
        super(parent, options);
    }

    async prepare() {}

    openRow(cols: string[]) {
        // Adjust for non decimal amounts
        // TODO: Check settings if we keep fractions or not
        // TODO: This is also a setting per country/currency.
        let val = Number(cols[3]) + this.parent.dec_adjust;
        let a = Math.round(val);
        this.parent.dec_adjust = val - a;
        let row = {
            account: cols[1],
            debit: a > 0 ? a : 0,
            credit: a < 0 ? -a : 0,
        };
        this.parent.rows.push(row);
        this.used_accounts[cols[1]] = true;
        this.count++;
    }
    closeRow() {}

    async done() {
        // Enable all used accounts in import
        await enableAccounts(this.used_accounts);
    }
}

class AccountParser extends BaseParser {
    word = "#KONTO";
    static accounts: Dict<number> = {};
    static plan: number;
    constructor(public parent: VerParser, public options: Dict<any>) {
        super(parent, options);
    }

    async prepare() {
        // Get all accounts for current org
        let plan = await getValue("organization", this.options.org_id, "plan_id");
        if (!plan) {
            giveUp("Account lookup needs an account plan (for organization).");
        }
        AccountParser.plan = plan;
        let variables = { offset: 0, limit: 1e6, plan };
        let r = await aclient.query({ query: ACCOUNTS, variables });
        for (let v of r.data.account) {
            AccountParser.accounts[v.number] = v.id;
        }
    }

    static async checkAddAccount(
        number: number,
        description: string,
        force = false
    ): Promise<{ id: number; new: boolean }> {
        // Have it already?
        let id = AccountParser.accounts[number];
        if (id && !force) return { id, new: false };
        try {
            if (!id) {
                // Create it
                let r = await aclient.mutate({
                    mutation: INSERT_ACCOUNT,
                    variables: {
                        number,
                        description,
                        plan: AccountParser.plan,
                    },
                });
                if (r.data.insert_account.affected_rows != 1) {
                    console.log("Failed generating required account: " + number);
                    return { id: 0, new: false };
                }
                id = r.data.insert_account.returning[0].id;
                AccountParser.accounts[number] = Number(id);
                return { id, new: true };
            } else {
                // Modify the account
                let r = await aclient.mutate({
                    mutation: MODIFY_ACCOUNT,
                    variables: {
                        number,
                        description,
                        id,
                    },
                });
                if (r.data.update_account.returning.length < 1) {
                    console.log("Failed modifying account: " + number);
                    return { id: 0, new: false };
                }
                return { id, new: true };
            }
        } catch (e) {
            console.log("AccountParser.addAccount - " + e);
            return { id: 0, new: false };
        }
    }
    async openRow(cols: string[]) {
        try {
            let number = Number(cols[1]);
            let description = mergeSieComment(cols.slice(2));
            // If we don't have it, create?
            let r = await AccountParser.checkAddAccount(number, description, this.options.exists_overwrite);
            if (r.id) {
                if (r.new) this.changed++;
                this.count++;
            } else this.errors++;
        } catch (e) {
            console.log("AccountParser.openRow - " + e);
            this.errors++;
        }
    }
    closeRow() {}
}

class ImportInfoParser extends BaseParser {
    word = "#IMPORT_INFO";
    words = ["#SIETYP", "#GEN"];
    public info: Dict<any> = {};

    constructor(public parent: RowParser, public options: Dict<any>) {
        super(parent, options);
    }

    openRow(cols: string[]) {
        if (cols.length > 1) {
            this.changed = -1;
            switch (cols[0]) {
                case "#SIETYP":
                    this.info.SIETYP = cols[1];
                    this.count++;
                    break;
                case "#GEN":
                    this.info.generated_at = cols[1];
                    this.info.generated_by = mergeSieComment(cols.slice(2));
                    this.count++;
                    break;
            }
        }
    }
}

class OrganizationInfoParser extends BaseParser {
    word = "#ORGANIZATION_INFO";
    words = ["#ORGNR", "#FNAMN"];
    public info: Dict<any> = {};

    constructor(public parent: RowParser, public options: Dict<any>) {
        super(parent, options);
    }

    openRow(cols: string[]) {
        if (cols.length > 1) {
            this.changed = -1;
            switch (cols[0]) {
                case "#ORGNR":
                    this.info.organization_number = cols[1];
                    this.info.country_name = "Sweden";
                    this.count++;
                    break;
                case "#FNAMN":
                    this.info.name = mergeSieComment(cols.slice(1));
                    this.count++;
                    break;
            }
        }
    }
}

class AccountingInfoParser extends BaseParser {
    word = "#ACCOUNTING_INFO";
    words = ["#RAR", "#KPTYP", "#VALUTA"];
    public info: Dict<any> = {};

    constructor(public parent: RowParser, public options: Dict<any>) {
        super(parent, options);
    }

    openRow(cols: string[]) {
        if (cols.length > 1) {
            this.changed = -1;
            switch (cols[0]) {
                case "#RAR":
                    this.info.year_count = cols[1];
                    this.info.year_begin = cols[2];
                    this.info.year_end = cols[3];
                    this.count++;
                    break;
                case "#KPTYP":
                    this.info.account_plan = cols[1];
                    this.count++;
                    break;
                case "#VALUTA":
                    this.info.currency = cols[1];
                    this.count++;
                    break;
            }
        }
    }
}

let start_time = process.hrtime();

//import fetch from "cross-fetch";
const fs = require("fs");
//const util = require("util");
import { promisify } from "util";

import * as readline from "readline";
let existsSync = promisify(fs.exists);

let options = {
    user_id: 0,
    org_id: 0,
    global: false,
    branch_id: 0,
    remap_ver_nr: "",
    exists_overwrite: false,
    parts: {} as Dict<any>,
    import_info: {} as Dict<any>,
    organization_info: {} as Dict<any>,
    accounting_info: {} as Dict<any>,
};

let av = process.argv;
let ix;
for (ix = 2; ix < av.length - 1; ix++) {
    let opt: string = av[ix];
    switch (opt) {
        case "-o":
            options.org_id = Number(av[++ix]);
            break;
        case "-u":
            options.user_id = Number(av[++ix]);
            break;
        case "-b":
            options.branch_id = Number(av[++ix]);
            break;
        case "-g":
            options.global = true;
            break;
        case "-O":
            options.exists_overwrite = true;
            break;
        case "-R":
            // Remap verification numbers to this
            options.remap_ver_nr = av[++ix];

        case "-p":
            for (let p of av[++ix].split(",")) {
                if (p[0] !== "#") p = "#" + p;
                p = p.toUpperCase();
                options.parts[p] = true;
                if (p == "#VER") {
                    // We could find a better way enabling "child parsers" from
                    // "parent parsers".
                    options.parts["#TRANS"] = true;
                }
            }
            break;
    }
}
let file = av[ix];

import { Dict } from "../gen_utils";
import { aTop, isEmptyObject, isEmpty } from "../utils";
//import { wrap } from "module";
//import { start } from "repl";

async function runImports() {
    // Check args
    if (options.user_id) {
        //if (!(await exists("user", options.user_id))) giveUp("User does not exist.");
        let org_id = await getValue("user", options.user_id, "organization_id");
        if (options.org_id && options.org_id != org_id) giveUp("Given org ID does not match users org ID.");
        options.org_id = org_id;
    }
    if (options.org_id && !(await exists("organization", options.org_id)))
        giveUp("Organization does not exist.");
    if ((options.parts["#VER"] || isEmpty(options.parts)) && !options.user_id) {
        giveUp("To import verifications, a user has to be specified");
    }
    if (!(await existsSync(file))) giveUp("File does not exist: " + file);
    //process.exit(0);

    // Set user, then let reading of all configuration complete
    setUser({
        user_id: options.user_id,
        organization_id: options.org_id,
    });
    await waitAll();

    // Register parsers
    let parsers: Dict<RowParser> = {};
    let vp = new VerParser(null, options);
    let p_arr: RowParser[] = [
        vp,
        new VerRowParser(vp, options),
        new AccountParser(null, options),
        new ImportInfoParser(null, options),
        new OrganizationInfoParser(null, options),
        new AccountingInfoParser(null, options),
    ];
    for (let p of p_arr) {
        parsers[p.word] = p;
        if (p.words) {
            // Parsers that accept multiple leading words
            for (let w of p.words) {
                parsers[w] = p;
            }
        }
        await p.prepare();
    }

    let parser: RowParser;
    let parents: RowParser[] = [];
    let skipped: Dict<boolean> = {};

    let re_open = new RegExp("^\\{\\s*$");
    let re_close = new RegExp("^\\}\\s*$");

    const rl = readline.createInterface({
        input: fs.createReadStream(file),
        crlfDelay: Infinity,
    });

    let do_all = isEmptyObject(options.parts);

    for await (const line of rl) {
        let word = line.slice(0, line.indexOf(" "));
        let cols = line.split(" ");
        if (re_open.test(line)) {
            parents.push(parser);
        } else if (re_close.test(line)) {
            let p = parents.pop();
            if (p) await p.closeRow();
        } else {
            let p_name = parsers[word] ? parsers[word].word : "";
            parser = do_all || options.parts[p_name] ? parsers[word] : undefined;
            if (parser) {
                await parser.openRow(cols);
            } else {
                if (word && !skipped[word]) {
                    console.log("Skipping:" + word + ":");
                    skipped[word] = true;
                }
            }
        }
    }

    console.log("Import summary:");
    for (let p of Object.values(parsers)) {
        if (!p.is_done) {
            await p.done();
            if (do_all || options.parts[p.word]) {
                let change_cnt = p.changed >= 0 ? p.changed : "<unknown>";
                console.log(`${p.word} - ${p.count} processed - ${change_cnt} changed - ${p.errors} issues`);
            }
        }
    }

    // See if we have collected organization and import data
    if (!isEmpty(parsers["#IMPORT_INFO"].info)) {
        //await setImportValues(parsers["#IMPORT_INFO"].info, options.exists_overwrite);
    }
    if (!isEmpty(parsers["#ORGANIZATION_INFO"].info)) {
        await setUserOrgImportValues(parsers["#ORGANIZATION_INFO"].info, options.exists_overwrite);
    }
    if (!isEmpty(parsers["#ACCOUNTING_INFO"].info)) {
        await setAccountingImportValues(parsers["#ACCOUNTING_INFO"].info, options.exists_overwrite);
    }

    let dur = process.hrtime(start_time);
    console.log(`Duration: ${(dur[0] + dur[1] / 1000000000.0).toFixed(3)} seconds`);
}

runImports();
