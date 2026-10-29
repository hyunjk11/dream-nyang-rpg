type Handler<T> = (payload: T) => void

export class Emitter<T extends object> {
  private map = new Map<keyof T, Set<Handler<never>>>()

  on<K extends keyof T>(key: K, fn: Handler<T[K]>): void {
    let set = this.map.get(key)
    if (!set) {
      set = new Set()
      this.map.set(key, set)
    }
    set.add(fn as Handler<never>)
  }

  off<K extends keyof T>(key: K, fn: Handler<T[K]>): void {
    this.map.get(key)?.delete(fn as Handler<never>)
  }

  emit<K extends keyof T>(key: K, payload: T[K]): void {
    this.map.get(key)?.forEach((fn) => fn(payload as never))
  }
}

export interface BusEvents {
  boot: undefined
  toast: string
  levelup: undefined
  quest: undefined
  refresh: undefined
  dialogue: string
  death: undefined
}

export const bus = new Emitter<BusEvents>()
