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

export class SimulationResults {
    public pctAlive = new History();
    public pctStable = new History();

    public add(pctAlive: number, pctStable: number) {
        this.pctAlive.add(pctAlive);
        this.pctStable.add(pctStable);
    }

    public reset() {
        this.pctAlive.reset();
        this.pctStable.reset();
    }
}

export const simulationResults = new SimulationResults();
