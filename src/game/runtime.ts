export const runtime = {
  cds: {} as Record<string, number>,
  dashCd: 0,
  fireCd: 0,
  shield: 0,
  shieldT: 0,
  focus: 0,
  taunt: 0,
  invuln: 0,
}

export function resetRuntime(): void {
  runtime.cds = {}
  runtime.dashCd = 0
  runtime.fireCd = 0
  runtime.shield = 0
  runtime.shieldT = 0
  runtime.focus = 0
  runtime.taunt = 0
  runtime.invuln = 0
}
