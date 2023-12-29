import { assertUnhandled } from './Sutl';
export const gradientNames = [
    'agSunset',
    'agSunsetRev',
    'grayscale',
    'grayscaleRev',
    'haline',
    'halineRev',
    'jet',
    'jetRev',
    'plasma',
    'plasmaRev',
    'sunset',
    'sunsetRev',
    'viridis',
    'viridisRev',
] as const;
export type GradientName = (typeof gradientNames)[number];

export function isGradientName(value: string | undefined): value is GradientName {
    if (value === undefined) return false;
    return (gradientNames as unknown as Array<string>).includes(value);
}

type HslGradientDef = {
    name: string;
    type: 'hsl';
    values: Array<[number, number, number]>; // 0-360, 0-100, 0-100
};

type RgbGradientDef = {
    name: string;
    type: 'rgb';
    values: Array<[number, number, number]>; // 0-255, 0-255, 0-255
};

type GradientDef = HslGradientDef | RgbGradientDef;

const gradientDefs: Record<GradientName, GradientDef> = {
    agSunset: {
        name: 'Ag Sunset',
        type: 'rgb',
        values: [
            [237, 217, 163],
            [246, 169, 122],
            [250, 120, 118],
            [234, 79, 136],
            [192, 54, 157],
            [135, 44, 162],
            [75, 41, 145],
        ],
    },
    agSunsetRev: {
        name: 'Ag Sunset Rev',
        type: 'rgb',
        values: [
            [75, 41, 145],
            [135, 44, 162],
            [192, 54, 157],
            [234, 79, 136],
            [250, 120, 118],
            [246, 169, 122],
            [237, 217, 163],
        ],
    },
    grayscale: {
        name: 'Grayscale',
        type: 'hsl',
        values: [
            [0.0, 0.0, 1.0],
            [0.0, 0.0, 0.25],
        ],
    },
    grayscaleRev: {
        name: 'Grayscale Rev',
        type: 'hsl',
        values: [
            [0.0, 0.0, 0.25],
            [0.0, 0.0, 1.0],
        ],
    },
    haline: {
        name: 'Haline',
        type: 'rgb',
        values: [
            [253, 238, 153],
            [212, 225, 112],
            [160, 214, 91],
            [111, 198, 107],
            [81, 178, 124],
            [65, 157, 133],
            [53, 136, 136],
            [38, 116, 137],
            [18, 95, 142],
            [15, 71, 153],
            [42, 35, 160],
            [41, 24, 107],
        ],
    },
    halineRev: {
        name: 'Haline Rev',
        type: 'rgb',
        values: [
            [41, 24, 107],
            [42, 35, 160],
            [15, 71, 153],
            [18, 95, 142],
            [38, 116, 137],
            [53, 136, 136],
            [65, 157, 133],
            [81, 178, 124],
            [111, 198, 107],
            [160, 214, 91],
            [212, 225, 112],
            [253, 238, 153],
        ],
    },
    jet: {
        name: 'Jet',
        type: 'hsl',
        values: [
            [0.0, 0.9, 0.5],
            [0.667, 0.9, 0.5],
        ],
    },
    jetRev: {
        name: 'Jet Rev',
        type: 'hsl',
        values: [
            [0.667, 0.9, 0.5],
            [0.0, 0.9, 0.5],
        ],
    },
    plasma: {
        name: 'Plasma',
        type: 'rgb',
        values: [
            [240, 249, 33],
            [253, 202, 38],
            [251, 159, 58],
            [237, 121, 83],
            [216, 87, 107],
            [189, 55, 134],
            [156, 23, 158],
            [114, 1, 168],
            [70, 3, 159],
            [13, 8, 135],
        ],
    },
    plasmaRev: {
        name: 'Plasma Rev',
        type: 'rgb',
        values: [
            [13, 8, 135],
            [70, 3, 159],
            [114, 1, 168],
            [156, 23, 158],
            [189, 55, 134],
            [216, 87, 107],
            [237, 121, 83],
            [251, 159, 58],
            [253, 202, 38],
            [240, 249, 33],
        ],
    },
    sunset: {
        name: 'Sunset',
        type: 'rgb',
        values: [
            [92, 83, 165],
            [160, 89, 160],
            [206, 102, 147],
            [235, 127, 134],
            [248, 160, 126],
            [250, 196, 132],
            [243, 231, 155],
        ],
    },
    sunsetRev: {
        name: 'Sunset Rev',
        type: 'rgb',
        values: [
            [243, 231, 155],
            [250, 196, 132],
            [248, 160, 126],
            [235, 127, 134],
            [206, 102, 147],
            [160, 89, 160],
            [92, 83, 165],
        ],
    },
    viridis: {
        name: 'Viridis',
        type: 'rgb',
        values: [
            [253, 231, 37],
            [181, 222, 43],
            [110, 206, 88],
            [53, 183, 121],
            [31, 158, 137],
            [38, 130, 142],
            [49, 104, 142],
            [62, 73, 137],
            [72, 40, 120],
            [68, 1, 84],
        ],
    },
    viridisRev: {
        name: 'Viridis Rev',
        type: 'rgb',
        values: [
            [68, 1, 84],
            [72, 40, 120],
            [62, 73, 137],
            [49, 104, 142],
            [38, 130, 142],
            [31, 158, 137],
            [53, 183, 121],
            [110, 206, 88],
            [181, 222, 43],
            [253, 231, 37],
        ],
    },
};

