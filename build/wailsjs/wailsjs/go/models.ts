export namespace frontend {
	
	export class FileFilter {
	    DisplayName: string;
	    Pattern: string;
	
	    static createFrom(source: any = {}) {
	        return new FileFilter(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.DisplayName = source["DisplayName"];
	        this.Pattern = source["Pattern"];
	    }
	}
	export class OpenDialogOptions {
	    DefaultDirectory: string;
	    DefaultFilename: string;
	    Title: string;
	    Filters: FileFilter[];
	    ShowHiddenFiles: boolean;
	    CanCreateDirectories: boolean;
	    ResolvesAliases: boolean;
	    TreatPackagesAsDirectories: boolean;
	
	    static createFrom(source: any = {}) {
	        return new OpenDialogOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.DefaultDirectory = source["DefaultDirectory"];
	        this.DefaultFilename = source["DefaultFilename"];
	        this.Title = source["Title"];
	        this.Filters = this.convertValues(source["Filters"], FileFilter);
	        this.ShowHiddenFiles = source["ShowHiddenFiles"];
	        this.CanCreateDirectories = source["CanCreateDirectories"];
	        this.ResolvesAliases = source["ResolvesAliases"];
	        this.TreatPackagesAsDirectories = source["TreatPackagesAsDirectories"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace types {
	
	export class Connect {
	    id: number;
	    name: string;
	    host: string;
	    username: string;
	    password: string;
	    useSSL: boolean;
	    skipSSLVerify: boolean;
	    caCert: string;
	
	    static createFrom(source: any = {}) {
	        return new Connect(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.host = source["host"];
	        this.username = source["username"];
	        this.password = source["password"];
	        this.useSSL = source["useSSL"];
	        this.skipSSLVerify = source["skipSSLVerify"];
	        this.caCert = source["caCert"];
	    }
	}
	export class Config {
	    width: number;
	    height: number;
	    language: string;
	    theme: string;
	    connects: Connect[];
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.width = source["width"];
	        this.height = source["height"];
	        this.language = source["language"];
	        this.theme = source["theme"];
	        this.connects = this.convertValues(source["connects"], Connect);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class History {
	    timestamp: number;
	    method: string;
	    path: string;
	    dsl: string;
	
	    static createFrom(source: any = {}) {
	        return new History(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.timestamp = source["timestamp"];
	        this.method = source["method"];
	        this.path = source["path"];
	        this.dsl = source["dsl"];
	    }
	}
	export class ResultResp {
	    result: any;
	    err: string;
	
	    static createFrom(source: any = {}) {
	        return new ResultResp(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.result = source["result"];
	        this.err = source["err"];
	    }
	}
	export class ResultsResp {
	    results: any[];
	    err: string;
	
	    static createFrom(source: any = {}) {
	        return new ResultsResp(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.results = source["results"];
	        this.err = source["err"];
	    }
	}
	export class Tag {
	    name: string;
	    tag_name: string;
	    body: string;
	
	    static createFrom(source: any = {}) {
	        return new Tag(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.tag_name = source["tag_name"];
	        this.body = source["body"];
	    }
	}

}

