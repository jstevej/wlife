export type Replacement = {
    regExp: RegExp;
    replacement: string;
};

export function replaceConst(name: string, value: string): Replacement {
    const spc = `[\\t ]`;
    return {
        regExp: new RegExp(
            `^${spc}*const${spc}+${name}${spc}*=.+;${spc}*\\/\\/${spc}*\\{\\{\\{_auto-replace_\\}\\}\\}${spc}*$`,
            'gm'
        ),
        replacement: `const ${name} = ${value}; // {{{_replaced_}}}`,
    };
}

export function replaceWorkgroupSize(name: string, x: number, y?: number, z?: number): Replacement {
    const spc = `[\\t ]`;
    const sizes = [x];
    if (y !== undefined) sizes.push(y);
    if (z !== undefined) sizes.push(z);
    const size = sizes.map(s => s.toString()).join(', ');

    return {
        regExp: new RegExp(
            `^${spc}*@workgroup_size(.+)${spc}*\\/\\/${spc}*\\{\\{\\{_auto-replace_${spc}+${name}${spc}*\\}\\}\\}${spc}*$`,
            'gm'
        ),
        replacement: `@workgroup_size(${size}) // {{{_replaced_}}}`,
    };
}

export function wgslReplace(text: string, replacements: Array<Replacement>): string {
    for (const { regExp, replacement } of replacements) {
        text = text.replace(regExp, replacement);
    }

    return text;
}