const gradientValues: Partial<Record<GradientName, Float32Array>> = {};

export function getGradientName(gradientName: GradientName): string {
    return gradientDefs[gradientName].name;
}

export function getGradientStops(gradientName: GradientName): Array<string> {
    const gradientDef = gradientDefs[gradientName];

    if (gradientDef.type === 'rgb') {
        return gradientDef.values.map(v => `rgb(${v.join(' ')})`);
    } else if (gradientDef.type === 'hsl') {
        return gradientDef.values.map(v => `hsl(${v[0] * 360}deg ${v[1] * 100}% ${v[2] * 100}%)`);
    } else {
        assertUnhandled(gradientDef);
    }
}

export function getGradientValues(gradientName: GradientName, maxAge: number): Float32Array {
    let values = gradientValues[gradientName];

    if (values === undefined) {
        const gradientDef = gradientDefs[gradientName];
        values = new Float32Array((maxAge + 1) * 3);

        const numValues = gradientDef.values.length;
        values[0] = gradientDef.values[0][0];
        values[1] = gradientDef.values[0][1];
        values[2] = gradientDef.values[0][2];
        values[3 * maxAge] = gradientDef.values[numValues - 1][0];
        values[3 * maxAge + 1] = gradientDef.values[numValues - 1][1];
        values[3 * maxAge + 2] = gradientDef.values[numValues - 1][2];

        for (let age = 1; age < maxAge + 1; age++) {
            const index = (age * (numValues - 1)) / maxAge;
            const indexLeft = Math.floor(index);
            const indexRight = Math.ceil(index);
            const frac = index - indexLeft;
            const valueLeft = gradientDef.values[indexLeft];
            const valueRight = gradientDef.values[indexRight];
            values[3 * age] = valueLeft[0] + frac * (valueRight[0] - valueLeft[0]);
            values[3 * age + 1] = valueLeft[1] + frac * (valueRight[1] - valueLeft[1]);
            values[3 * age + 2] = valueLeft[2] + frac * (valueRight[2] - valueLeft[2]);
        }

        if (gradientDef.type === 'hsl') {
            for (let age = 0; age < maxAge + 1; age++) {
                const [r, g, b] = hslToRgb(
                    values[3 * age],
                    values[3 * age + 1],
                    values[3 * age + 2]
                );
                values[3 * age] = r;
                values[3 * age + 1] = g;
                values[3 * age + 2] = b;
            }
        } else if (gradientDef.type === 'rgb') {
            for (let age = 0; age < maxAge + 1; age++) {
                values[3 * age] /= 255;
                values[3 * age + 1] /= 255;
                values[3 * age + 2] /= 255;
            }
        } else {
            throw new Error(`unexpected gradient def type`);
        }
    }

    return values;
}

// hsl (h: 0-1, s: 0-1, l: 0-1) -> rgb [0-1, 0-1, 0-1]

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    let r: number;
    let g: number;
    let b: number;

    if (s === 0) {
        r = g = b = l; // achromatic
    } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hueToRgb(p, q, h + 1 / 3);
        g = hueToRgb(p, q, h);
        b = hueToRgb(p, q, h - 1 / 3);
    }

    return [r, g, b];
}

function hueToRgb(p: number, q: number, t: number): number {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
}
