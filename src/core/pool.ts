/**
 * Fixed-size object pool with swap-remove: no per-spawn allocation, no O(n) shift/splice, so a
 * long fight full of sparks never feeds the garbage collector. Pure (tested).
 */
export class SwapPool<T> {
  readonly items: T[]
  /** Live items are items[0 .. count). */
  count = 0
  private victim = 0
  /** Spawns that had to recycle a live item because the pool was full (QA). */
  recycled = 0

  constructor(
    readonly cap: number,
    make: () => T,
  ) {
    this.items = Array.from({ length: cap }, make)
  }

  /** A slot to fill. When full, the next slot in rotation is reused (oldest-ish wins). */
  spawn(): T {
    if (this.count < this.cap) return this.items[this.count++]
    this.recycled += 1
    const item = this.items[this.victim]
    this.victim = (this.victim + 1) % this.cap
    return item
  }

  /** Keep the items `alive` says yes to; dead ones swap to the tail (still allocated). */
  sweep(alive: (item: T) => boolean): void {
    let i = 0
    while (i < this.count) {
      if (alive(this.items[i])) {
        i += 1
        continue
      }
      this.count -= 1
      if (i !== this.count) {
        const dead = this.items[i]
        this.items[i] = this.items[this.count]
        this.items[this.count] = dead
      }
    }
    if (this.victim >= this.count) this.victim = 0
  }

  clear(): void {
    this.count = 0
    this.victim = 0
  }
}
