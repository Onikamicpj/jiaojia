import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readJson(file, fallback = null) {
  try {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function readText(file, fallback = '') {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return fallback;
  }
}

/** 原子写入，避免进程中断留下半截 JSON */
export async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    await rename(tmp, file);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}
