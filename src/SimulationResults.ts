export const histLength = 20_000;

export class History {
    public max: number | undefined;
    public min: number | undefined;
    public values: Array<number | undefined>;

    constructor() {
        this.values = new Array(histLength).fill(undefined);
    }

    public add(value: number) {
        this.values.shift();
        this.values.push(value);

        if (value !== undefined && !Number.isNaN(value)) {
            if (this.max === undefined || value > this.max) this.max = value;
            if (this.min === undefined || value < this.min) this.min = value;
        }
    }

    public reset() {
        this.max = undefined;
        this.min = undefined;
        this.values.fill(undefined);
    }
}

export interface ReadOnlyHistory {
    readonly max: number | undefined;
    readonly min: number | undefined;
    readonly values: Array<number | undefined>;
}

export class SimulationResults {
    public _pctAlive = new History();
    public _pctElders = new History();

    public get pctAlive(): ReadOnlyHistory {
        return this._pctAlive;
    }

    public get pctElders(): ReadOnlyHistory {
        return this._pctElders;
    }

    public add(pctAlive: number, pctElders: number) {
        this._pctAlive.add(pctAlive);
        this._pctElders.add(pctElders);
    }

    public reset() {
        this._pctAlive.reset();
        this._pctElders.reset();
    }
}

export const simulationResults = new SimulationResults();
