import React from 'react'
import { createRoot } from 'react-dom/client'
import './carrier.css'
import '../../packages/spatial-ui/spatial-tokens.css'
import '../../packages/spatial-ui/primitives.css'
import '../../packages/wolf-ui/wolf.css'
import { WolfApp } from '../../packages/wolf-ui/WolfApp'

const container = document.getElementById('root')!
const fitViewport = () => { container.style.height = `${window.visualViewport?.height ?? window.innerHeight}px` }
fitViewport()
window.visualViewport?.addEventListener('resize', fitViewport)
window.addEventListener('resize', fitViewport)
createRoot(container).render(<WolfApp />)
