// Runs money operations that share a key one after another within this process. The app runs as
// a single Node process on one SQLite file, so this is what stops two requests from reading the
// same escrow balance and both spending it.
const tails = new Map<string, Promise<unknown>>();

export async function serialized<T>(key: string, run: () => Promise<T>): Promise<T> {
  const current = (tails.get(key) ?? Promise.resolve()).then(run, run);
  const tail = current.catch(() => undefined);
  tails.set(key, tail);
  try {
    return await current;
  } finally {
    if (tails.get(key) === tail) tails.delete(key);
  }
}
