import { DIALOGUES, type Line } from '../data/dialogues'
import type { Action } from '../sim/types'

export interface TalkStep {
  line: Line | null
  /** Actions to run once the last line is dismissed. */
  actions: Action[]
}

/** Pure walk through one dialogue: step 0 shows the first line; past the end returns null. */
export function talkStep(id: string, index: number): TalkStep {
  const def = DIALOGUES[id]
  if (!def) return { line: null, actions: [] }
  if (index < def.lines.length) return { line: def.lines[index], actions: [] }
  return { line: null, actions: def.actions ?? [] }
}

/** The 3D slice's dialogue box: speaker, portrait from the 2D art, and the line text. */
export class TalkBox {
  private id = ''
  private index = 0
  private readonly box = document.getElementById('dialog')
  private readonly name = document.getElementById('dlg-name')
  private readonly text = document.getElementById('dlg-text')
  private readonly face = document.getElementById('dlg-face') as HTMLImageElement | null

  constructor(
    private readonly base: string,
    private readonly run: (action: Action) => void,
  ) {}

  get open(): boolean {
    return this.id !== ''
  }

  start(id: string): void {
    this.id = id
    this.index = 0
    this.show()
  }

  /** Next line, or close and run the dialogue's actions. */
  advance(): void {
    if (!this.open) return
    this.index += 1
    this.show()
  }

  close(): void {
    this.id = ''
    this.box?.classList.add('hidden')
    document.body.classList.remove('talking')
  }

  private show(): void {
    const step = talkStep(this.id, this.index)
    if (!step.line) {
      this.close()
      for (const action of step.actions) this.run(action)
      return
    }
    if (this.name) this.name.textContent = step.line.speaker
    if (this.text) this.text.textContent = step.line.text
    if (this.face) this.face.src = `${this.base}assets/${step.line.portrait}.png`
    this.box?.classList.remove('hidden')
    document.body.classList.add('talking')
  }
}
