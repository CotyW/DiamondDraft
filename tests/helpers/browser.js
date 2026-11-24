// Loads the page's browser scripts into a sandbox so tests can drive them without a browser
// or any npm packages. The sandbox has a window (the global itself), a localStorage, and
// whatever extra globals a test passes in. Not a DOM: the scripts tested this way build HTML
// as strings, and their event handlers are driven with small fake elements (fakeHost, button).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const STATIC = path.join(__dirname, '..', '..', 'static');
const DATA = path.join(__dirname, '..', '..', 'data');

function memoryStorage(initial = {}, { failWrites = false } = {}) {
    const items = { ...initial };
    return {
        items,
        getItem: k => (k in items ? items[k] : null),
        setItem: (k, v) => { if (failWrites) throw new Error('QuotaExceededError'); items[k] = String(v); },
        removeItem: k => { delete items[k]; },
    };
}

/** A sandbox with the given scripts (file names in static/) run in order. */
function browser(scripts, { storage = memoryStorage(), globals = {} } = {}) {
    const sandbox = { console, localStorage: storage, setTimeout, clearTimeout, Promise, ...globals };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    for (const file of scripts) {
        vm.runInContext(fs.readFileSync(path.join(STATIC, file), 'utf8'), sandbox, { filename: path.join(STATIC, file) });
    }
    return sandbox;
}

/** The page's own esc/fmt helpers, taken from analysis.js so tests use the real ones. */
function pageHelpers() {
    const src = fs.readFileSync(path.join(STATIC, 'analysis.js'), 'utf8');
    const grab = name => {
        const m = src.match(new RegExp(`const ${name} = (.+);\\r?\\n`));
        if (!m) throw new Error(`analysis.js no longer defines ${name} on one line`);
        return vm.runInNewContext(`(${m[1]})`, { isNaN, Number, String, Math });
    };
    return { esc: grab('esc'), fmt: grab('fmt') };
}

/** data/players.json in the shape the page passes to analyze(), for the projection year. */
function realPlayers() {
    const meta = JSON.parse(fs.readFileSync(path.join(DATA, 'last_updated.json'), 'utf8'));
    const players = JSON.parse(fs.readFileSync(path.join(DATA, 'players.json'), 'utf8')).map(p => {
        const sbs = {};
        for (const y in p.stats) sbs[y] = { batting: { ...p.stats[y] }, pitching: { ...p.stats[y] } };
        return { ...p, stats_by_season: sbs };
    });
    return { players, year: String(meta.projection_year), meta };
}

/** An element that records listeners, for init(outputEl); dispatch(type, target) fires them. */
function fakeHost(children = {}) {
    const listeners = {};
    return {
        listeners,
        children,
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        querySelector(sel) { return children[sel] || null; },
        dispatch(type, target) { (listeners[type] || []).forEach(fn => fn({ target })); },
    };
}

/** A clicked element: closest(sel) answers from `ancestors` ({selector: element}) or itself. */
function button(dataset, ancestors = {}) {
    const el = { dataset };
    el.closest = sel => (sel.startsWith('[data-') ? el : ancestors[sel] || null);
    return el;
}

module.exports = { browser, memoryStorage, pageHelpers, realPlayers, fakeHost, button };
