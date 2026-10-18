import { createApp } from './app'
import { prodDeps } from './prod'

const app = createApp(prodDeps())
export default app
