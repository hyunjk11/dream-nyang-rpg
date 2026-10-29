import '@fontsource/jua/400.css'
import '@fontsource/noto-sans-kr/400.css'
import '@fontsource/noto-sans-kr/500.css'
import '@fontsource/noto-sans-kr/700.css'
import './styles.css'
import { startGame } from './game/createGame'
import { installInput } from './game/input'
import { mountUI } from './ui/manager'

if (window.matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch')
window.addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true, passive: true })

void document.fonts.ready.then(() => {
  installInput()
  mountUI(startGame())
})
