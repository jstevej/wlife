export const histLength = 2048; // must be power of two

export class History {
    private decimationCount = 0;
    private decimationFactor = 1;
    public max: number | undefined;
    public min: number | undefined;
    private size = 0;
    public values: Array<number | undefined>;

    constructor() {
        this.values = new Array(histLength).fill(undefined);
    }

    public add(value: number) {
        let addValue = true;

        if (this.decimationFactor > 1) {
            if (this.decimationCount++ !== 0) addValue = false;
            if (this.decimationCount >= this.decimationFactor) this.decimationCount = 0;
        }

        if (addValue) {
            this.values.shift();
            this.values.push(value);
            this.size++;

            if (value !== undefined && !Number.isNaN(value)) {
                if (this.max === undefined || value > this.max) this.max = value;
                if (this.min === undefined || value < this.min) this.min = value;
            }

            if (this.size >= histLength) {
                for (let i = histLength - 1, j = histLength - 2; j >= 0; i -= 1, j -= 2) {
                    this.values[i] = this.values[j];
                }

                for (let i = 0; i < histLength >> 1; i++) {
                    this.values[i] = undefined;
                }

                this.size = histLength >> 1;
                this.decimationFactor += 1;
                this.decimationCount = 0;
            }
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
