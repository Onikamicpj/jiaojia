import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export const ROOT = resolve(here, '..', '..');
export const SRC_DIR = resolve(ROOT, 'src');
export const DATA_DIR = resolve(ROOT, 'data');
export const CACHE_DIR = resolve(DATA_DIR, 'cache');
export const PUBLIC_DIR = resolve(ROOT, 'public');

export const KITS_FILE = resolve(DATA_DIR, 'kits.json');
export const ALIAS_FILE = resolve(DATA_DIR, 'aliases.json');
export const QUOTES_FILE = resolve(CACHE_DIR, 'quotes.json');
export const FX_FILE = resolve(CACHE_DIR, 'fx.json');
export const HISTORY_FILE = resolve(CACHE_DIR, 'history.json');
export const MANUAL_CSV = resolve(DATA_DIR, 'quotes.manual.csv');
